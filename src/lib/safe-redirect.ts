// Destino de vuelta tras iniciar sesión (spec §6.5: el flujo OAuth del modo
// MCP manda al usuario a /login y tiene que volver a la autorización).
//
// Solo se admiten rutas internas: aceptar una URL absoluta convertiría el
// formulario de login en un redirector abierto, que es un vector clásico de
// phishing («inicia sesión en la app de verdad y acabas en el sitio del
// atacante, ya autenticado»).

const DEFAULT_DESTINATION = '/app'

export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return DEFAULT_DESTINATION

  // Tiene que empezar por una sola barra. Se rechazan «//host» (que el
  // navegador interpreta como URL absoluta con el esquema actual) y «/\host»,
  // que algunos navegadores normalizan igual.
  if (!value.startsWith('/')) return DEFAULT_DESTINATION
  if (value.startsWith('//') || value.startsWith('/\\')) return DEFAULT_DESTINATION

  // Un esquema colado antes de la barra ya está descartado por lo anterior,
  // pero los saltos de línea permitirían inyectar cabeceras: fuera.
  if (/[\r\n]/.test(value)) return DEFAULT_DESTINATION

  return value
}
