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
-- Ejecutar en el SQL Editor de Supabase después de 0005.
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
