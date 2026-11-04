#!/usr/bin/env node
// Alta / actualización de un miembro en la lista blanca.
// Uso:
//   node --env-file=.env scripts/alta-miembro.mjs <alias> "<Nombre Apellido>" [admin]
//   (el PIN se pide por consola para que no quede en el historial del shell)
//   node --env-file=.env scripts/alta-miembro.mjs --desactivar <alias>
import crypto from 'node:crypto';
import readline from 'node:readline';
import { createClient } from '@supabase/supabase-js';

for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PIN_PEPPER']) {
  if (!process.env[k]) { console.error(`Falta ${k} (usa --env-file=.env)`); process.exit(1); }
}
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const args = process.argv.slice(2);

if (args[0] === '--desactivar') {
  const alias = String(args[1] || '').toLowerCase();
  const { error, count } = await db.from('equipo').update({ activo: false }, { count: 'exact' }).eq('alias', alias);
  if (error) throw error;
  console.log(count ? `Desactivado: ${alias}` : `No existe: ${alias}`);
  process.exit(0);
}

const [aliasRaw, nombre, rolArg] = args;
const alias = String(aliasRaw || '').trim().toLowerCase();
if (!/^[a-z0-9._-]{2,32}$/.test(alias) || !nombre) {
  console.error('Uso: alta-miembro.mjs <alias> "<Nombre>" [admin]   (alias: a-z 0-9 . _ -)');
  process.exit(1);
}
const rol = rolArg === 'admin' ? 'admin' : 'miembro';

const pin = await new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => { if (s.includes('PIN')) rl.output.write(s); };
  rl.question('PIN (4-8 dígitos, recomendado 6): ', (a) => { rl.close(); process.stdout.write('\n'); resolve(a.trim()); });
});
if (!/^\d{4,8}$/.test(pin)) { console.error('PIN inválido'); process.exit(1); }
if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) {
  console.error('PIN demasiado obvio (repetido o secuencial)'); process.exit(1);
}

const pin_hash = crypto.createHmac('sha256', process.env.PIN_PEPPER).update(`${alias}:${pin}`).digest('hex');
const { error } = await db.from('equipo').upsert(
  { alias, nombre: nombre.trim(), rol, pin_hash, activo: true, intentos_fallidos: 0, bloqueado_hasta: null },
  { onConflict: 'alias' },
);
if (error) { console.error(error.message); process.exit(1); }
console.log(`OK: ${alias} (${nombre}) rol=${rol}`);
