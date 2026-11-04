// Utilidades compartidas por las funciones /api (archivos con "_" no son rutas en Vercel).
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const CATEGORIAS = [
  'Adquisición de dispositivos',
  'Integración a merchant',
  'Integración con HW de terceros',
  'Botón de pago',
  'Soporte',
  'BCS',
];

export const PROXIMOS_PASOS = [
  'Enviar propuesta',
  'Agendar demo',
  'Llamar',
  'Enviar información',
  'Visita comercial',
];

const COOKIE = 'rc_sesion';
const SESION_HORAS = 12;
export const MAX_INTENTOS = 5;
export const BLOQUEO_MIN = 15;

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta variable de entorno ${name}`);
  return v;
}

let _db;
export function db() {
  if (!_db) {
    _db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _db;
}

// ---------- PIN ----------
export function hashPin(alias, pin) {
  return crypto.createHmac('sha256', env('PIN_PEPPER')).update(`${alias}:${pin}`).digest('hex');
}
export function igualSeguro(aHex, bHex) {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Token de sesión (HS256) ----------
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function firmar(payload) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', env('SESSION_SECRET')).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verificar(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const esperado = crypto.createHmac('sha256', env('SESSION_SECRET')).update(`${head}.${body}`).digest();
  const recibido = Buffer.from(sig, 'base64url');
  if (recibido.length !== esperado.length || !crypto.timingSafeEqual(recibido, esperado)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.exp || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}

// ---------- Cookies ----------
function leerCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
const seguro = () => (process.env.VERCEL_ENV || process.env.NODE_ENV === 'production' ? '; Secure' : '');

export function abrirSesion(res, miembro) {
  const exp = Math.floor(Date.now() / 1000) + SESION_HORAS * 3600;
  const token = firmar({ sub: miembro.id, exp });
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESION_HORAS * 3600}${seguro()}`);
}
export function cerrarSesion(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${seguro()}`);
}

// ---------- Respuestas / guardas ----------
export function enviar(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  if (typeof body === 'string') return res.status(status).send(body);
  return res.status(status).json(body);
}

/** Métodos que cambian estado: exigir JSON y mismo origen (defensa CSRF extra a SameSite=Strict). */
export function origenValido(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return false;
    } catch {
      return false;
    }
  }
  if (req.method === 'DELETE') return true;
  return String(req.headers['content-type'] || '').startsWith('application/json');
}

/** Devuelve el miembro activo de la sesión o responde 401 y devuelve null. */
export async function requerirMiembro(req, res) {
  if (!origenValido(req)) {
    enviar(res, 403, { error: 'Origen no permitido' });
    return null;
  }
  const p = verificar(leerCookie(req, COOKIE));
  if (!p) {
    enviar(res, 401, { error: 'Sesión no válida' });
    return null;
  }
  const { data, error } = await db()
    .from('equipo')
    .select('id, alias, nombre, rol, activo')
    .eq('id', p.sub)
    .maybeSingle();
  if (error || !data || !data.activo) {
    cerrarSesion(res);
    enviar(res, 401, { error: 'Sesión no válida' });
    return null;
  }
  return data;
}

export const publico = (m) => ({ id: m.id, alias: m.alias, nombre: m.nombre, rol: m.rol });
