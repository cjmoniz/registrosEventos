-- =====================================================================
-- Evento CaVeCeCo · Registro de contactos — SETUP COMPLETO DE SUPABASE
-- Ejecutar en Supabase > SQL Editor del MISMO proyecto que está
-- conectado en Vercel (Vercel > evento-cavececo > Storage).
--
-- Se puede ejecutar varias veces sin romper nada (idempotente).
--
-- ANTES DE EJECUTAR, edita SOLO la sección 4 (tu usuario admin):
--   alias, nombre, PIN y PIN_PEPPER (el MISMO valor que está en Vercel).
-- DESPUÉS: borra el PIN y el pepper del editor y no guardes la consulta.
-- =====================================================================


-- ---------- 1. Extensiones ----------
create extension if not exists pgcrypto with schema extensions;


-- ---------- 2. Tablas ----------
create table if not exists public.equipo (
  id                uuid primary key default gen_random_uuid(),
  alias             text not null unique check (alias ~ '^[a-z0-9._-]{2,32}$'),
  nombre            text not null check (char_length(nombre) between 1 and 80),
  pin_hash          text not null,               -- HMAC-SHA256(PIN_PEPPER, alias:pin), nunca el PIN
  rol               text not null default 'miembro' check (rol in ('miembro', 'admin')),
  activo            boolean not null default true,
  intentos_fallidos int not null default 0,
  bloqueado_hasta   timestamptz,
  creado_en         timestamptz not null default now()
);

create table if not exists public.registros (
  id              uuid primary key,              -- generado en el dispositivo
  creado_en       timestamptz not null default now(),
  capturado_en    timestamptz not null,
  evento          text check (char_length(evento) <= 120),
  empresa         text not null check (char_length(empresa) between 1 and 160),
  contacto        text not null check (char_length(contacto) between 1 and 160),
  cargo           text check (char_length(cargo) <= 120),
  telefono        text check (char_length(telefono) <= 40),
  email           text check (char_length(email) <= 254),
  categorias      text[] not null default '{}',
  proximos_pasos  text[] not null default '{}',
  observaciones   text check (char_length(observaciones) <= 4000),
  registrado_por  uuid not null references public.equipo(id),
  constraint contacto_medio check (coalesce(email, '') <> '' or coalesce(telefono, '') <> '')
);

-- Por si la tabla se creó con una versión anterior
alter table public.registros add column if not exists proximos_pasos text[] not null default '{}';
-- PIN temporal: obliga a cambiarlo en el primer ingreso
alter table public.equipo add column if not exists debe_cambiar_pin boolean not null default false;

create index if not exists registros_evento_idx on public.registros (evento, creado_en desc);
create index if not exists registros_email_idx  on public.registros (lower(email));


-- ---------- 3. Seguridad y permisos ----------
-- RLS activo y sin políticas: las claves anon/publishable no ven nada.
alter table public.equipo    enable row level security;
alter table public.registros enable row level security;
revoke all on public.equipo, public.registros from anon, authenticated;

-- La API (clave secret / service_role) sí necesita acceso explícito.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.equipo, public.registros to service_role;


-- ---------- 4. Tu usuario admin (EDITA ESTOS 4 VALORES) ----------
do $$
declare
  v_alias  text := 'cmoniz';                      -- usuario: a-z 0-9 . _ -
  v_nombre text := 'Carlos Moniz';
  v_pin    text := 'CAMBIA_PIN';                  -- 4 a 8 dígitos
  v_pepper text := 'PEGA_AQUI_EL_PIN_PEPPER';     -- mismo PIN_PEPPER que en Vercel
begin
  -- Se valida por formato (no por texto) para que un buscar/reemplazar no la anule.
  if v_pin !~ '^\d{4,8}$' or v_pepper !~ '^[0-9a-f]{32,}$' then
    raise exception 'Sección 4: PIN debe tener 4-8 dígitos y PIN_PEPPER ser el valor hex de Vercel (64 caracteres).';
    return;
  end if;

  insert into public.equipo (alias, nombre, rol, pin_hash, activo, intentos_fallidos, bloqueado_hasta)
  values (
    lower(v_alias), v_nombre, 'admin',
    encode(extensions.hmac(lower(v_alias) || ':' || v_pin, v_pepper, 'sha256'), 'hex'),
    true, 0, null
  )
  on conflict (alias) do update
    set nombre = excluded.nombre, rol = 'admin', pin_hash = excluded.pin_hash,
        activo = true, intentos_fallidos = 0, bloqueado_hasta = null;

  raise notice 'Usuario admin % listo.', lower(v_alias);
end $$;


-- ---------- 5. Verificación (revisa el resultado) ----------
select 'tabla' as chequeo, table_name as detalle
  from information_schema.tables
 where table_schema = 'public' and table_name in ('equipo', 'registros')
union all
select 'permiso service_role', table_name || ': ' || string_agg(privilege_type, ', ' order by privilege_type)
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name in ('equipo', 'registros') and grantee = 'service_role'
 group by table_name
union all
select 'usuario', alias || ' (' || rol || ', ' || case when activo then 'activo' else 'inactivo' end || ')'
  from public.equipo;
