import { db, requerirMiembro, enviar, CATEGORIAS, PROXIMOS_PASOS } from './_lib.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const COLUMNAS =
  'id, creado_en, capturado_en, evento, empresa, contacto, cargo, telefono, email, categorias, proximos_pasos, observaciones, registrado_por, equipo(nombre)';

const txt = (v, max) => {
  const s = String(v ?? '').trim().replace(/[ \t]+/g, ' ');
  return s.length > max ? null : s;
};

export function validarRegistro(b) {
  const errores = {};
  const r = {
    id: String(b?.id || ''),
    capturado_en: b?.capturado_en,
    evento: txt(b?.evento, 120),
    empresa: txt(b?.empresa, 160),
    contacto: txt(b?.contacto, 160),
    cargo: txt(b?.cargo, 120),
    telefono: txt(b?.telefono, 40),
    email: txt(b?.email, 254)?.toLowerCase() ?? null,
    observaciones: String(b?.observaciones ?? '').trim(),
    categorias: Array.isArray(b?.categorias) ? [...new Set(b.categorias)] : null,
    // opcional para compatibilidad con registros en cola de versiones anteriores
    proximos_pasos: b?.proximos_pasos == null ? [] : Array.isArray(b.proximos_pasos) ? [...new Set(b.proximos_pasos)] : null,
  };
  if (!UUID_RE.test(r.id)) errores.id = 'id inválido';
  const fecha = new Date(r.capturado_en);
  if (Number.isNaN(fecha.getTime())) errores.capturado_en = 'Fecha inválida';
  else r.capturado_en = fecha.toISOString();
  for (const k of ['evento', 'empresa', 'contacto', 'cargo', 'telefono', 'email']) {
    if (r[k] === null) errores[k] = 'Demasiado largo';
  }
  if (!r.empresa) errores.empresa ??= 'Requerido';
  if (!r.contacto) errores.contacto ??= 'Requerido';
  if (r.email && !EMAIL_RE.test(r.email)) errores.email = 'Email inválido';
  if (r.telefono) {
    const d = r.telefono.replace(/\D/g, '');
    if (d.length < 7 || d.length > 15) errores.telefono = 'Teléfono inválido';
  }
  if (!r.email && !r.telefono) errores.email ??= 'Indica email o teléfono';
  if (r.observaciones.length > 4000) errores.observaciones = 'Máximo 4000 caracteres';
  if (!r.categorias || r.categorias.some((c) => !CATEGORIAS.includes(c))) errores.categorias = 'Categoría no válida';
  if (!r.proximos_pasos || r.proximos_pasos.some((c) => !PROXIMOS_PASOS.includes(c))) errores.proximos_pasos = 'Próximo paso no válido';
  return { r, errores };
}

const salida = (x) => ({
  ...x,
  registrado_por_nombre: x.equipo?.nombre ?? null,
  equipo: undefined,
});

export default async function handler(req, res) {
  const m = await requerirMiembro(req, res);
  if (!m) return;

  if (req.method === 'GET') {
    let q = db().from('registros').select(COLUMNAS).order('creado_en', { ascending: false }).limit(2000);
    const evento = String(req.query.evento || '').trim();
    if (evento) q = q.eq('evento', evento);
    const { data, error } = await q;
    if (error) return enviar(res, 500, { error: 'Error al leer registros' });
    return enviar(res, 200, data.map(salida));
  }

  if (req.method === 'POST') {
    const { r, errores } = validarRegistro(req.body);
    if (Object.keys(errores).length) return enviar(res, 422, { error: 'Datos no válidos', errores });
    const fila = {
      ...r,
      evento: r.evento || null,
      cargo: r.cargo || null,
      telefono: r.telefono || null,
      email: r.email || null,
      observaciones: r.observaciones || null,
      registrado_por: m.id, // siempre desde la sesión, nunca del cliente
    };
    // Idempotente: si el dispositivo reintenta el mismo id, no duplica.
    const { error } = await db().from('registros').upsert(fila, { onConflict: 'id', ignoreDuplicates: true });
    if (error) return enviar(res, 500, { error: 'Error al guardar' });
    return enviar(res, 201, { ok: true, id: r.id });
  }

  if (req.method === 'DELETE') {
    const id = String(req.query.id || '');
    if (!UUID_RE.test(id)) return enviar(res, 400, { error: 'id inválido' });
    let q = db().from('registros').delete({ count: 'exact' }).eq('id', id);
    if (m.rol !== 'admin') q = q.eq('registrado_por', m.id); // solo los propios
    const { error, count } = await q;
    if (error) return enviar(res, 500, { error: 'Error al eliminar' });
    if (!count) return enviar(res, 404, { error: 'No encontrado o sin permiso' });
    return enviar(res, 200, { ok: true });
  }

  return enviar(res, 405, { error: 'Método no permitido' });
}
