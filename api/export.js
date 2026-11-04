import { db, requerirMiembro, enviar, CATEGORIAS } from './_lib.js';

function celda(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita inyección de fórmulas en Excel
  return `"${s.replace(/"/g, '""')}"`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return enviar(res, 405, { error: 'Método no permitido' });
  const m = await requerirMiembro(req, res);
  if (!m) return;
  if (m.rol !== 'admin') return enviar(res, 403, { error: 'Solo administradores pueden exportar' });

  let q = db()
    .from('registros')
    .select('capturado_en, evento, empresa, contacto, cargo, telefono, email, categorias, proximos_pasos, observaciones, equipo(nombre)')
    .order('capturado_en', { ascending: true })
    .limit(10000);
  const evento = String(req.query.evento || '').trim();
  if (evento) q = q.eq('evento', evento);
  const { data, error } = await q;
  if (error) { console.error('export', error.code, error.message); return enviar(res, 500, { error: 'Error al exportar' }); }

  const head = ['Fecha', 'Evento', 'Empresa', 'Contacto', 'Cargo', 'Teléfono', 'Email', ...CATEGORIAS, 'Categorías', 'Próximo paso', 'Observaciones', 'Registrado por'];  const filas = data.map((r) => [
    new Date(r.capturado_en).toLocaleString('es-VE', { timeZone: process.env.TZ_EVENTO || 'America/Caracas' }),
    r.evento, r.empresa, r.contacto, r.cargo, r.telefono, r.email,
    ...CATEGORIAS.map((c) => (r.categorias?.includes(c) ? 'Sí' : '')),
    (r.categorias || []).join(' | '),
    (r.proximos_pasos || []).join(' | '),
    r.observaciones,
    r.equipo?.nombre,
  ]);
  // ";" como separador: Excel en español abre directo en columnas. BOM para acentos.
  const csv = '﻿' + [head, ...filas].map((f) => f.map(celda).join(';')).join('\r\n');
  const fecha = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="contactos-${fecha}.csv"`);
  return enviar(res, 200, csv);
}
