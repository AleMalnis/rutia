-- ============================================================================
-- RutIA — instalación completa desde cero.
--
-- GENERADO por scripts/build-setup-sql.mjs (`npm run db:setup`): no editar a
-- mano. Es la concatenación en orden de supabase/migrations/
-- (0001_init.sql … 0010_health_consents.sql).
--
-- Pégalo ENTERO en el SQL Editor de Supabase y ejecútalo UNA vez sobre un
-- proyecto vacío. Para actualizar una instalación existente, ejecuta solo las
-- migraciones numeradas que te falten, nunca este fichero.
--
-- ⚠ Si vas a usar el modo MCP: busca abajo el insert en mcp_config y cambia
--   la URL por la de tu dominio (o regenera este fichero con
--   `npm run db:setup -- https://TU-DOMINIO`). Sin modo MCP, da igual.
-- ============================================================================


-- ────────────────────────── 0001_init.sql ──────────────────────────

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

-- ────────────────────────── 0002_colores_categorias.sql ──────────────────────────

-- ============================================================================
-- RutIA — 0002_colores_categorias.sql
-- Sustituye los colores de categoría elegidos a ojo por la paleta validada
-- (contraste y separación para daltonismo comprobados con herramienta, en
-- claro y oscuro; ver spec §4). El hex guardado es la variante clara; la
-- oscura la resuelve la app (src/lib/category-colors.ts).
-- ============================================================================

-- 1. El trigger de registro siembra los colores validados a usuarios nuevos.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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
    (new.id, 'Trabajo',  '#2a78d6'),
    (new.id, 'Estudio',  '#4a3aa7'),
    (new.id, 'Deporte',  '#eb6834'),
    (new.id, 'Salud',    '#e34948'),
    (new.id, 'Comidas',  '#008300'),
    (new.id, 'Hogar',    '#eda100'),
    (new.id, 'Ocio',     '#e87ba4'),
    (new.id, 'Descanso', '#1baf7a')
  on conflict (user_id, name) do nothing;

  return new;
end;
$$;

-- 2. Migra las categorías existentes que aún tengan su color por defecto.
--    Solo se toca la fila si nombre Y color coinciden con el seed original:
--    una categoría renombrada o recoloreada por el usuario no se pisa.
update public.categories set color = v.nuevo
from (values
  ('Trabajo',  '#3b82f6', '#2a78d6'),
  ('Estudio',  '#8b5cf6', '#4a3aa7'),
  ('Deporte',  '#f97316', '#eb6834'),
  ('Salud',    '#ef4444', '#e34948'),
  ('Comidas',  '#22c55e', '#008300'),
  ('Hogar',    '#eab308', '#eda100'),
  ('Ocio',     '#ec4899', '#e87ba4'),
  ('Descanso', '#64748b', '#1baf7a')
) as v(nombre, viejo, nuevo)
where categories.name = v.nombre and categories.color = v.viejo;

-- ────────────────────────── 0003_llm_settings.sql ──────────────────────────

-- ============================================================================
-- RutIA — migración 0003: clave de API propia del usuario (BYOK, spec §6.4)
--
-- El chat integrado funciona solo con la clave del propio usuario. La clave
-- se guarda CIFRADA (AES-256-GCM en la capa de aplicación, con el secreto de
-- servidor LLM_KEY_SECRET): esta tabla nunca contiene la clave en claro y su
-- contenido no sirve de nada sin el secreto del servidor.
-- ============================================================================

create table public.llm_settings (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  provider          text not null check (provider in ('anthropic', 'openai', 'google')),
  api_key_encrypted text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- updated_at automático, reutilizando la función de 0001
create trigger llm_settings_set_updated_at
  before update on public.llm_settings
  for each row execute function public.handle_updated_at();

-- RLS obligatoria (spec §5): cada usuario solo ve y toca su propia fila.
alter table public.llm_settings enable row level security;

create policy llm_settings_select_own on public.llm_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy llm_settings_insert_own on public.llm_settings
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy llm_settings_update_own on public.llm_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy llm_settings_delete_own on public.llm_settings
  for delete to authenticated using (user_id = (select auth.uid()));

-- ────────────────────────── 0004_mcp_access_token_hook.sql ──────────────────────────

-- ============================================================================
-- RutIA — migración 0004: audiencia MCP en los tokens OAuth (spec §6.5)
--
-- El servidor MCP (/api/mcp) es un servidor de recursos OAuth 2.1 y la
-- especificación de MCP le EXIGE rechazar cualquier token que no lo incluya
-- como audiencia. Supabase emite `aud: "authenticated"`, que no sirve para
-- eso, así que este hook añade la audiencia de RutIA.
--
-- Solo toca los tokens del flujo OAuth: se distinguen porque llevan el claim
-- `client_id` (los de la sesión web no lo tienen). Efecto secundario
-- deseable: un token de sesión web NO se puede reutilizar contra /api/mcp.
--
-- ⚠️ CUIDADO: este hook corre en CADA emisión de token del proyecto,
-- incluidos los logins normales. Está escrito para no poder romper el login:
-- ante cualquier forma inesperada devuelve el evento intacto, y todo el
-- cuerpo va dentro de un bloque con captura de excepciones.
--
-- Tras ejecutarlo, activar el hook en Authentication → Hooks → Customize Access Token.
-- ============================================================================

-- La audiencia es el identificador del recurso (la URL del endpoint MCP) y
-- cambia entre producción y desarrollo, así que se lee de una tabla de
-- configuración en vez de estar incrustada en la función.
create table public.mcp_config (
  id             boolean primary key default true check (id),
  resource_url   text not null check (resource_url ~ '^https?://[^[:space:]]+$'),
  updated_at     timestamptz not null default now()
);

comment on table public.mcp_config is
  'Configuración del servidor MCP (spec §6.5). Una sola fila: la restricción del id lo garantiza.';

-- Sustituye la URL por tu dominio de producción antes de ejecutar.
insert into public.mcp_config (resource_url) values ('https://rutia-six.vercel.app/api/mcp');

-- Nadie salvo el propio hook necesita leerla: RLS activa y sin políticas, así
-- que ni authenticated ni anon ven nada (el hook la lee como definer).
alter table public.mcp_config enable row level security;

create trigger mcp_config_set_updated_at
  before update on public.mcp_config
  for each row execute function public.handle_updated_at();


-- ============================================================================
-- El hook
-- ============================================================================

create or replace function public.mcp_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims   jsonb;
  resource text;
begin
  claims := event -> 'claims';

  -- forma inesperada: no tocar nada
  if claims is null or jsonb_typeof(claims) <> 'object' then
    return event;
  end if;

  -- sin client_id no es un token del flujo OAuth (es un login normal)
  if not (claims ? 'client_id') then
    return event;
  end if;

  select mcp_config.resource_url into resource
  from public.mcp_config
  where mcp_config.id
  limit 1;

  if resource is null then
    return event;
  end if;

  -- 'authenticated' va PRIMERO: PostgREST busca coincidencia en el array y
  -- así el token sigue valiendo para la Data API pase lo que pase.
  claims := jsonb_set(
    claims,
    '{aud}',
    jsonb_build_array('authenticated', resource)
  );

  return jsonb_set(event, '{claims}', claims);
exception
  -- un error aquí abortaría la emisión del token y dejaría a TODO el mundo
  -- sin poder iniciar sesión: se prefiere un token sin audiencia MCP (que
  -- /api/mcp rechazará con un 401 claro) a una app sin login.
  when others then
    return event;
end;
$$;

comment on function public.mcp_access_token_hook(jsonb) is
  'Custom Access Token Hook: añade la audiencia del servidor MCP a los tokens OAuth (spec §6.5). Defensivo por diseño: ante cualquier problema devuelve el evento sin tocar.';

-- Permisos que exige Supabase para los hooks de auth: solo el rol de auth
-- puede ejecutarla, y nadie más puede ni verla ni tocar la configuración.
grant execute on function public.mcp_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.mcp_access_token_hook(jsonb) from authenticated, anon, public;

grant select on table public.mcp_config to supabase_auth_admin;
revoke all on table public.mcp_config from authenticated, anon;

-- ────────────────────────── 0005_delete_my_account.sql ──────────────────────────

-- ============================================================================
-- RutIA — migración 0005: borrado de la propia cuenta (spec §12.13, RGPD
-- art. 17).
--
-- Una función y ninguna tabla: `auth.users` no es tocable por `authenticated`,
-- así que el borrado necesita SECURITY DEFINER. El propietario debe ser
-- `postgres` (el rol del SQL Editor), que sí tiene permisos sobre auth.users.
-- La función borra ÚNICA y EXACTAMENTE a auth.uid(): no acepta parámetros,
-- así que no existe forma de borrar a otro usuario, con o sin bugs en la app.
--
-- Y solo desde la sesión web: los tokens del flujo OAuth (modo MCP) también
-- son JWTs con rol `authenticated` válidos ante la Data API, así que sin esta
-- guarda un cliente MCP podría llamar a /rest/v1/rpc/delete_my_account y
-- destruir la cuenta saltándose la confirmación BORRAR. Se distinguen por el
-- claim `client_id`, que la sesión web no lleva (mismo criterio que 0004 y
-- src/lib/mcp/auth.ts).
--
-- La cascada hace el resto: todas las tablas públicas (profiles, categories,
-- routine_items, completions, chat_messages, routine_snapshots, llm_settings)
-- referencian auth.users con ON DELETE CASCADE (migraciones 0001 y 0003), y
-- las internas de auth (sesiones, identidades, grants OAuth del modo MCP)
-- caen con el usuario por el propio esquema de Supabase.
--
-- ============================================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
-- search_path vacío: en una función SECURITY DEFINER un search_path heredado
-- permitiría suplantar objetos; todo va calificado por esquema.
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'No hay sesión.';
  end if;

  if coalesce(auth.jwt() ->> 'client_id', '') <> '' then
    raise exception 'El borrado de la cuenta solo puede hacerse desde la sesión web.';
  end if;

  delete from auth.users where id = auth.uid();
end;
$$;

comment on function public.delete_my_account() is
  'Borra la cuenta del PROPIO usuario autenticado y, en cascada, todos sus datos (spec §12.13, RGPD art. 17). Sin parámetros a propósito: imposible borrar a otro.';

-- ejecutable solo por usuarios autenticados: ni anon ni public
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ────────────────────────── 0006_protect_demo_account.sql ──────────────────────────

-- ============================================================================
-- RutIA — migración 0006: blindaje de la cuenta de demostración (Must #1,
-- spec §4 «Cuenta de demostración»).
--
-- La cuenta demo comparte contraseña con quien evalúa la app, así que
-- cualquiera podría pulsar «Borrar mi cuenta» y destruirla para el siguiente.
-- La marca vive en raw_app_meta_data (el propio usuario NO puede editársela
-- desde el cliente, a diferencia de raw_user_meta_data) y la pone el seed
-- (supabase/seed_demo_user.sql).
--
-- Dos piezas:
--   1. delete_my_account() se recrea entera (0005) añadiendo la guarda, con
--      un errcode propio (PDEMO) para que la server action lo distinga del
--      resto de fallos y muestre un mensaje claro en vez del genérico.
--      create or replace conserva propietario, permisos y comentario de 0005.
--   2. Un trigger sobre auth.users impide cambiar la contraseña o el correo
--      de la cuenta marcada: auth.updateUser() no pide la contraseña actual,
--      así que sin esto cualquier evaluador podría secuestrar la demo para
--      los demás («Secure password change» no basta: GoTrue omite la
--      reautenticación en sesiones de menos de 24 h, y el atacante acaba de
--      iniciar sesión). El trigger compara VALORES (is distinct from), no
--      columnas del SET, para no dispararse en los updates rutinarios de
--      GoTrue al iniciar sesión.
--
-- Recuperación legítima (GoTrue y el dashboard corren ambos como
-- supabase_auth_admin, así que el trigger no puede distinguirlos): en el SQL
-- Editor, quitar la marca — update auth.users set raw_app_meta_data =
-- raw_app_meta_data - 'demo' where email = '...' —, cambiar la contraseña en
-- Authentication → Users y re-ejecutar el seed, que vuelve a marcarla.
--
-- ============================================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
-- search_path vacío: en una función SECURITY DEFINER un search_path heredado
-- permitiría suplantar objetos; todo va calificado por esquema.
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'No hay sesión.';
  end if;

  if coalesce(auth.jwt() ->> 'client_id', '') <> '' then
    raise exception 'El borrado de la cuenta solo puede hacerse desde la sesión web.';
  end if;

  -- la cuenta de demostración es de todos: nadie la borra (spec §4)
  if exists (
    select 1 from auth.users
    where id = auth.uid()
      and raw_app_meta_data ->> 'demo' = 'true'
  ) then
    raise exception 'La cuenta de demostración no se puede borrar.'
      using errcode = 'PDEMO';
  end if;

  delete from auth.users where id = auth.uid();
end;
$$;

-- ── credenciales de la demo intocables ──────────────────────────────────────
-- Mismo patrón que el trigger de alta de 0001 (postgres puede crear triggers
-- sobre auth.users). Sin security definer: solo lee OLD y NEW.
create or replace function public.protect_demo_credentials()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.raw_app_meta_data ->> 'demo' = 'true'
     and (new.encrypted_password is distinct from old.encrypted_password
          or new.email is distinct from old.email) then
    raise exception 'Las credenciales de la cuenta de demostración no se cambian.'
      using errcode = 'PDEMO';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_demo_credentials on auth.users;
create trigger protect_demo_credentials
  before update on auth.users
  for each row execute function public.protect_demo_credentials();

-- ────────────────────────── 0007_push_subscriptions.sql ──────────────────────────

-- ============================================================================
-- RutIA — migración 0007: suscripciones de avisos push (spec §4 «Avisos
-- push», etapa 2 de la PWA).
--
-- Una fila por navegador/dispositivo que activó los avisos. El endpoint y las
-- claves p256dh/auth los emite el navegador al suscribirse; juntos funcionan
-- como un secreto (quien los tenga puede enviar avisos a ese dispositivo),
-- así que entran por server action validada y no vuelven enteros al cliente.
--
-- endpoint único GLOBAL, no por usuario: un dispositivo entrega a una sola
-- bandeja. Si otro usuario inicia sesión en el mismo navegador (la demo, un
-- móvil compartido), el índice único rechaza el alta (23505) y la action lo
-- distingue de un re-alta propio: el cliente se desuscribe en local, obtiene
-- un endpoint nuevo y reintenta; la fila huérfana la limpia el barrido de
-- muertos de la etapa B.
--
-- ============================================================================

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null unique check (char_length(endpoint) between 1 and 2000),
  p256dh     text not null check (char_length(p256dh) between 1 and 512),
  auth       text not null check (char_length(auth) between 1 and 512),
  created_at timestamptz not null default now()
);

-- las consultas del usuario y el barrido del planificador filtran por dueño
create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

-- RLS obligatoria (spec §5): cada usuario solo ve y toca lo suyo.
alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));
-- sin política de update a propósito: una suscripción no se edita — se crea
-- al activar y se borra al desactivar; un endpoint que cambia es una fila
-- nueva del navegador, no una edición

-- ────────────────────────── 0008_push_scheduler.sql ──────────────────────────

-- ============================================================================
-- RutIA — migración 0008: planificador de avisos push (spec §4 «Avisos
-- push», etapa B).
--
-- Cada minuto, pg_cron calcula bajo postgres los recordatorios que tocan
-- (huso del perfil, día programado, minuto exacto — y el anterior, por si el
-- cron disparó tarde), se apunta en push_sent para no duplicar, y entrega el
-- lote a pg_net, que hace POST a /api/push/send de la app. El endpoint hace
-- solo la criptografía Web Push y responde qué suscripciones están muertas
-- (404/410); este mismo trabajo las borra en el tick siguiente con la
-- respuesta que pg_net deja en net._http_response.
--
-- La URL y el secreto NO viven en este fichero (el repo es público): van en
-- Vault. Antes de ejecutar esta migración, en el SQL Editor:
--
--   select vault.create_secret('https://TU-DOMINIO/api/push/send', 'push_dispatch_url');
--   select vault.create_secret('EL-MISMO-SECRETO-QUE-PUSH_DISPATCH_SECRET', 'push_dispatch_secret');
--
-- Sin los secretos, el trabajo avisa (warning) y no envía: no rompe nada.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Deduplicación: un aviso por ítem y día, aunque el cron repita minuto o
-- corra dos veces. Solo la usa el planificador (postgres): RLS activada sin
-- políticas — invisible e intocable para los roles de la app.
create table public.push_sent (
  item_id uuid not null references public.routine_items (id) on delete cascade,
  date    date not null,
  sent_at timestamptz not null default now(),
  primary key (item_id, date)
);
alter table public.push_sent enable row level security;

-- Correlación petición→respuesta para el barrido de muertos: pg_net responde
-- de forma asíncrona y deja el resultado en net._http_response con este id.
create table public.push_dispatch_log (
  request_id bigint primary key,
  created_at timestamptz not null default now()
);
alter table public.push_dispatch_log enable row level security;

create or replace function public.dispatch_due_push()
returns void
language plpgsql
security definer
-- search_path vacío: función SECURITY DEFINER, todo calificado por esquema
set search_path = ''
as $$
declare
  dispatch_url text;
  dispatch_secret text;
  batch jsonb;
  chunk jsonb;
  total int;
  chunk_size constant int := 500;
  offset_n int := 0;
  request_id bigint;
begin
  select decrypted_secret into dispatch_url
    from vault.decrypted_secrets where name = 'push_dispatch_url';
  select decrypted_secret into dispatch_secret
    from vault.decrypted_secrets where name = 'push_dispatch_secret';
  if dispatch_url is null or dispatch_secret is null then
    raise warning 'avisos push: faltan push_dispatch_url/push_dispatch_secret en Vault';
    return;
  end if;

  -- 1. Barrido de muertos: procesar las respuestas ya llegadas de lotes
  --    anteriores. El endpoint responde {"dead": ["endpoint", …]} con las
  --    suscripciones que el servicio de push dio por desaparecidas (404/410).
  with responses as (
    select l.request_id, r.content
    from public.push_dispatch_log l
    join net._http_response r on r.id = l.request_id
    where r.status_code = 200 and r.content is not null
  ), dead as (
    select jsonb_array_elements_text(content::jsonb -> 'dead') as endpoint
    from responses
  )
  delete from public.push_subscriptions s
  using dead d
  where s.endpoint = d.endpoint;

  -- log procesado (llegó respuesta) o caducado (nunca llegó): fuera
  delete from public.push_dispatch_log l
  using net._http_response r
  where r.id = l.request_id;
  delete from public.push_dispatch_log where created_at < now() - interval '1 hour';

  -- el histórico solo sirve para deduplicar: una semana sobra
  delete from public.push_sent where date < current_date - 7;

  -- 2. Lo que toca ahora (y el minuto anterior, por si este tick llegó
  --    tarde): recordatorios de usuarios con alguna suscripción, en SU huso.
  --    El insert en push_sent con on conflict do nothing es la deduplicación:
  --    solo lo recién apuntado se envía.
  with instants as (
    select now() - (g * interval '1 minute') as at
    from generate_series(0, 1) as g
  ), due as (
    select distinct i.id as item_id, (t.at at time zone p.timezone)::date as local_date
    from public.routine_items i
    join public.profiles p on p.id = i.user_id
    cross join instants t
    where i.kind = 'reminder'
      and exists (select 1 from public.push_subscriptions s where s.user_id = i.user_id)
      and to_char(t.at at time zone p.timezone, 'HH24:MI') = to_char(i.start_time, 'HH24:MI')
      and (extract(isodow from t.at at time zone p.timezone)::int - 1) = any (i.days)
  ), fresh as (
    insert into public.push_sent (item_id, date)
    select item_id, local_date from due
    on conflict do nothing
    returning item_id, date
  )
  select jsonb_agg(jsonb_build_object(
    'endpoint', s.endpoint,
    'p256dh', s.p256dh,
    'auth', s.auth,
    'title', i.title,
    -- solo título y hora, nunca el detalle (decisión de producto, spec §4)
    'body', 'a las ' || to_char(i.start_time, 'HH24:MI'),
    'tag', i.id::text || ':' || f.date::text
  ))
  into batch
  from fresh f
  join public.routine_items i on i.id = f.item_id
  join public.push_subscriptions s on s.user_id = i.user_id;

  if batch is null then
    return;
  end if;

  -- 3. POST por trozos de como mucho 500 avisos (el tope que acepta el
  --    endpoint): un minuto gigante no puede tumbar el lote entero. La
  --    entrega es a-lo-sumo-una-vez a propósito: si un envío falla, ese
  --    aviso se pierde — con TTL de 5 minutos, reintentarlo tarde molesta
  --    más que ayuda, y el panel «Hoy» sigue siendo la fuente de verdad.
  total := jsonb_array_length(batch);
  while offset_n < total loop
    select jsonb_agg(e.value) into chunk
    from jsonb_array_elements(batch) with ordinality as e(value, ord)
    where e.ord > offset_n and e.ord <= offset_n + chunk_size;

    select net.http_post(
      url := dispatch_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || dispatch_secret
      ),
      body := chunk
    ) into request_id;

    insert into public.push_dispatch_log (request_id) values (request_id);
    offset_n := offset_n + chunk_size;
  end loop;
end;
$$;

-- solo el cron (postgres) la ejecuta: ningún rol de la app puede dispararla
revoke all on function public.dispatch_due_push() from public, anon, authenticated;

-- cada minuto (cron.schedule con el mismo nombre actualiza el job; la
-- migración entera, como todas, se ejecuta UNA vez y en orden)
select cron.schedule('rutia-avisos-push', '* * * * *', 'select public.dispatch_due_push()');

-- ────────────────────────── 0009_iat_clock_skew.sql ──────────────────────────

-- ============================================================================
-- RutIA — migración 0009: absorber el desfase de reloj de Supabase en el
-- propio token (spec §7.2).
--
-- El problema, visto en producción y reproducido en local (agosto 2026):
-- GoTrue y PostgREST corren en máquinas distintas y, a rachas, el reloj de
-- PostgREST va varios segundos por detrás. Un token recién emitido llega con
-- su `iat` aún «en el futuro» y PostgREST lo rechaza (PGRST303), tumbando la
-- primera carga tras el login. El reintento del fetch (PR #29) absorbe hasta
-- 3 s, pero se midieron ráfagas más largas que lo agotaban.
--
-- El arreglo de raíz: el hook de emisión retrasa el `iat` 60 segundos en
-- TODOS los tokens. El desfase deja de existir para cualquier consumidor
-- salvo que supere el minuto (PostgREST además tolera 30 s extra de reloj).
-- No cambia nada más: `exp` queda intacto (la vida del token es la misma) y
-- ningún consumidor nuestro valida el `iat` contra el reloj — verificado:
--   · GoTrue solo valida el ESQUEMA de las claims tras el hook (tipos y
--     presencia, MinimumViableTokenSchema en internal/tokens/service.go) y
--     firma lo que el hook devuelva, tal cual;
--   · jose (getClaims del middleware/página y el validador de /api/mcp) solo
--     comprueba exp/nbf, no iat;
--   · PostgREST solo exige que iat no sea futuro — justo lo que arreglamos.
--
-- Se recrea el hook de 0004 entero con el retraso añadido; el resto de su
-- lógica (audiencia MCP para tokens OAuth) no cambia. Sigue siendo imposible
-- que rompa el login: cualquier forma inesperada devuelve el evento intacto
-- y todo va dentro de una captura de excepciones.
--
-- Para REVERTIR si hiciera falta: re-ejecutar el bloque `create or replace
-- function` de la migración 0004 y el hook vuelve al comportamiento anterior
-- al instante (el hook ya está activado en Authentication → Hooks; no hay
-- que tocar nada ahí).
--
-- ============================================================================

create or replace function public.mcp_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims   jsonb;
  resource text;
begin
  claims := event -> 'claims';

  -- forma inesperada: no tocar nada
  if claims is null or jsonb_typeof(claims) <> 'object' then
    return event;
  end if;

  -- Desfase de reloj (0009): iat 60 s al pasado en TODOS los tokens, para
  -- que un PostgREST con el reloj atrasado nunca lo vea «en el futuro».
  -- exp no se toca: la vida del token es la misma.
  if jsonb_typeof(claims -> 'iat') = 'number' then
    claims := jsonb_set(claims, '{iat}', to_jsonb((claims ->> 'iat')::bigint - 60));
  end if;

  -- sin client_id no es un token del flujo OAuth (es un login normal):
  -- se queda solo con el iat retrasado
  if not (claims ? 'client_id') then
    return jsonb_set(event, '{claims}', claims);
  end if;

  select mcp_config.resource_url into resource
  from public.mcp_config
  where mcp_config.id
  limit 1;

  if resource is null then
    return jsonb_set(event, '{claims}', claims);
  end if;

  -- 'authenticated' va PRIMERO: PostgREST busca coincidencia en el array y
  -- así el token sigue valiendo para la Data API pase lo que pase.
  claims := jsonb_set(
    claims,
    '{aud}',
    jsonb_build_array('authenticated', resource)
  );

  return jsonb_set(event, '{claims}', claims);
exception
  -- un error aquí abortaría la emisión del token y dejaría a TODO el mundo
  -- sin poder iniciar sesión: se prefiere un token sin retraso de iat ni
  -- audiencia MCP a una app sin login.
  when others then
    return event;
end;
$$;

comment on function public.mcp_access_token_hook(jsonb) is
  'Custom Access Token Hook: retrasa el iat 60 s (desfase de reloj GoTrue↔PostgREST, spec §7.2) y añade la audiencia MCP a los tokens OAuth (spec §6.5). Defensivo por diseño: ante cualquier problema devuelve el evento sin tocar.';

-- ────────────────────────── 0010_health_consents.sql ──────────────────────────

-- ============================================================================
-- RutIA — migración 0010: consentimiento explícito de datos de salud
-- (art. 9.2.a del RGPD, spec §12.12).
--
-- Una fila por usuario y versión del texto aceptado: quién consintió, qué
-- versión leyó y cuándo. Es un registro AUDITABLE: la RLS solo permite
-- insertar y leer lo propio — ni update ni delete. Un consentimiento no se
-- edita ni se borra a mano; solo cae con la cuenta (cascada). La retirada
-- del dato es borrar el texto del ítem, y el registro se conserva como
-- prueba de que el consentimiento existió mientras duró.
--
-- La exigencia vive en el servicio (las tres puertas — formulario, chat y
-- MCP — rechazan guardar detalle/notas sin fila aquí); esta tabla es la
-- prueba demostrable que pide el artículo 9.
--
-- ============================================================================

create table public.health_consents (
  user_id     uuid not null references auth.users (id) on delete cascade,
  version     text not null check (char_length(version) between 1 and 40),
  accepted_at timestamptz not null default now(),
  primary key (user_id, version)
);

comment on table public.health_consents is
  'Consentimiento explícito de datos de salud (art. 9 RGPD, spec §12.12): usuario, versión del texto aceptado y marca de tiempo. Solo-inserción a propósito: auditable.';

alter table public.health_consents enable row level security;

create policy health_consents_select_own on public.health_consents
  for select to authenticated using (user_id = (select auth.uid()));
create policy health_consents_insert_own on public.health_consents
  for insert to authenticated with check (user_id = (select auth.uid()));
-- sin update ni delete a propósito: un consentimiento registrado no se toca

-- La marca de tiempo la pone SIEMPRE la base de datos: un default se puede
-- pisar enviando la columna por PostgREST, y un registro auditable no puede
-- llevar una fecha elegida por el interesado. (La versión sí viene de la app:
-- una versión inventada es inerte — el servicio solo pregunta por la real —
-- y quien la enviara estaría, igualmente, consintiendo con su sesión.)
create or replace function public.pin_health_consent_time()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.accepted_at := now();
  return new;
end;
$$;

drop trigger if exists health_consents_pin_time on public.health_consents;
create trigger health_consents_pin_time
  before insert on public.health_consents
  for each row execute function public.pin_health_consent_time();
