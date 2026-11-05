// Cambio del propio PIN (obligatorio si el PIN es temporal).
import { db, requerirMiembro, comprobarPin, hashPin, pinObvio, enviar, PIN_RE } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return enviar(res, 405, { error: 'Método no permitido' });
  const yo = await requerirMiembro(req, res, { pinPendienteOk: true });
  if (!yo) return;

  const actual = String(req.body?.actual || '').trim();
  const nuevo = String(req.body?.nuevo || '').trim();
  if (!PIN_RE.test(nuevo)) return enviar(res, 422, { error: 'El PIN nuevo debe tener de 4 a 8 dígitos' });
  if (pinObvio(nuevo)) return enviar(res, 422, { error: 'Ese PIN es muy fácil de adivinar. Evita repetidos o secuencias.' });
  if (nuevo === actual) return enviar(res, 422, { error: 'El PIN nuevo debe ser distinto del actual' });

  const { data: m, error } = await db()
    .from('equipo')
    .select('id, alias, pin_hash, intentos_fallidos, bloqueado_hasta')
    .eq('id', yo.id)
    .maybeSingle();
  if (error || !m) { console.error('pin: consulta', error?.code, error?.message); return enviar(res, 500, { error: 'Error del servidor' }); }

  const fallo = await comprobarPin(m, actual);
  if (fallo) return enviar(res, fallo.status, { error: fallo.status === 401 ? 'El PIN actual no es correcto' : fallo.error });

  const { error: e2 } = await db()
    .from('equipo')
    .update({ pin_hash: hashPin(m.alias, nuevo), debe_cambiar_pin: false, intentos_fallidos: 0, bloqueado_hasta: null })
    .eq('id', m.id);
  if (e2) { console.error('pin: update', e2.code, e2.message); return enviar(res, 500, { error: 'Error al guardar el PIN' }); }
  return enviar(res, 200, { ok: true });
}
