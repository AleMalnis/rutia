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
