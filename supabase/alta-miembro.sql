-- Alta / actualización de un miembro del equipo, desde Supabase > SQL Editor.
-- Alternativa al script local: no requiere tener secretos en tu equipo.
--
-- 1. Reemplaza los valores de abajo (sin buscar/reemplazar en todo el archivo).
--    Si no devuelve ninguna fila, el PIN o el pepper no tienen el formato correcto.
-- 2. Ejecuta. 3. Borra el PIN y el pepper del editor (no guardes la consulta).
--
-- PIN_PEPPER debe ser EXACTAMENTE el mismo valor cargado en Vercel.
-- El hash coincide con el de la API: HMAC-SHA256(PIN_PEPPER, "alias:pin") en hex.

with datos as (
  select
    lower('cmoniz')            as alias,    -- usuario: a-z 0-9 . _ -
    'Carlos Moniz'             as nombre,
    'admin'                    as rol,      -- 'admin' o 'miembro'
    '000000'                   as pin,      -- 4 a 8 dígitos, no obvio
    'PEGA_AQUI_EL_PIN_PEPPER'  as pepper
)
insert into public.equipo (alias, nombre, rol, pin_hash, activo, intentos_fallidos, bloqueado_hasta)
select
  alias,
  nombre,
  rol,
  encode(extensions.hmac(alias || ':' || pin, pepper, 'sha256'), 'hex'),
  true, 0, null
from datos
where pin ~ '^\d{4,8}$' and pepper ~ '^[0-9a-f]{32,}$'  -- por formato: un buscar/reemplazar no la anula
on conflict (alias) do update
  set nombre = excluded.nombre,
      rol = excluded.rol,
      pin_hash = excluded.pin_hash,
      activo = true,
      intentos_fallidos = 0,
      bloqueado_hasta = null
returning alias, nombre, rol;

-- Desactivar a alguien:
-- update public.equipo set activo = false where alias = 'usuario';
