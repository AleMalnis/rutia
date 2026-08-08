-- ============================================================================
-- RutIA — migración 0003: clave de API propia del usuario (BYOK, spec §6.4)
--
-- El chat integrado funciona solo con la clave del propio usuario. La clave
-- se guarda CIFRADA (AES-256-GCM en la capa de aplicación, con el secreto de
-- servidor LLM_KEY_SECRET): esta tabla nunca contiene la clave en claro y su
-- contenido no sirve de nada sin el secreto del servidor.
-- Ejecutar en el SQL Editor de Supabase después de 0002.
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
