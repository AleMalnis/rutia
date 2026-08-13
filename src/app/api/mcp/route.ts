import { NextResponse } from 'next/server'
import { authenticate, challengeHeader, McpConfigError } from '@/lib/mcp/auth'
import { checkOrigin } from '@/lib/mcp/metadata'
import { dispatch, declaredVersion, parseRequest } from '@/lib/mcp/protocol'
import { createMcpClient } from '@/lib/supabase/mcp'
import { createCategoriesRepo } from '@/repositories/categories.repo'
import { createCompletionsRepo } from '@/repositories/completions.repo'
import { createItemsRepo } from '@/repositories/items.repo'
import { createProfilesRepo } from '@/repositories/profiles.repo'
import { executeMcpTool, MCP_TOOLS } from '@/services/mcp.tools'
import { createRoutineService } from '@/services/routine.service'

// Servidor MCP (puerta B, spec §6.5). Es SOLO un servidor de recursos OAuth
// 2.1: el token lo emite Supabase y aquí se valida contra su JWKS. Como el
// token es un JWT del propio proyecto, se reenvía a PostgREST y la RLS aplica
// con auth.uid() real: en esta ruta no interviene ninguna clave de servicio.

// Una llamada MCP es una escritura acotada, no un bucle agéntico: no necesita
// el techo de /api/chat, pero conviene fijarlo por si una herramienta tarda.
export const maxDuration = 30

const BASE_HEADERS = {
  'Cache-Control': 'private, no-store',
  // la respuesta depende del token y del origen: que ninguna caché intermedia
  // las mezcle
  Vary: 'Authorization, Origin',
  // WWW-Authenticate es la cabecera que arranca el descubrimiento OAuth: si
  // no se expone, un cliente de navegador no puede leerla y nunca encuentra
  // los metadatos.
  'Access-Control-Expose-Headers': 'WWW-Authenticate',
}

/**
 * Cabeceras de una respuesta, con el CORS del origen concreto autorizado.
 *
 * CORS va en TODAS las respuestas, no solo en el preflight: sin él el
 * navegador descarta la respuesta real y el fetch falla sin cuerpo ni status
 * visibles, un síntoma muy difícil de rastrear. Y se devuelve el origen exacto
 * en lugar de un comodín, porque un comodín autorizaría a cualquier página.
 */
function headersFor(origin: string | null): Record<string, string> {
  return origin == null ? { ...BASE_HEADERS } : { ...BASE_HEADERS, 'Access-Control-Allow-Origin': origin }
}

/**
 * Sonda de diagnóstico (temporal, mientras verificamos qué habla cada
 * cliente): registra la forma de la petición sin contenido del usuario ni
 * token. Se retira cuando sepamos qué revisión usan Claude y ChatGPT.
 */
function logProbe(request: Request, method: string | null, version: string | null, clientId?: string) {
  console.log(
    '[mcp-probe]',
    JSON.stringify({
      method,
      version,
      headerVersion: request.headers.get('mcp-protocol-version'),
      headerMethod: request.headers.get('mcp-method'),
      headerName: request.headers.get('mcp-name'),
      // solo si VIENE, nunca su valor: en la era antigua un identificador de
      // sesión puede funcionar como credencial, y para el diagnóstico basta
      // saber que el cliente lo envía
      hasSessionId: request.headers.get('mcp-session-id') != null,
      accept: request.headers.get('accept'),
      userAgent: request.headers.get('user-agent'),
      clientId,
    }),
  )
}

function unauthorized(reason: string, origin: string | null) {
  console.warn('[mcp-auth]', reason)
  // sin `id`: en este punto no se ha leído el cuerpo, y un id null hace que un
  // cliente estricto descarte la respuesta
  return NextResponse.json(
    { jsonrpc: '2.0', error: { code: -32001, message: 'No autorizado.' } },
    { status: 401, headers: { ...headersFor(origin), 'WWW-Authenticate': challengeHeader() } },
  )
}

/** Error JSON-RPC preservando el id de la petición si se llegó a leer. */
function rpcError(
  code: number,
  message: string,
  status: number,
  origin: string | null,
  id?: string | number,
) {
  const body: Record<string, unknown> = { jsonrpc: '2.0', error: { code, message } }
  if (id !== undefined) body.id = id
  return NextResponse.json(body, { status, headers: headersFor(origin) })
}

export async function POST(request: Request) {
  // se guarda en cuanto se lee para poder devolverlo incluso si algo falla
  // después: JSON-RPC exige que la respuesta lleve el id de la petición
  let requestId: string | number | undefined
  let origin: string | null = null
  try {
    // 1. Origen. Los clientes de verdad llaman de servidor a servidor y no
    //    envían Origin; si viene, es una página en un navegador y solo se
    //    admite si está autorizada. Sin esta comprobación, cualquier web
    //    podría dirigir peticiones al endpoint desde el navegador de la
    //    víctima (rebinding de DNS).
    const cabeceraOrigen = request.headers.get('origin')
    const comprobacion = checkOrigin(cabeceraOrigen)
    if (!comprobacion.allowed) {
      console.warn('[mcp-auth]', 'origen no autorizado')
      return NextResponse.json(
        { jsonrpc: '2.0', error: { code: -32001, message: 'Origen no autorizado.' } },
        { status: 403, headers: BASE_HEADERS },
      )
    }
    origin = comprobacion.origin

    // 2. Autorización antes de mirar el cuerpo: hasta validar la firma, lo que
    //    llega es texto escrito por un desconocido.
    const auth = await authenticate(request.headers.get('authorization'))
    if (!auth.ok) {
      logProbe(request, null, request.headers.get('mcp-protocol-version'))
      return unauthorized(auth.failure.reason, origin)
    }
    const { userId, clientId, token } = auth.identity

    // 3. Cuerpo
    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return rpcError(-32700, 'JSON inválido.', 400, origin)
    }

    const parsed = parseRequest(raw)
    if (!parsed.ok) {
      return NextResponse.json(parsed.response.body, {
        status: parsed.response.status,
        headers: headersFor(origin),
      })
    }
    requestId = parsed.request.id

    const version = declaredVersion(parsed.request, request.headers.get('mcp-protocol-version'))
    logProbe(request, parsed.request.method, version, clientId)

    // 4. Dominio: el mismo servicio que usa la web, con el JWT del usuario
    const supabase = createMcpClient(token)
    const routine = createRoutineService({
      items: createItemsRepo(supabase),
      completions: createCompletionsRepo(supabase),
      profiles: createProfilesRepo(supabase),
      categories: createCategoriesRepo(supabase),
    })
    const now = new Date()

    const response = await dispatch(parsed.request, {
      headerVersion: request.headers.get('mcp-protocol-version'),
      headerMethod: request.headers.get('mcp-method'),
      headerName: request.headers.get('mcp-name'),
      tools: MCP_TOOLS,
      runTool: async (name, args) => {
        const startedAt = Date.now()
        try {
          const execution = await executeMcpTool(routine, userId, now, name, args)
          console.log(
            '[mcp-tool]',
            JSON.stringify({ tool: name, ok: !execution.isError, ms: Date.now() - startedAt, clientId }),
          )
          return execution
        } catch (error) {
          // Un fallo de la base de datos vuelve como resultado de herramienta,
          // no como error de transporte: así el cliente conserva la
          // correlación con su petición y el modelo puede contarlo y
          // reintentar, en vez de recibir un 500 opaco.
          const name_ = error instanceof Error ? error.name : 'Error'
          const message = error instanceof Error ? error.message : String(error)
          console.error('[mcp-tool]', name, name_, message)
          return {
            text: JSON.stringify({
              ok: false,
              reason: 'error',
              message: 'Error interno al ejecutar la herramienta. Puedes reintentar.',
            }),
            isError: true,
          }
        }
      },
    })

    // una notificación no lleva cuerpo: 202 y nada más
    if (response.body == null) {
      return new NextResponse(null, { status: response.status, headers: headersFor(origin) })
    }
    return NextResponse.json(response.body, { status: response.status, headers: headersFor(origin) })
  } catch (error) {
    if (error instanceof McpConfigError) {
      console.error('[api/mcp]', error.name, error.message)
      return rpcError(-32603, 'Servidor MCP no configurado.', 503, origin, requestId)
    }
    const name = error instanceof Error ? error.name : 'Error'
    const message = error instanceof Error ? error.message : String(error)
    console.error('[api/mcp]', name, message)
    return rpcError(-32603, 'Error interno.', 500, origin, requestId)
  }
}

// La era moderna es sin estado: no hay stream que abrir ni sesión que cerrar,
// así que GET y DELETE se rechazan explícitamente en vez de dejar que Next
// responda un 405 sin cuerpo JSON-RPC.
function methodNotAllowed() {
  // sin `id`: no hay petición JSON-RPC que correlacionar, y el protocolo tipa
  // el id como cadena o número, así que un null hace que un cliente estricto
  // descarte la respuesta entera
  return NextResponse.json(
    { jsonrpc: '2.0', error: { code: -32601, message: 'Solo se admite POST.' } },
    { status: 405, headers: { ...BASE_HEADERS, Allow: 'POST, OPTIONS' } },
  )
}

export const GET = methodNotAllowed
export const DELETE = methodNotAllowed

/**
 * Preflight. Llega SIN cabecera Authorization, así que jamás debe pasar por la
 * validación del token: si lo hiciera, ningún cliente de navegador (como el
 * inspector de MCP) podría conectarse y el síntoma sería difícil de rastrear.
 */
export function OPTIONS(request: Request) {
  const comprobacion = checkOrigin(request.headers.get('origin'))
  if (!comprobacion.allowed) {
    // el preflight se deniega sin cabeceras CORS: el navegador bloqueará la
    // petición real, que es justo lo que se busca
    return new NextResponse(null, { status: 403, headers: BASE_HEADERS })
  }

  const cors: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name',
    'Access-Control-Max-Age': '86400',
  }
  return new NextResponse(null, {
    status: 204,
    headers: { ...headersFor(comprobacion.origin), ...cors },
  })
}
