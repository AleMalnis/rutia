// Destino de vuelta tras iniciar sesión (spec §6.5: el flujo OAuth del modo
// MCP manda al usuario a /login y tiene que volver a la autorización).
//
// Solo se admiten rutas internas: aceptar una URL absoluta convertiría el
// formulario de login en un redirector abierto, que es un vector clásico de
// phishing («inicia sesión en la app de verdad y acabas en el sitio del
// atacante, ya autenticado»).

const DEFAULT_DESTINATION = '/app'

/**
 * ¿Contiene algún carácter de control? Se comprueba por punto de código y no
 * con un rango en una expresión regular para no escribir caracteres de control
 * literales en este archivo.
 *
 * Importa más de lo que parece: los navegadores ELIMINAN tabuladores y saltos
 * de línea de las URLs antes de resolverlas, así que una ruta como
 * `/` + TAB + `/evil.example` se convierte en `//evil.example`, que es una URL
 * absoluta y se saltaría la comprobación de la barra inicial.
 */
function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return DEFAULT_DESTINATION

  if (hasControlChars(value)) return DEFAULT_DESTINATION

  // Tiene que empezar por una sola barra. Se rechazan «//host» (que el
  // navegador interpreta como URL absoluta con el esquema actual) y «/\host»,
  // que algunos navegadores normalizan igual.
  if (!value.startsWith('/')) return DEFAULT_DESTINATION
  if (value.startsWith('//') || value.startsWith('/\\')) return DEFAULT_DESTINATION

  return value
}
