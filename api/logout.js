import { cerrarSesion, enviar, origenValido } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return enviar(res, 405, { error: 'Método no permitido' });
  if (!origenValido(req)) return enviar(res, 403, { error: 'Origen no permitido' });
  cerrarSesion(res);
  return enviar(res, 200, { ok: true });
}
