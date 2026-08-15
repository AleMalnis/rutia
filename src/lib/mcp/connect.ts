// Datos para que el usuario final conecte su cliente MCP (spec §6.5). Vive
// aparte de auth.ts a propósito: eso es la ruta de validación de tokens y
// arrastra `jose`, y aquí solo hacen falta dos cadenas.

/**
 * URL pública del servidor MCP, o `null` si el modo MCP no está configurado
 * en este despliegue. A diferencia de `resourceUrl()` de auth.ts, que lanza
 * porque sin la variable no puede validar nada, aquí la ausencia es una
 * respuesta válida: la interfaz simplemente no ofrece la conexión.
 *
 * OJO: `MCP_RESOURCE_URL` no lleva prefijo `NEXT_PUBLIC_`, así que esto solo
 * devuelve algo en el servidor. Llamarlo desde un componente de cliente daría
 * `null` siempre y la sección desaparecería sin decir por qué.
 */
export function mcpServerUrl(): string | null {
  const base = process.env.MCP_RESOURCE_URL?.trim()
  return base == null || base.length === 0 ? null : base
}

/**
 * Enlace que abre en Claude el diálogo de «conector personalizado» con el
 * nombre y la URL ya rellenados. Solo rellena el formulario: el usuario sigue
 * teniendo que confirmar y pasar por la pantalla de consentimiento.
 *
 * La codificación es la parte frágil (la URL viaja dentro de otra URL, así que
 * `://` y las barras tienen que ir escapadas). `URLSearchParams` lo hace bien y
 * un test fija el resultado exacto, porque construirlo a mano se rompe callado.
 */
export function claudeConnectUrl(serverUrl: string): string {
  const params = new URLSearchParams({
    modal: 'add-custom-connector',
    connectorName: 'RutIA',
    connectorUrl: serverUrl,
  })
  return `https://claude.ai/customize/connectors?${params.toString()}`
}
