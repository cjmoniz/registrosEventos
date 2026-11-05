// Gestión de la lista blanca (solo admin). El hash del PIN se calcula aquí con
// PIN_PEPPER de Vercel: el pepper nunca sale del servidor.
import { db, requerirAdmin, hashPin, pinTemporal, enviar, ALIAS_RE, PIN_RE } from './_lib.js';

const UUID_RE = /^[0-9a-f-]{36}$/i;
const COLS = 'id, alias, nombre, rol, activo, debe_cambiar_pin, bloqueado_hasta, creado_en';

export default async function handler(req, res) {
  const yo = await requerirAdmin(req, res);
  if (!yo) return;

  if (req.method === 'GET') {
    const { data, error } = await db().from('equipo').select(COLS).order('nombre');
    if (error) { console.error('equipo GET', error.code, error.message); return enviar(res, 500, { error: 'Error al leer el equipo' }); }
    return enviar(res, 200, data);
  }

  if (req.method === 'POST') {
    const alias = String(req.body?.alias || '').trim().toLowerCase();
    const nombre = String(req.body?.nombre || '').trim().replace(/\s+/g, ' ');
    const rol = req.body?.rol === 'admin' ? 'admin' : 'miembro';
    const pinDado = String(req.body?.pin || '').trim();
    if (!ALIAS_RE.test(alias)) return enviar(res, 422, { error: 'Usuario inválido: 2 a 32 caracteres, solo a-z, 0-9, punto, guion o guion bajo' });
    if (!nombre || nombre.length > 80) return enviar(res, 422, { error: 'Indica el nombre (máx. 80 caracteres)' });
    if (pinDado && !PIN_RE.test(pinDado)) return enviar(res, 422, { error: 'El PIN inicial debe tener de 4 a 8 dígitos' });
    const pin = pinDado || pinTemporal();

    const { data, error } = await db()
      .from('equipo')
      .insert({ alias, nombre, rol, pin_hash: hashPin(alias, pin), activo: true, debe_cambiar_pin: true })
      .select(COLS)
      .single();
    if (error?.code === '23505') return enviar(res, 409, { error: `El usuario ${alias} ya existe` });
    if (error) { console.error('equipo POST', error.code, error.message); return enviar(res, 500, { error: 'Error al crear el usuario' }); }
    // El PIN temporal se devuelve una sola vez para que el admin lo entregue.
    return enviar(res, 201, { miembro: data, pin_temporal: pin });
  }

  if (req.method === 'PATCH') {
    const id = String(req.query.id || '');
    if (!UUID_RE.test(id)) return enviar(res, 400, { error: 'id inválido' });
    const accion = String(req.body?.accion || '');
    const propio = id === yo.id;
    let cambios;
    let pin;

    if (accion === 'reset_pin') {
      if (propio) return enviar(res, 422, { error: 'Para tu propio PIN usa "Cambiar PIN"' });
      const pinDado = String(req.body?.pin || '').trim();
      if (pinDado && !PIN_RE.test(pinDado)) return enviar(res, 422, { error: 'El PIN debe tener de 4 a 8 dígitos' });
      pin = pinDado || pinTemporal();
      const { data: m } = await db().from('equipo').select('alias').eq('id', id).maybeSingle();
      if (!m) return enviar(res, 404, { error: 'No encontrado' });
      cambios = { pin_hash: hashPin(m.alias, pin), debe_cambiar_pin: true, intentos_fallidos: 0, bloqueado_hasta: null };
    } else if (accion === 'activar' || accion === 'desactivar') {
      if (propio && accion === 'desactivar') return enviar(res, 422, { error: 'No puedes desactivarte a ti mismo' });
      cambios = { activo: accion === 'activar', ...(accion === 'activar' ? { intentos_fallidos: 0, bloqueado_hasta: null } : {}) };
    } else if (accion === 'rol') {
      const rol = req.body?.rol === 'admin' ? 'admin' : 'miembro';
      if (propio && rol !== 'admin') return enviar(res, 422, { error: 'No puedes quitarte el rol de admin' });
      cambios = { rol };
    } else if (accion === 'desbloquear') {
      cambios = { intentos_fallidos: 0, bloqueado_hasta: null };
    } else {
      return enviar(res, 400, { error: 'Acción no válida' });
    }

    const { data, error } = await db().from('equipo').update(cambios).eq('id', id).select(COLS).maybeSingle();
    if (error) { console.error('equipo PATCH', error.code, error.message); return enviar(res, 500, { error: 'Error al actualizar' }); }
    if (!data) return enviar(res, 404, { error: 'No encontrado' });
    return enviar(res, 200, { miembro: data, ...(pin ? { pin_temporal: pin } : {}) });
  }

  return enviar(res, 405, { error: 'Método no permitido' });
}
