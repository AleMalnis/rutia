import { z } from 'zod'

// Capa de protocolo MCP (spec §6.5). Funciones puras: reciben la petición ya
// parseada y devuelven la respuesta JSON-RPC. Quien ejecuta las herramientas y
// quien habla HTTP son otros; así esto se puede probar sin red ni base de datos.
//
// Dos eras conviven a propósito:
// - MODERNA (2026-07-28): sin estado. Sin `initialize`, sin sesiones, sin
//   `ping`. La versión viaja en `_meta` de cada petición y en la cabecera.
//   Métodos: server/discover, tools/list, tools/call.
// - LEGADO (2025-11-25 y anteriores): con handshake `initialize`.
// Los clientes de hoy todavía hablan legado, así que un servidor que solo
// hable la moderna no conecta con nadie.

export const MODERN_VERSION = '2026-07-28'
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const
export const SUPPORTED_VERSIONS = [MODERN_VERSION, ...LEGACY_VERSIONS]

export const SERVER_INFO = { name: 'rutia', title: 'RutIA', version: '1.0.0' } as const

const PROTOCOL_VERSION_META = 'io.modelcontextprotocol/protocolVersion'
const CLIENT_CAPABILITIES_META = 'io.modelcontextprotocol/clientCapabilities'
const SERVER_INFO_META = 'io.modelcontextprotocol/serverInfo'

// Códigos JSON-RPC estándar más los que reserva la revisión 2026-07-28.
export const ERROR_CODES = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  headerMismatch: -32020,
  missingRequiredClientCapability: -32021,
  unsupportedProtocolVersion: -32022,
} as const

// El id de JSON-RPC puede ser cadena, número o faltar (notificación).
const rpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0', 'jsonrpc debe ser "2.0".'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string('method es obligatorio.'),
  params: z.record(z.string(), z.unknown()).optional(),
})

export type RpcRequest = z.infer<typeof rpcRequestSchema>

export type RpcResponse = {
  /** Cuerpo JSON-RPC, o null cuando es una notificación (HTTP 202 sin cuerpo). */
  body: Record<string, unknown> | null
  status: number
}

export type ToolRunner = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ text: string; isError: boolean }>

/**
 * Pistas sobre lo que hace la herramienta. El cliente las usa para decidir a
 * quién pedir confirmación, así que se declaran con precisión: marcarlas todas
 * como destructivas haría que hasta una lectura interrumpiese al usuario.
 */
export type ToolAnnotations = {
  /** No modifica nada. */
  readOnlyHint?: boolean
  /** Puede sobrescribir o eliminar datos que ya existían. */
  destructiveHint?: boolean
  /** Repetirla con los mismos argumentos deja el mismo estado. */
  idempotentHint?: boolean
  /** Toca sistemas externos, no solo los datos de la propia app. */
  openWorldHint?: boolean
}

/**
 * Herramienta tal como se publica en `tools/list`. `title` y `annotations` son
 * opcionales en el protocolo y los clientes que no las conocen las ignoran, así
 * que viajan igual en las dos eras.
 */
export type ToolListing = {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: ToolAnnotations
}

/**
 * Respuesta de error. El `id` se OMITE si no se pudo leer, en vez de mandar
 * `null`: el esquema del protocolo tipa el id como cadena o número, así que un
 * null hace que un cliente estricto descarte la respuesta entera.
 */
export function error(
  id: RpcRequest['id'],
  code: number,
  message: string,
  status: number,
  data?: Record<string, unknown>,
): RpcResponse {
  const body: Record<string, unknown> = {
    jsonrpc: '2.0',
    error: data == null ? { code, message } : { code, message, data },
  }
  if (id !== undefined) body.id = id
  return { body, status }
}

function result(id: RpcRequest['id'], payload: Record<string, unknown>): RpcResponse {
  return {
    body: {
      jsonrpc: '2.0',
      id: id ?? null,
      result: { ...payload, _meta: { [SERVER_INFO_META]: SERVER_INFO } },
    },
    status: 200,
  }
}

/** Parsea el cuerpo. Un cuerpo ilegible es -32700; uno mal formado, -32600. */
export function parseRequest(raw: unknown): { ok: true; request: RpcRequest } | { ok: false; response: RpcResponse } {
  const parsed = rpcRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      response: error(undefined, ERROR_CODES.invalidRequest, 'Petición JSON-RPC inválida.', 400),
    }
  }
  return { ok: true, request: parsed.data }
}

function metaOf(request: RpcRequest): Record<string, unknown> | null {
  const meta = request.params?._meta
  return typeof meta === 'object' && meta != null ? (meta as Record<string, unknown>) : null
}

/** La versión que declara la petición: primero `_meta`, luego la cabecera. */
export function declaredVersion(request: RpcRequest, header: string | null): string | null {
  const fromMeta = metaOf(request)?.[PROTOCOL_VERSION_META]
  if (typeof fromMeta === 'string') return fromMeta
  return header
}

/** ¿Habla la era moderna? Se decide por la versión declarada, no por el método. */
export function isModern(version: string | null): boolean {
  return version === MODERN_VERSION
}

/**
 * Un mensaje sin `id` es una notificación: no se responde y no se ejecuta.
 * El protocolo lo dice en las dos direcciones —las peticiones DEBEN llevar id
 * (y no puede ser null) y a las notificaciones NO se les responde—, así que
 * ejecutar una escritura por un cuerpo sin id sería obedecer algo a lo que
 * nadie espera respuesta.
 */
export function isNotification(request: RpcRequest): boolean {
  return request.id === undefined
}

/**
 * `Mcp-Name` puede venir codificado con el centinela `=?base64?…?=` para
 * valores que no caben en una cabecera HTTP; hay que decodificarlo antes de
 * compararlo con el cuerpo.
 */
export function decodeHeaderValue(value: string): string {
  const match = /^=\?base64\?(.*)\?=$/.exec(value)
  if (match == null) return value
  try {
    return Buffer.from(match[1], 'base64').toString('utf8')
  } catch {
    return value
  }
}

const toolsCallParamsSchema = z.object({
  name: z.string('El nombre de la herramienta es obligatorio.'),
  arguments: z.record(z.string(), z.unknown()).optional(),
})

/**
 * Despacha una petición ya autenticada. `headerVersion` y `headerMethod` son
 * las cabeceras MCP-Protocol-Version y Mcp-Method, que la era moderna exige
 * que coincidan con el cuerpo.
 */
export async function dispatch(
  request: RpcRequest,
  options: {
    headerVersion: string | null
    headerMethod: string | null
    headerName: string | null
    tools: ToolListing[]
    runTool: ToolRunner
  },
): Promise<RpcResponse> {
  const { headerVersion, headerMethod, headerName, tools, runTool } = options
  const version = declaredVersion(request, headerVersion)
  // Basta con que UNA de las dos fuentes declare la era moderna para aplicar
  // sus reglas: si solo se mirara la versión efectiva, un cuerpo que dice
  // legado con una cabecera que dice moderna se colaría sin validar nada.
  const modern = isModern(version) || isModern(headerVersion)

  // Una notificación no se responde ni se ejecuta. Va lo primero: si no,
  // `tools/call` sin id borraría datos y contestaría con `id: null`.
  if (isNotification(request)) {
    return { body: null, status: 202 }
  }

  // Versión declarada pero desconocida: se rechaza diciendo qué se soporta,
  // que es lo que permite al cliente reintentar con otra.
  if (version != null && !SUPPORTED_VERSIONS.includes(version)) {
    return error(
      request.id,
      ERROR_CODES.unsupportedProtocolVersion,
      `Versión de protocolo no soportada: ${version}.`,
      400,
      { requested: version, supported: SUPPORTED_VERSIONS },
    )
  }

  // La era moderna exige estas cabeceras y que reflejen el cuerpo. Su AUSENCIA
  // también es un fallo: existen para que un intermediario pueda aplicar
  // políticas sin abrir el cuerpo, así que dejarlas pasar cuando faltan
  // vaciaría de sentido esa garantía.
  if (modern) {
    if (headerVersion == null) {
      return error(request.id, ERROR_CODES.headerMismatch, 'Falta la cabecera MCP-Protocol-Version.', 400)
    }
    if (headerVersion !== version) {
      return error(request.id, ERROR_CODES.headerMismatch, 'MCP-Protocol-Version no coincide con el cuerpo.', 400)
    }
    if (headerMethod == null) {
      return error(request.id, ERROR_CODES.headerMismatch, 'Falta la cabecera Mcp-Method.', 400)
    }
    if (headerMethod !== request.method) {
      return error(request.id, ERROR_CODES.headerMismatch, 'Mcp-Method no coincide con el cuerpo.', 400)
    }

    // Campos obligatorios de `_meta` en cada petición de la era moderna. Solo
    // se exigen aquí: un cliente legado no los lleva y no debe romperse.
    const meta = metaOf(request)
    if (typeof meta?.[PROTOCOL_VERSION_META] !== 'string') {
      return error(request.id, ERROR_CODES.invalidParams, `Falta _meta["${PROTOCOL_VERSION_META}"].`, 400)
    }
    if (meta?.[CLIENT_CAPABILITIES_META] == null) {
      return error(request.id, ERROR_CODES.invalidParams, `Falta _meta["${CLIENT_CAPABILITIES_META}"].`, 400)
    }
  }

  switch (request.method) {
    // ── Era moderna ────────────────────────────────────────────────────────
    case 'server/discover':
      return result(request.id, {
        resultType: 'complete',
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: { tools: {} },
        instructions:
          'RutIA gestiona la rutina semanal recurrente del usuario. Llama primero a get_routine para conocer los identificadores; nunca los inventes. Los días van de 0 (lunes) a 6 (domingo) y las horas en formato 24 h HH:MM.',
        ttlMs: 300_000,
        cacheScope: 'public',
      })

    // ── Era legado ─────────────────────────────────────────────────────────
    case 'initialize': {
      // se acepta la versión que pida el cliente si la soportamos; si pide una
      // desconocida se le responde con la nuestra, como manda el legado
      const requested = typeof request.params?.protocolVersion === 'string' ? request.params.protocolVersion : null
      const agreed = requested != null && SUPPORTED_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0]
      return result(request.id, {
        protocolVersion: agreed,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      })
    }

    // Las notificaciones ya se atajan arriba por no llevar id; estos casos
    // cubren a un cliente que las envíe CON id por error, para no responderle
    // «método no soportado» a algo que sí entendemos.
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return { body: null, status: 202 }

    case 'ping':
      return result(request.id, {})

    // ── Comunes a las dos eras ─────────────────────────────────────────────
    case 'tools/list':
      return result(request.id, {
        tools,
        // Requisitos de la era moderna; inofensivos para el legado, que los
        // ignora al no formar parte de su esquema.
        resultType: 'complete',
        ttlMs: 300_000,
        cacheScope: 'private',
      })

    case 'tools/call': {
      const parsed = toolsCallParamsSchema.safeParse(request.params ?? {})
      if (!parsed.success) {
        return error(request.id, ERROR_CODES.invalidParams, 'Faltan o sobran parámetros en tools/call.', 400)
      }
      // Mcp-Name es obligatoria en tools/call dentro de la era moderna, y el
      // valor puede venir codificado: se decodifica antes de comparar.
      if (modern) {
        if (headerName == null) {
          return error(request.id, ERROR_CODES.headerMismatch, 'Falta la cabecera Mcp-Name.', 400)
        }
        if (decodeHeaderValue(headerName) !== parsed.data.name) {
          return error(request.id, ERROR_CODES.headerMismatch, 'Mcp-Name no coincide con el cuerpo.', 400)
        }
      }

      const execution = await runTool(parsed.data.name, parsed.data.arguments ?? {})
      return result(request.id, {
        content: [{ type: 'text', text: execution.text }],
        isError: execution.isError,
        resultType: 'complete',
      })
    }

    default:
      return error(request.id, ERROR_CODES.methodNotFound, `Método no soportado: ${request.method}.`, 404)
  }
}
