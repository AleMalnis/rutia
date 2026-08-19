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
-- Ejecutar en el SQL Editor de Supabase después de 0004.
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
