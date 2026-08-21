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
-- Ejecutar en el SQL Editor de Supabase después de 0006.
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
