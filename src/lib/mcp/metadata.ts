import { issuer, resourceUrl } from '@/lib/mcp/auth'

// Protected Resource Metadata (RFC 9728), obligatorio para un servidor MCP.
// Es cómo un cliente descubre, sin credenciales, a quién pedirle el token.
//
// Ojo con `scopes_supported`: solo puede contener scopes que el servidor de
// autorización acepte. Supabase admite únicamente los cinco de OIDC, y
// anunciar uno propio («rutina:write» y similares) rompería el flujo en la
// pantalla de autorización, porque el cliente pide exactamente lo anunciado.
// Los permisos de RutIA los define la RLS, no el scope (spec §6.5).

export function protectedResourceMetadata(): Record<string, unknown> {
  return {
    resource: resourceUrl(),
    authorization_servers: [issuer()],
    scopes_supported: ['openid', 'email'],
    bearer_methods_supported: ['header'],
    resource_name: 'RutIA',
    resource_documentation: 'https://github.com/AleMalnis/rutia#modo-mcp',
  }
}

/** Los metadatos son públicos y estables: se pueden cachear sin problema. */
export const METADATA_HEADERS = {
  'Cache-Control': 'public, max-age=3600',
  // un cliente en navegador debe poder leerlos antes de tener token
  'Access-Control-Allow-Origin': '*',
} as const
