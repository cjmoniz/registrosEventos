-- Registro de Contactos en Eventos — esquema Supabase
-- Ejecutar en Supabase > SQL Editor.
-- El acceso se hace SOLO desde las funciones de Vercel con la service_role key.
-- RLS activado y sin políticas => la anon key no puede leer ni escribir nada.

create extension if not exists pgcrypto;

-- Lista blanca del equipo
create table if not exists public.equipo (
  id               uuid primary key default gen_random_uuid(),
  alias            text not null unique check (alias ~ '^[a-z0-9._-]{2,32}$'),
  nombre           text not null check (char_length(nombre) between 1 and 80),
  pin_hash         text not null,               -- HMAC-SHA256(PIN_PEPPER, alias:pin), nunca el PIN
  rol              text not null default 'miembro' check (rol in ('miembro', 'admin')),
  activo           boolean not null default true,
  intentos_fallidos int not null default 0,
  bloqueado_hasta  timestamptz,
  creado_en        timestamptz not null default now()
);

-- Contactos capturados
create table if not exists public.registros (
  id              uuid primary key,              -- generado en el dispositivo (idempotente al reintentar)
  creado_en       timestamptz not null default now(),
  capturado_en    timestamptz not null,          -- hora del dispositivo al capturar
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

-- Migración para bases creadas con la versión anterior del esquema
alter table public.registros add column if not exists proximos_pasos text[] not null default '{}';

create index if not exists registros_evento_idx on public.registros (evento, creado_en desc);
create index if not exists registros_email_idx  on public.registros (lower(email));

alter table public.equipo    enable row level security;
alter table public.registros enable row level security;
revoke all on public.equipo, public.registros from anon, authenticated;
