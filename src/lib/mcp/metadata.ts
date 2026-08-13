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
  // Aquí sí vale el comodín: este documento es público por definición (un
  // cliente lo pide ANTES de tener cualquier credencial) y no devuelve nada
  // del usuario.
  'Access-Control-Allow-Origin': '*',
} as const

/**
 * Orígenes de navegador autorizados a llamar al endpoint MCP, separados por
 * comas (p. ej. el inspector de MCP en desarrollo). Vacío por defecto: los
 * clientes de verdad (Claude, ChatGPT, los IDEs) llaman de servidor a servidor
 * y no envían Origin, así que no necesitan estar aquí.
 */
export function allowedOrigins(): string[] {
  return (process.env.MCP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
}

/**
 * Decide qué hacer con el Origin de una petición al endpoint MCP.
 *
 * Sin Origin (servidor a servidor) se permite. Con Origin, solo si está en la
 * lista; y se devuelve ESE origen, no un comodín. Sin esta comprobación
 * cualquier página web podría dirigir peticiones al endpoint desde el
 * navegador de la víctima, que es el vector de las ataques de rebinding de DNS
 * contra servidores MCP.
 */
export function checkOrigin(
  origin: string | null,
): { allowed: true; origin: string | null } | { allowed: false } {
  if (origin == null) return { allowed: true, origin: null }
  return allowedOrigins().includes(origin) ? { allowed: true, origin } : { allowed: false }
}
