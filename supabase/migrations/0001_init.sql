-- ============================================================================
-- RutIA — 0001_init.sql
-- Esquema inicial según docs/ESPECIFICACION.md §5 (modelo de datos):
-- tablas, checks, trigger de registro con seed de categorías y políticas RLS.
-- Pensado para ejecutarse UNA sola vez sobre un proyecto de Supabase vacío.
-- ============================================================================


-- ============================================================================
-- 1. Tablas
-- ============================================================================

-- profiles: uno por usuario, mismo id que auth.users. Lo crea el trigger
-- on_auth_user_created al registrarse; la app nunca lo inserta a mano.
-- timezone: default consciente para la instancia pública en español; la app
-- debe sobrescribirlo con la zona real del navegador en el primer login.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  timezone     text  not null default 'Europe/Madrid',
  preferences  jsonb not null default '{}'::jsonb
);

-- categories: colores del calendario, editables por el usuario.
-- El trigger siembra las 8 por defecto al crear el perfil.
-- unique (id, user_id): permite que otras tablas referencien el par y una FK
-- no pueda apuntar a la categoría de otro usuario (las FKs ignoran la RLS).
create table public.categories (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name    text not null check (char_length(name) between 1 and 40),
  color   text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  unique (user_id, name),
  unique (id, user_id)
);

-- Auxiliar para el check de días repetidos: un CHECK no admite subconsultas,
-- pero sí llamar a una función inmutable que las use.
create function public.array_has_duplicates(arr smallint[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(count(*) <> count(distinct v), false) from unnest(arr) as v
$$;

-- routine_items: la plantilla semanal recurrente. Un ítem multi-día es UNA
-- sola fila con sus días en `days` (0=lunes … 6=domingo).
create table public.routine_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 80),
  category_id uuid,
  kind        text not null check (kind in ('block', 'reminder')),
  days        smallint[] not null,
  start_time  time not null,
  end_time    time,
  detail      text check (char_length(detail) <= 120),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- par referenciable por completions (misma razón que en categories)
  unique (id, user_id),

  -- FK compuesta: la categoría debe ser del MISMO usuario. Al borrar la
  -- categoría solo se anula category_id (sintaxis de Postgres 15+).
  constraint routine_items_category_same_user
    foreign key (category_id, user_id)
    references public.categories (id, user_id)
    on delete set null (category_id),

  -- días válidos: array unidimensional, no vacío, sin repetidos y entre 0 y 6
  constraint routine_items_days_not_empty check (cardinality(days) > 0),
  constraint routine_items_days_one_dim check (array_ndims(days) = 1),
  constraint routine_items_days_distinct check (not public.array_has_duplicates(days)),
  constraint routine_items_days_in_week check (days <@ '{0,1,2,3,4,5,6}'::smallint[]),

  -- un bloque tiene franja (end > start); un recordatorio es puntual (sin end)
  constraint routine_items_kind_times check (
    (kind = 'block' and end_time is not null and end_time > start_time)
    or (kind = 'reminder' and end_time is null)
  )
);

-- completions: un check por ítem y día («ya me tomé la pastilla»).
-- La fecha la pone siempre el servidor, nunca el modelo.
create table public.completions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  item_id      uuid not null,
  date         date not null,
  completed_at timestamptz not null default now(),
  unique (item_id, date),

  -- FK compuesta: solo se puede marcar un ítem PROPIO. Sin esto, un usuario
  -- podría insertar una completion sobre el ítem de otro (las FKs ignoran la
  -- RLS) y bloquearle el check de ese día vía unique (item_id, date).
  constraint completions_item_same_user
    foreign key (item_id, user_id)
    references public.routine_items (id, user_id)
    on delete cascade
);

-- chat_messages: historial de la conversación con el agente.
create table public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  tool_calls jsonb,
  created_at timestamptz not null default now()
);

-- routine_snapshots (Should): estado previo de la rutina para «deshacer».
create table public.routine_snapshots (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  data       jsonb not null,
  created_at timestamptz not null default now()
);


-- ============================================================================
-- 2. Índices
-- Las políticas RLS filtran siempre por user_id: estos índices evitan
-- escaneos completos en cada consulta autenticada.
-- ============================================================================

create index categories_user_id_idx on public.categories (user_id);
create index routine_items_user_id_idx on public.routine_items (user_id);
-- apoya la FK compuesta de categoría (p. ej. al borrar una categoría)
create index routine_items_category_id_user_id_idx on public.routine_items (category_id, user_id);
-- el panel «Hoy» consulta por usuario y fecha; el prefijo user_id cubre
-- también las búsquedas solo por usuario
create index completions_user_id_date_idx on public.completions (user_id, date);
create index chat_messages_user_id_created_at_idx on public.chat_messages (user_id, created_at);
create index routine_snapshots_user_id_created_at_idx on public.routine_snapshots (user_id, created_at);


-- ============================================================================
-- 3. updated_at automático en routine_items
-- ============================================================================

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger routine_items_set_updated_at
  before update on public.routine_items
  for each row execute function public.handle_updated_at();


-- ============================================================================
-- 4. Trigger de registro: crea el perfil y siembra las 8 categorías
-- ============================================================================

-- security definer: el trigger corre durante el alta en auth.users, cuyo rol
-- (supabase_auth_admin) no tiene permisos sobre public. search_path vacío y
-- referencias con esquema explícito, como recomienda Supabase.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- on conflict do nothing: un conflicto aquí (p. ej. trigger duplicado por
  -- una doble ejecución de la migración) no debe abortar el alta del usuario
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;

  insert into public.categories (user_id, name, color) values
    (new.id, 'Trabajo',  '#3b82f6'),
    (new.id, 'Estudio',  '#8b5cf6'),
    (new.id, 'Deporte',  '#f97316'),
    (new.id, 'Salud',    '#ef4444'),
    (new.id, 'Comidas',  '#22c55e'),
    (new.id, 'Hogar',    '#eab308'),
    (new.id, 'Ocio',     '#ec4899'),
    (new.id, 'Descanso', '#64748b')
  on conflict (user_id, name) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================================
-- 5. Row Level Security
-- Obligatoria en todas las tablas (spec §5): cada usuario solo ve y toca lo
-- suyo. `(select auth.uid())` en lugar de auth.uid() directo para que
-- Postgres lo evalúe una vez por consulta y no una vez por fila.
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.routine_items enable row level security;
alter table public.completions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.routine_snapshots enable row level security;

-- profiles: la columna de propiedad es id (= auth.users.id)
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
create policy profiles_delete_own on public.profiles
  for delete to authenticated using (id = (select auth.uid()));

-- categories
create policy categories_select_own on public.categories
  for select to authenticated using (user_id = (select auth.uid()));
create policy categories_insert_own on public.categories
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy categories_update_own on public.categories
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy categories_delete_own on public.categories
  for delete to authenticated using (user_id = (select auth.uid()));

-- routine_items
create policy routine_items_select_own on public.routine_items
  for select to authenticated using (user_id = (select auth.uid()));
create policy routine_items_insert_own on public.routine_items
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy routine_items_update_own on public.routine_items
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy routine_items_delete_own on public.routine_items
  for delete to authenticated using (user_id = (select auth.uid()));

-- completions
create policy completions_select_own on public.completions
  for select to authenticated using (user_id = (select auth.uid()));
create policy completions_insert_own on public.completions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy completions_update_own on public.completions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy completions_delete_own on public.completions
  for delete to authenticated using (user_id = (select auth.uid()));

-- chat_messages
create policy chat_messages_select_own on public.chat_messages
  for select to authenticated using (user_id = (select auth.uid()));
create policy chat_messages_insert_own on public.chat_messages
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy chat_messages_update_own on public.chat_messages
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy chat_messages_delete_own on public.chat_messages
  for delete to authenticated using (user_id = (select auth.uid()));

-- routine_snapshots
create policy routine_snapshots_select_own on public.routine_snapshots
  for select to authenticated using (user_id = (select auth.uid()));
create policy routine_snapshots_insert_own on public.routine_snapshots
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy routine_snapshots_update_own on public.routine_snapshots
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy routine_snapshots_delete_own on public.routine_snapshots
  for delete to authenticated using (user_id = (select auth.uid()));
