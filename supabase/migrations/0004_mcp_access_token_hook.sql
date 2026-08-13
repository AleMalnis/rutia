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
-- Ejecutar en el SQL Editor de Supabase después de 0003, y luego activarlo en
-- Authentication → Hooks → Customize Access Token.
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
