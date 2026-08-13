import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticate, challengeHeader, issuer, McpConfigError, resetKeySetCache, resourceUrl } from '@/lib/mcp/auth'
import { allowedOrigins, checkOrigin, protectedResourceMetadata } from '@/lib/mcp/metadata'
import {
  dispatch,
  declaredVersion,
  ERROR_CODES,
  isModern,
  LEGACY_VERSIONS,
  MODERN_VERSION,
  parseRequest,
  SUPPORTED_VERSIONS,
} from '@/lib/mcp/protocol'
import { MCP_TOOLS } from '@/services/mcp.tools'

const RESOURCE = 'https://rutia-six.vercel.app/api/mcp'
const SUPABASE = 'https://proyecto.supabase.co'

beforeEach(() => {
  vi.stubEnv('MCP_RESOURCE_URL', RESOURCE)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE)
  resetKeySetCache()
})
afterEach(() => {
  vi.unstubAllEnvs()
  resetKeySetCache()
})

// ── Autorización (spec §6.5) ──────────────────────────────────────────────────
// La validación de firma necesita el JWKS remoto, así que aquí se cubren los
// rechazos que ocurren ANTES de mirar la firma, que son los que puede provocar
// cualquiera sin credenciales.

describe('authenticate: rechazos sin llegar a la firma', () => {
  it('sin cabecera Authorization', async () => {
    const result = await authenticate(null)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.reason).toContain('sin cabecera')
  })

  it('una cabecera que no es Bearer', async () => {
    for (const cabecera of ['Basic abc123', 'token abc123', 'Bearer', '']) {
      const result = await authenticate(cabecera)
      expect(result.ok).toBe(false)
    }
  })

  it('acepta el esquema en cualquier caja (RFC 6750) y recorta espacios', async () => {
    // no llega a validar la firma (no hay red), pero el fallo YA no es de forma
    const result = await authenticate('  bearer   un.token.cualquiera  ')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.reason).not.toContain('no es Bearer')
  })

  it('sin MCP_RESOURCE_URL lanza error de configuración, no un 401 silencioso', async () => {
    vi.stubEnv('MCP_RESOURCE_URL', '')
    await expect(authenticate('Bearer x.y.z')).rejects.toThrow(McpConfigError)
  })
})

describe('emisor y reto de autenticación', () => {
  it('el emisor es exacto, sin barra final duplicada', () => {
    expect(issuer()).toBe(`${SUPABASE}/auth/v1`)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `${SUPABASE}/`)
    expect(issuer()).toBe(`${SUPABASE}/auth/v1`)
  })

  it('el reto apunta a los metadatos para que el cliente arranque OAuth solo', () => {
    const reto = challengeHeader()
    expect(reto).toContain('Bearer resource_metadata=')
    expect(reto).toContain('https://rutia-six.vercel.app/.well-known/oauth-protected-resource')
    expect(reto).toContain('scope=')
  })
})

describe('metadatos RFC 9728', () => {
  it('declara el recurso y a quién pedirle el token', () => {
    const meta = protectedResourceMetadata()
    expect(meta.resource).toBe(RESOURCE)
    expect(meta.authorization_servers).toEqual([`${SUPABASE}/auth/v1`])
    expect(meta.bearer_methods_supported).toEqual(['header'])
  })

  it('solo anuncia scopes que Supabase acepta: uno propio rompería el flujo', () => {
    const scopes = protectedResourceMetadata().scopes_supported as string[]
    const admitidos = ['openid', 'profile', 'email', 'phone', 'offline_access']
    for (const scope of scopes) {
      expect(admitidos).toContain(scope)
    }
  })

  it('el recurso de los metadatos y la audiencia que se valida son el MISMO', () => {
    // si divergen, el cliente pide un token para una audiencia que luego
    // rechazamos, y el síntoma es imposible de diagnosticar desde fuera
    expect(protectedResourceMetadata().resource).toBe(resourceUrl())
  })
})

describe('checkOrigin: quién puede llamar desde un navegador', () => {
  it('sin Origin se permite: los clientes de verdad llaman de servidor a servidor', () => {
    expect(checkOrigin(null)).toEqual({ allowed: true, origin: null })
  })

  it('con Origin y sin lista configurada, se rechaza', () => {
    // por defecto no hay orígenes de navegador autorizados
    expect(allowedOrigins()).toEqual([])
    expect(checkOrigin('https://evil.example')).toEqual({ allowed: false })
  })

  it('con lista configurada, solo pasa el que está y se devuelve ESE origen', () => {
    vi.stubEnv('MCP_ALLOWED_ORIGINS', 'http://localhost:6274, https://inspector.example')
    expect(checkOrigin('http://localhost:6274')).toEqual({
      allowed: true,
      origin: 'http://localhost:6274',
    })
    expect(checkOrigin('https://inspector.example')).toEqual({
      allowed: true,
      origin: 'https://inspector.example',
    })
    // un comodín autorizaría a cualquiera: esto no debe pasar
    expect(checkOrigin('https://evil.example')).toEqual({ allowed: false })
  })

  it('la coincidencia es exacta: ni subdominios ni prefijos', () => {
    vi.stubEnv('MCP_ALLOWED_ORIGINS', 'https://app.example')
    for (const falso of [
      'https://app.example.evil.com',
      'https://evil.app.example',
      'http://app.example',
      'https://app.example/',
    ]) {
      expect(checkOrigin(falso)).toEqual({ allowed: false })
    }
  })
})

// ── Protocolo ─────────────────────────────────────────────────────────────────

function rpc(method: string, params?: Record<string, unknown>, id: string | number = 1) {
  return { jsonrpc: '2.0' as const, id, method, params }
}

const opciones = {
  headerVersion: null,
  headerMethod: null,
  headerName: null,
  tools: MCP_TOOLS,
  runTool: async () => ({ text: '{"ok":true}', isError: false }),
}

describe('parseRequest', () => {
  it('acepta una petición JSON-RPC válida', () => {
    const result = parseRequest(rpc('tools/list'))
    expect(result.ok).toBe(true)
  })

  it('rechaza lo que no es JSON-RPC 2.0', () => {
    for (const malo of [null, 'texto', 42, {}, { jsonrpc: '1.0', method: 'x' }, { jsonrpc: '2.0' }]) {
      const result = parseRequest(malo)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.response.status).toBe(400)
      expect(result.response.body?.error).toMatchObject({ code: ERROR_CODES.invalidRequest })
    }
  })
})

describe('detección de la era del protocolo', () => {
  it('la versión de _meta manda sobre la cabecera', () => {
    const request = rpc('tools/list', {
      _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN_VERSION },
    })
    expect(declaredVersion(request, '2025-11-25')).toBe(MODERN_VERSION)
  })

  it('sin _meta se usa la cabecera', () => {
    expect(declaredVersion(rpc('tools/list'), '2025-11-25')).toBe('2025-11-25')
  })

  it('solo la revisión nueva es «moderna»', () => {
    expect(isModern(MODERN_VERSION)).toBe(true)
    expect(isModern('2025-11-25')).toBe(false)
    expect(isModern(null)).toBe(false)
  })
})

describe('era moderna (2026-07-28)', () => {
  // la era moderna exige AMBOS campos en cada petición
  const meta = {
    _meta: {
      'io.modelcontextprotocol/protocolVersion': MODERN_VERSION,
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  }
  const modernas = { headerVersion: MODERN_VERSION }

  it('server/discover es obligatorio y declara capacidades y caché', async () => {
    const response = await dispatch(rpc('server/discover', meta), {
      ...opciones,
      ...modernas,
      headerMethod: 'server/discover',
    })
    expect(response.status).toBe(200)
    const result = response.body?.result as Record<string, unknown>
    expect(result.resultType).toBe('complete')
    expect(result.supportedVersions).toEqual(SUPPORTED_VERSIONS)
    expect(result.capabilities).toEqual({ tools: {} })
    expect(typeof result.ttlMs).toBe('number')
    expect(result.cacheScope).toBe('public')
  })

  it('tools/list devuelve las 7 herramientas con los campos que exige la revisión', async () => {
    const response = await dispatch(rpc('tools/list', meta), {
      ...opciones,
      ...modernas,
      headerMethod: 'tools/list',
    })
    const result = response.body?.result as Record<string, unknown>
    expect((result.tools as unknown[]).length).toBe(7)
    expect(result.resultType).toBe('complete')
    expect(result.cacheScope).toBe('private')
  })

  it('una cabecera que no coincide con el cuerpo se rechaza en vez de adivinar', async () => {
    const desajusteMetodo = await dispatch(rpc('tools/list', meta), {
      ...opciones,
      ...modernas,
      headerMethod: 'tools/call',
    })
    expect(desajusteMetodo.status).toBe(400)
    expect(desajusteMetodo.body?.error).toMatchObject({ code: ERROR_CODES.headerMismatch })

    const desajusteVersion = await dispatch(rpc('tools/list', meta), {
      ...opciones,
      headerVersion: '2025-11-25',
      headerMethod: 'tools/list',
    })
    expect(desajusteVersion.body?.error).toMatchObject({ code: ERROR_CODES.headerMismatch })
  })

  it('una cabecera obligatoria AUSENTE también se rechaza: ausencia no es coincidencia', async () => {
    // sin MCP-Protocol-Version pero con la era moderna declarada en el cuerpo
    const sinVersion = await dispatch(rpc('tools/list', meta), { ...opciones, headerMethod: 'tools/list' })
    expect(sinVersion.status).toBe(400)
    expect(sinVersion.body?.error).toMatchObject({ code: ERROR_CODES.headerMismatch })

    // sin Mcp-Method
    const sinMetodo = await dispatch(rpc('tools/list', meta), { ...opciones, ...modernas })
    expect(sinMetodo.body?.error).toMatchObject({ code: ERROR_CODES.headerMismatch })

    // sin Mcp-Name en tools/call
    const sinNombre = await dispatch(
      rpc('tools/call', { ...meta, name: 'get_routine', arguments: {} }),
      { ...opciones, ...modernas, headerMethod: 'tools/call' },
    )
    expect(sinNombre.body?.error).toMatchObject({ code: ERROR_CODES.headerMismatch })
  })

  it('una cabecera moderna con un cuerpo que dice legado no se cuela sin validar', async () => {
    // si solo se mirara la versión efectiva, este caso pasaría de largo
    const response = await dispatch(
      rpc('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2025-11-25' } }),
      { ...opciones, headerVersion: MODERN_VERSION, headerMethod: 'tools/list' },
    )
    expect(response.status).toBe(400)
    expect(response.body?.error).toMatchObject({ code: ERROR_CODES.headerMismatch })
  })

  it('faltan los campos obligatorios de _meta: -32602', async () => {
    const sinCapacidades = await dispatch(
      rpc('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN_VERSION } }),
      { ...opciones, ...modernas, headerMethod: 'tools/list' },
    )
    expect(sinCapacidades.status).toBe(400)
    expect(sinCapacidades.body?.error).toMatchObject({ code: ERROR_CODES.invalidParams })

    // versión solo en la cabecera: el _meta obligatorio sigue faltando
    const sinMeta = await dispatch(rpc('tools/list'), {
      ...opciones,
      ...modernas,
      headerMethod: 'tools/list',
    })
    expect(sinMeta.body?.error).toMatchObject({ code: ERROR_CODES.invalidParams })
  })

  it('Mcp-Name debe coincidir con la herramienta pedida, y se decodifica antes', async () => {
    const desajuste = await dispatch(
      rpc('tools/call', { ...meta, name: 'get_routine', arguments: {} }),
      { ...opciones, ...modernas, headerMethod: 'tools/call', headerName: 'create_item' },
    )
    expect(desajuste.body?.error).toMatchObject({ code: ERROR_CODES.headerMismatch })

    // el mismo nombre codificado con el centinela sí debe casar
    const codificado = `=?base64?${Buffer.from('get_routine', 'utf8').toString('base64')}?=`
    const valido = await dispatch(
      rpc('tools/call', { ...meta, name: 'get_routine', arguments: {} }),
      { ...opciones, ...modernas, headerMethod: 'tools/call', headerName: codificado },
    )
    expect(valido.status).toBe(200)
  })

  it('una versión desconocida dice cuál se pidió y cuáles se soportan', async () => {
    const response = await dispatch(
      rpc('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2030-01-01' } }),
      opciones,
    )
    expect(response.status).toBe(400)
    expect(response.body?.error).toMatchObject({ code: ERROR_CODES.unsupportedProtocolVersion })
    const data = (response.body?.error as Record<string, unknown>).data as Record<string, unknown>
    expect(data.requested).toBe('2030-01-01')
    expect(data.supported).toEqual(SUPPORTED_VERSIONS)
  })
})

describe('notificaciones y correlación de id', () => {
  it('un cuerpo SIN id no se ejecuta y responde 202: es una notificación', async () => {
    let ejecutada = false
    const response = await dispatch(
      { jsonrpc: '2.0', method: 'tools/call', params: { name: 'clear_day', arguments: { day: 0 } } },
      {
        ...opciones,
        runTool: async () => {
          ejecutada = true
          return { text: '{}', isError: false }
        },
      },
    )

    // lo importante: NO se borró nada
    expect(ejecutada).toBe(false)
    expect(response.status).toBe(202)
    expect(response.body).toBeNull()
  })

  it('un error nunca lleva id: null; se omite si no se pudo leer', async () => {
    const result = parseRequest({ jsonrpc: '2.0' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.body).not.toHaveProperty('id')
  })

  it('un error de una petición con id conserva ese id', async () => {
    const response = await dispatch(rpc('metodo/inexistente', undefined, 42), opciones)
    expect(response.body?.id).toBe(42)
  })
})

describe('era legado (los clientes de hoy)', () => {
  it('initialize acuerda la versión que pide el cliente si la soportamos', async () => {
    const response = await dispatch(
      rpc('initialize', { protocolVersion: '2025-11-25' }),
      opciones,
    )
    const result = response.body?.result as Record<string, unknown>
    expect(result.protocolVersion).toBe('2025-11-25')
    expect(result.serverInfo).toMatchObject({ name: 'rutia' })
  })

  it('si pide una versión que no soportamos, se le responde con la nuestra', async () => {
    const response = await dispatch(rpc('initialize', { protocolVersion: '2024-01-01' }), opciones)
    const result = response.body?.result as Record<string, unknown>
    expect(result.protocolVersion).toBe(LEGACY_VERSIONS[0])
  })

  it('las notificaciones no llevan cuerpo: 202', async () => {
    const response = await dispatch(rpc('notifications/initialized'), opciones)
    expect(response.status).toBe(202)
    expect(response.body).toBeNull()
  })

  it('ping sigue respondiendo aunque desapareciera de la revisión nueva', async () => {
    const response = await dispatch(rpc('ping'), opciones)
    expect(response.status).toBe(200)
    expect(response.body?.result).toBeDefined()
  })

  it('tools/list funciona sin declarar versión (cliente legado)', async () => {
    const response = await dispatch(rpc('tools/list'), opciones)
    const result = response.body?.result as Record<string, unknown>
    expect((result.tools as unknown[]).length).toBe(7)
  })
})

describe('tools/call', () => {
  it('pasa nombre y argumentos al ejecutor y devuelve el contenido', async () => {
    const llamadas: { name: string; args: Record<string, unknown> }[] = []
    const response = await dispatch(
      rpc('tools/call', { name: 'create_item', arguments: { title: 'Pilates' } }),
      {
        ...opciones,
        runTool: async (name, args) => {
          llamadas.push({ name, args })
          return { text: '{"ok":true}', isError: false }
        },
      },
    )
    expect(llamadas).toEqual([{ name: 'create_item', args: { title: 'Pilates' } }])
    const result = response.body?.result as Record<string, unknown>
    expect(result.content).toEqual([{ type: 'text', text: '{"ok":true}' }])
    expect(result.isError).toBe(false)
  })

  it('un error de la herramienta viaja como isError, no como error de JSON-RPC', async () => {
    const response = await dispatch(rpc('tools/call', { name: 'create_item', arguments: {} }), {
      ...opciones,
      runTool: async () => ({ text: '{"ok":false,"reason":"conflict"}', isError: true }),
    })
    // el protocolo funcionó; lo que falló es la herramienta
    expect(response.status).toBe(200)
    expect(response.body?.error).toBeUndefined()
    expect((response.body?.result as Record<string, unknown>).isError).toBe(true)
  })

  it('sin nombre de herramienta es -32602', async () => {
    const response = await dispatch(rpc('tools/call', { arguments: {} }), opciones)
    expect(response.body?.error).toMatchObject({ code: ERROR_CODES.invalidParams })
  })

  it('un método desconocido es -32601 con 404', async () => {
    const response = await dispatch(rpc('resources/read'), opciones)
    expect(response.status).toBe(404)
    expect(response.body?.error).toMatchObject({ code: ERROR_CODES.methodNotFound })
  })
})

describe('catálogo de herramientas MCP', () => {
  it('son las 6 del chat más la de lectura', () => {
    const nombres = MCP_TOOLS.map((tool) => tool.name)
    expect(nombres).toContain('get_routine')
    for (const esperada of [
      'create_item',
      'update_item',
      'delete_items',
      'clear_day',
      'bulk_create_items',
      'set_completed',
    ]) {
      expect(nombres).toContain(esperada)
    }
    expect(nombres).toHaveLength(7)
  })

  it('ninguna expone user_id: lo pone el servidor desde el token (spec §6.2)', () => {
    for (const tool of MCP_TOOLS) {
      expect(JSON.stringify(tool.inputSchema)).not.toContain('user_id')
    }
  })

  it('get_routine no acepta argumentos', () => {
    const lectura = MCP_TOOLS.find((tool) => tool.name === 'get_routine')
    expect(lectura?.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
  })

  it('todas describen para qué sirven: son el único «prompt» de esta puerta', () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(40)
    }
  })
})
