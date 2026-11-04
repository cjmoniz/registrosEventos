import { db, hashPin, igualSeguro, abrirSesion, enviar, origenValido, publico, MAX_INTENTOS, BLOQUEO_MIN } from './_lib.js';

const ALIAS_RE = /^[a-z0-9._-]{2,32}$/;
const PIN_RE = /^\d{4,8}$/;
const NO_VALIDO = { error: 'Usuario o PIN incorrecto' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return enviar(res, 405, { error: 'Método no permitido' });
  if (!origenValido(req)) return enviar(res, 403, { error: 'Origen no permitido' });

  const alias = String(req.body?.alias || '').trim().toLowerCase();
  const pin = String(req.body?.pin || '').trim();
  if (!ALIAS_RE.test(alias) || !PIN_RE.test(pin)) return enviar(res, 401, NO_VALIDO);

  const { data: m, error } = await db()
    .from('equipo')
    .select('id, alias, nombre, rol, activo, pin_hash, intentos_fallidos, bloqueado_hasta')
    .eq('alias', alias)
    .maybeSingle();
  if (error) return enviar(res, 500, { error: 'Error del servidor' });

  const hash = hashPin(alias, pin); // se calcula siempre: tiempo de respuesta similar exista o no el alias
  if (!m || !m.activo) return enviar(res, 401, NO_VALIDO);

  if (m.bloqueado_hasta && new Date(m.bloqueado_hasta) > new Date()) {
    return enviar(res, 429, { error: `Demasiados intentos. Prueba de nuevo en ${BLOQUEO_MIN} minutos.` });
  }

  if (!igualSeguro(hash, m.pin_hash)) {
    const intentos = (m.intentos_fallidos || 0) + 1;
    const bloquear = intentos >= MAX_INTENTOS;
    await db()
      .from('equipo')
      .update({
        intentos_fallidos: bloquear ? 0 : intentos,
        bloqueado_hasta: bloquear ? new Date(Date.now() + BLOQUEO_MIN * 60000).toISOString() : null,
      })
      .eq('id', m.id);
    return enviar(res, 401, NO_VALIDO);
  }

  if (m.intentos_fallidos || m.bloqueado_hasta) {
    await db().from('equipo').update({ intentos_fallidos: 0, bloqueado_hasta: null }).eq('id', m.id);
  }
  abrirSesion(res, m);
  return enviar(res, 200, publico(m));
}
