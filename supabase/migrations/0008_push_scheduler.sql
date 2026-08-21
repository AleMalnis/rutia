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
-- Ejecutar en el SQL Editor de Supabase después de 0007.
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

  -- 3. Un solo POST con el lote del minuto; la respuesta llega asíncrona
  select net.http_post(
    url := dispatch_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || dispatch_secret
    ),
    body := batch
  ) into request_id;

  insert into public.push_dispatch_log (request_id) values (request_id);
end;
$$;

-- solo el cron (postgres) la ejecuta: ningún rol de la app puede dispararla
revoke all on function public.dispatch_due_push() from public, anon, authenticated;

-- cada minuto; re-ejecutar la migración actualiza el job en vez de duplicarlo
select cron.schedule('rutia-avisos-push', '* * * * *', 'select public.dispatch_due_push()');
