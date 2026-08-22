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
-- Ejecutar en el SQL Editor de Supabase después de 0009.
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
