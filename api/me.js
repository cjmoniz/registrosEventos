import { requerirMiembro, enviar, publico, CATEGORIAS, PROXIMOS_PASOS } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return enviar(res, 405, { error: 'Método no permitido' });
  const m = await requerirMiembro(req, res, { pinPendienteOk: true });
  if (!m) return;
  return enviar(res, 200, { ...publico(m), categorias: CATEGORIAS, proximos_pasos: PROXIMOS_PASOS });
}
