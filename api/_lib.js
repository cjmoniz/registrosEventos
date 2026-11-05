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

function env(name, ...alternativas) {
  for (const n of [name, ...alternativas]) {
    if (process.env[n]) return process.env[n];
  }
  throw new Error(`Falta variable de entorno ${[name, ...alternativas].join(' o ')}`);
}

/** Tipo de clave de Supabase, sin revelarla (solo para diagnóstico en logs). */
function tipoClave(k) {
  if (k.startsWith('sb_secret_')) return 'secret (correcta)';
  if (k.startsWith('sb_publishable_')) return 'publishable (INCORRECTA: usa la secret / service_role)';
  try {
    const rol = JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()).role;
    return rol === 'service_role' ? 'JWT service_role (correcta)' : `JWT ${rol} (INCORRECTA: usa service_role)`;
  } catch {
    return 'desconocida';
  }
}

let _db;
export function db() {
  if (!_db) {
    // Acepta los nombres que define la integración de Supabase en Vercel.
    // Prioridad: variables de la integración (prefijo STORAGE_) y luego las manuales.
    const url = env('STORAGE_SUPABASE_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_STORAGE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
    const clave = env('STORAGE_SUPABASE_SECRET_KEY', 'STORAGE_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
    console.log('supabase: clave tipo', tipoClave(clave));
    _db = createClient(url, clave, {
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

export const ALIAS_RE = /^[a-z0-9._-]{2,32}$/;
export const PIN_RE = /^\d{4,8}$/;

/** PIN fácil de adivinar: repetido (000000) o secuencial (123456 / 654321). */
export function pinObvio(pin) {
  return /^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin);
}

/** PIN temporal aleatorio de 6 dígitos (no obvio). */
export function pinTemporal() {
  let p;
  do { p = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); } while (pinObvio(p));
  return p;
}

/**
 * Verifica el PIN de un miembro aplicando el bloqueo por intentos.
 * Devuelve null si es correcto, o { status, error } para responder.
 */
export async function comprobarPin(m, pin) {
  if (m.bloqueado_hasta && new Date(m.bloqueado_hasta) > new Date()) {
    return { status: 429, error: `Demasiados intentos. Prueba de nuevo en ${BLOQUEO_MIN} minutos.` };
  }
  if (!PIN_RE.test(pin) || !igualSeguro(hashPin(m.alias, pin), m.pin_hash)) {
    const intentos = (m.intentos_fallidos || 0) + 1;
    const bloquear = intentos >= MAX_INTENTOS;
    await db().from('equipo').update({
      intentos_fallidos: bloquear ? 0 : intentos,
      bloqueado_hasta: bloquear ? new Date(Date.now() + BLOQUEO_MIN * 60000).toISOString() : null,
    }).eq('id', m.id);
    return { status: 401, error: 'Usuario o PIN incorrecto' };
  }
  if (m.intentos_fallidos || m.bloqueado_hasta) {
    await db().from('equipo').update({ intentos_fallidos: 0, bloqueado_hasta: null }).eq('id', m.id);
  }
  return null;
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

/**
 * Devuelve el miembro activo de la sesión o responde y devuelve null.
 * Con PIN temporal pendiente de cambio solo se permiten las rutas que lo indiquen.
 */
export async function requerirMiembro(req, res, { pinPendienteOk = false } = {}) {
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
    .select('id, alias, nombre, rol, activo, debe_cambiar_pin')
    .eq('id', p.sub)
    .maybeSingle();
  if (error) console.error('sesion: consulta equipo', error.code, error.message);
  if (error || !data || !data.activo) {
    cerrarSesion(res);
    enviar(res, 401, { error: 'Sesión no válida' });
    return null;
  }
  if (data.debe_cambiar_pin && !pinPendienteOk) {
    enviar(res, 403, { error: 'Debes cambiar tu PIN temporal', codigo: 'PIN_PENDIENTE' });
    return null;
  }
  return data;
}

/** Como requerirMiembro, pero además exige rol admin. */
export async function requerirAdmin(req, res) {
  const m = await requerirMiembro(req, res);
  if (!m) return null;
  if (m.rol !== 'admin') {
    enviar(res, 403, { error: 'Solo administradores' });
    return null;
  }
  return m;
}

export const publico = (m) => ({ id: m.id, alias: m.alias, nombre: m.nombre, rol: m.rol, debe_cambiar_pin: !!m.debe_cambiar_pin });
