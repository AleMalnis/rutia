import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

// Autorización del servidor MCP (spec §6.5). /api/mcp es SOLO un servidor de
// recursos OAuth 2.1: no emite tokens. Los emite el servidor OAuth de
// Supabase, y aquí se validan contra el JWKS público del proyecto.
//
// Lo que hace este módulo posible: como el token es un JWT del propio
// Supabase, se puede reenviar a PostgREST y la RLS aplica con auth.uid() real.
// Ninguna clave de servicio interviene en esta ruta.

/** Falta configuración del servidor: la ruta lo traduce a 503, no a 401. */
export class McpConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpConfigError'
  }
}

export type McpIdentity = {
  /** UUID del usuario (claim `sub`). Nunca viene del cuerpo de la petición. */
  userId: string
  /** Cliente OAuth que pidió el token; útil para logs y políticas por cliente. */
  clientId: string
  /** El JWT en crudo, para reenviarlo a PostgREST. */
  token: string
}

export type AuthFailure = {
  /** Motivo interno para el log; nunca se envía al cliente. */
  reason: string
}

/**
 * La URL pública de este servidor de recursos. Es el identificador de
 * audiencia que exige MCP, y tiene que coincidir con el que inyecta el hook
 * de la migración 0004 y con el `resource` de los metadatos.
 */
export function resourceUrl(): string {
  const base = process.env.MCP_RESOURCE_URL
  if (!base) {
    throw new McpConfigError('Falta MCP_RESOURCE_URL en el entorno del servidor.')
  }
  return base
}

function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) {
    throw new McpConfigError('Falta NEXT_PUBLIC_SUPABASE_URL en el entorno del servidor.')
  }
  return url.replace(/\/+$/, '')
}

/** Emisor de los tokens del proyecto: se compara exacto, no por prefijo. */
export function issuer(): string {
  return `${supabaseUrl()}/auth/v1`
}

// El JWKS se cachea entre peticiones (jose respeta el cacheado HTTP y refresca
// cuando aparece un `kid` desconocido): en serverless esto evita una ida y
// vuelta por cada llamada dentro del mismo contenedor caliente.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function keySet(): ReturnType<typeof createRemoteJWKSet> {
  if (jwks == null) {
    jwks = createRemoteJWKSet(new URL(`${issuer()}/.well-known/jwks.json`))
  }
  return jwks
}

/** Solo para tests: obliga a rehacer el JWKS. */
export function resetKeySetCache(): void {
  jwks = null
}

function audienceIncludes(payload: JWTPayload, expected: string): boolean {
  const aud = payload.aud
  if (typeof aud === 'string') return aud === expected
  if (Array.isArray(aud)) return aud.includes(expected)
  return false
}

/**
 * Valida el token de una petición MCP. Devuelve la identidad o el motivo del
 * rechazo; nunca lanza por un token malo (eso es un 401, no un error del
 * servidor). Solo lanza McpConfigError si falta configuración.
 *
 * El orden importa: la firma primero, porque hasta comprobarla el contenido
 * del token es texto que ha escrito un desconocido.
 */
export async function authenticate(
  authorizationHeader: string | null,
): Promise<{ ok: true; identity: McpIdentity } | { ok: false; failure: AuthFailure }> {
  const expectedAudience = resourceUrl()

  if (!authorizationHeader) {
    return { ok: false, failure: { reason: 'sin cabecera Authorization' } }
  }
  // el esquema es case-insensitive según RFC 6750
  const match = /^Bearer[ ]+(.+)$/i.exec(authorizationHeader.trim())
  if (match == null) {
    return { ok: false, failure: { reason: 'la cabecera no es Bearer' } }
  }
  const token = match[1].trim()

  let payload: JWTPayload
  try {
    // jose comprueba firma, `iss`, `exp` y `nbf`. La audiencia se comprueba
    // aparte porque el token lleva un array y aquí exigimos un elemento
    // concreto, no el conjunto.
    const verified = await jwtVerify(token, keySet(), { issuer: issuer() })
    payload = verified.payload
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error'
    return { ok: false, failure: { reason: `JWT inválido (${name})` } }
  }

  // MCP lo exige: un token que no nombre a este servidor no vale, aunque sea
  // un token legítimo del proyecto. Es lo que impide reutilizar el de la
  // sesión web contra esta ruta.
  if (!audienceIncludes(payload, expectedAudience)) {
    return { ok: false, failure: { reason: 'la audiencia no incluye este servidor' } }
  }

  if (payload.role !== 'authenticated') {
    return { ok: false, failure: { reason: `role inesperado (${String(payload.role)})` } }
  }

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    return { ok: false, failure: { reason: 'sin sub' } }
  }

  // Refuerza que viene del flujo OAuth y no de otra vía: el hook de la
  // migración 0004 solo añade la audiencia cuando hay client_id, así que en
  // la práctica esto ya está garantizado, pero se comprueba explícitamente.
  if (typeof payload.client_id !== 'string' || payload.client_id.length === 0) {
    return { ok: false, failure: { reason: 'sin client_id: no es un token OAuth' } }
  }

  return {
    ok: true,
    identity: { userId: payload.sub, clientId: payload.client_id, token },
  }
}

/**
 * Cabecera del reto de autenticación (RFC 9728 §5.1): le dice al cliente
 * dónde están los metadatos para que pueda arrancar el flujo OAuth solo.
 */
export function challengeHeader(): string {
  const metadata = new URL('/.well-known/oauth-protected-resource', resourceUrl()).toString()
  return `Bearer resource_metadata="${metadata}", scope="openid email"`
}
