import { db, hashPin, comprobarPin, abrirSesion, enviar, origenValido, publico, ALIAS_RE, PIN_RE } from './_lib.js';

const NO_VALIDO = { error: 'Usuario o PIN incorrecto' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return enviar(res, 405, { error: 'Método no permitido' });
  if (!origenValido(req)) return enviar(res, 403, { error: 'Origen no permitido' });

  const alias = String(req.body?.alias || '').trim().toLowerCase();
  const pin = String(req.body?.pin || '').trim();
  if (!ALIAS_RE.test(alias) || !PIN_RE.test(pin)) return enviar(res, 401, NO_VALIDO);

  const { data: m, error } = await db()
    .from('equipo')
    .select('id, alias, nombre, rol, activo, pin_hash, intentos_fallidos, bloqueado_hasta, debe_cambiar_pin')
    .eq('alias', alias)
    .maybeSingle();
  if (error) { console.error('login: consulta equipo', error.code, error.message); return enviar(res, 500, { error: 'Error del servidor' }); }

  if (!m || !m.activo) {
    hashPin(alias, pin); // tiempo de respuesta similar exista o no el alias
    return enviar(res, 401, NO_VALIDO);
  }
  const fallo = await comprobarPin(m, pin);
  if (fallo) return enviar(res, fallo.status, { error: fallo.error });

  abrirSesion(res, m);
  return enviar(res, 200, publico(m));
}
