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
-- Ejecutar en el SQL Editor de Supabase después de 0008.
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
