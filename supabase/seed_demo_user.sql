-- ============================================================================
-- RutIA — seed de la cuenta de demostración (Must #1, spec §4 «Cuenta de
-- demostración»). NO es una migración: es re-ejecutable a propósito — cada
-- ejecución borra todo el contenido del usuario demo y lo recrea idéntico,
-- dejando la demo como nueva si quien evalúa la desordena.
--
-- Pasos:
--   1. Crea el usuario en el dashboard (Authentication → Add user) con
--      «Auto Confirm»: el SQL no tiene vía soportada para dar de alta
--      usuarios con contraseña.
--   2. Si usaste otro correo, cámbialo en la línea demo_email de abajo.
--   3. Ejecuta este fichero en el SQL Editor, después de las migraciones
--      (necesita la 0006).
--
-- Qué siembra: la marca demo en raw_app_meta_data (la 0006 la usa para
-- impedir el borrado; el usuario no puede editársela desde el cliente), las
-- 8 categorías por defecto, ~15 ítems realistas sin solapes (la regla vive
-- en el servicio, aquí se respeta a mano) y los completados de los últimos
-- 3 días — relativos a la fecha de ejecución, así la demo no envejece —
-- dejando «Gimnasio» y «Leer 20 minutos» sin marcar para que parezca humana.
-- Sin clave de API (el chat enseña su estado vacío, que es la primera
-- experiencia real) y sin conversación inventada.
-- ============================================================================

do $seed$
declare
  demo_email constant text := 'demo@rutia.app';  -- ← cámbialo si usaste otro
  demo_id uuid;
begin
  select id into demo_id from auth.users where email = demo_email;
  if demo_id is null then
    raise exception 'No existe %: créalo primero en Authentication → Add user (con Auto Confirm).', demo_email;
  end if;

  -- marca inviolable desde el cliente: la migración 0006 impide borrar
  -- cualquier cuenta que la lleve
  update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"demo": true}'::jsonb
    where id = demo_id;

  update public.profiles set display_name = 'Demo' where id = demo_id;

  -- borrón y cuenta nueva: borrar los ítems arrastra sus completions
  delete from public.routine_items where user_id = demo_id;
  delete from public.categories where user_id = demo_id;
  delete from public.chat_messages where user_id = demo_id;
  delete from public.routine_snapshots where user_id = demo_id;
  delete from public.llm_settings where user_id = demo_id;

  -- las 8 categorías por defecto con la paleta validada (0002)
  insert into public.categories (user_id, name, color) values
    (demo_id, 'Trabajo',  '#2a78d6'),
    (demo_id, 'Estudio',  '#4a3aa7'),
    (demo_id, 'Deporte',  '#eb6834'),
    (demo_id, 'Salud',    '#e34948'),
    (demo_id, 'Comidas',  '#008300'),
    (demo_id, 'Hogar',    '#eda100'),
    (demo_id, 'Ocio',     '#e87ba4'),
    (demo_id, 'Descanso', '#1baf7a');

  -- semana realista sin solapes entre bloques (días: 0=lunes … 6=domingo)
  insert into public.routine_items
    (user_id, title, category_id, kind, days, start_time, end_time, detail, notes)
  select demo_id, v.title, c.id, v.kind, v.days::smallint[],
         v.start_time::time, v.end_time::time, v.detail, v.notes
  from (values
    ('Estiramientos',        'Deporte',  'reminder', '{0,1,2,3,4}',     '07:30', null,    'Espalda y cuello',          null),
    ('Desayuno',             'Comidas',  'block',    '{0,1,2,3,4,5,6}', '08:00', '08:30', null,                        null),
    ('Trabajo concentrado',  'Trabajo',  'block',    '{0,1,2,3,4}',     '09:00', '13:00', null,                        'Móvil en modo avión hasta las 11'),
    ('Comida',               'Comidas',  'block',    '{0,1,2,3,4,5,6}', '13:30', '14:15', null,                        null),
    ('Reuniones y correo',   'Trabajo',  'block',    '{0,1,2,3}',       '15:00', '17:00', null,                        null),
    ('Curso de inglés',      'Estudio',  'block',    '{4}',             '15:00', '16:30', 'Unidad 7: condicionales',   null),
    ('Gimnasio',             'Deporte',  'block',    '{0,2,4}',         '17:30', '18:30', null,                        'Fuerza: pierna L, torso X, cuerpo entero V'),
    ('Regar las plantas',    'Hogar',    'reminder', '{1,3}',           '18:00', null,    null,                        null),
    ('Cena',                 'Comidas',  'block',    '{0,1,2,3,4,5,6}', '20:30', '21:15', null,                        null),
    ('Leer 20 minutos',      'Descanso', 'reminder', '{0,1,2,3,4,5,6}', '22:30', null,    'Sin pantallas',             null),
    ('Compra semanal',       'Hogar',    'block',    '{5}',             '10:00', '11:30', null,                        'La lista está en la nevera'),
    ('Paseo por el monte',   'Deporte',  'block',    '{5}',             '12:00', '13:15', null,                        null),
    ('Batch cooking',        'Comidas',  'block',    '{6}',             '10:30', '12:00', 'Tuppers para L-X',          null),
    ('Llamada familiar',     'Ocio',     'reminder', '{6}',             '18:00', null,    null,                        null),
    ('Planificar la semana', 'Trabajo',  'reminder', '{6}',             '19:00', null,    'Repasar RutIA y ajustar',   null)
  ) as v(title, cat, kind, days, start_time, end_time, detail, notes)
  join public.categories c on c.user_id = demo_id and c.name = v.cat;

  -- completados de los últimos 3 días, solo en ítems programados ese día de
  -- la semana (isodow: 1=lunes … 7=domingo → días de la app restando 1) y a
  -- una hora verosímil de esa noche, no la de ejecutar el seed. El «hoy» se
  -- ancla a Europe/Madrid (el huso del perfil demo): current_date iría en el
  -- de la conexión (UTC en Supabase) y de madrugada correría la ventana un día
  insert into public.completions (user_id, item_id, date, completed_at)
  select demo_id, i.id, d.day,
         (d.day + time '22:00') at time zone 'Europe/Madrid'
  from generate_series(1, 3) as g(n)
  cross join lateral (
    select ((now() at time zone 'Europe/Madrid')::date - g.n) as day
  ) d
  join public.routine_items i
    on i.user_id = demo_id
   and (extract(isodow from d.day)::int - 1) = any (i.days)
  where i.title not in ('Gimnasio', 'Leer 20 minutos');
end;
$seed$;
