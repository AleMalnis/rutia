import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRetryFetch } from '@/lib/supabase/fetch-retry'

// El reintento de PGRST303 (spec §7.2): un JWT recién emitido puede llegar a
// PostgREST con el `iat` «en el futuro» por desfase de reloj entre servidores
// de Supabase. Solo esa respuesta se reintenta; todo lo demás pasa tal cual.

function pgrstResponse(code: string): Response {
  return new Response(JSON.stringify({ code, message: 'JWT issued at future' }), { status: 401 })
}

describe('createRetryFetch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('devuelve la respuesta buena sin reintentar', async () => {
    const inner = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', inner)

    const response = await createRetryFetch()('https://x/rest/v1/items')
    expect(response.status).toBe(200)
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it('reintenta un PGRST303 y devuelve el resultado del reintento', async () => {
    const inner = vi
      .fn()
      .mockResolvedValueOnce(pgrstResponse('PGRST303'))
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', inner)

    const promise = createRetryFetch()('https://x/rest/v1/items', { method: 'POST', body: '{}' })
    await vi.advanceTimersByTimeAsync(1000)
    const response = await promise

    expect(response.status).toBe(200)
    expect(inner).toHaveBeenCalledTimes(2)
    // el reintento repite la petición original intacta
    expect(inner).toHaveBeenLastCalledWith('https://x/rest/v1/items', { method: 'POST', body: '{}' })
  })

  it('se rinde tras agotar los reintentos y el body sigue legible', async () => {
    const inner = vi.fn().mockImplementation(() => Promise.resolve(pgrstResponse('PGRST303')))
    vi.stubGlobal('fetch', inner)

    const promise = createRetryFetch()('https://x/rest/v1/items')
    // por pasos, no de golpe: así el test clava cada retardo (1 s y luego 2 s)
    await vi.advanceTimersByTimeAsync(1000)
    expect(inner).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1999)
    expect(inner).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1)
    const response = await promise

    expect(inner).toHaveBeenCalledTimes(3)
    expect(response.status).toBe(401)
    // isFreshJwtRejection lee con clone(): el original llega sin consumir
    await expect(response.json()).resolves.toMatchObject({ code: 'PGRST303' })
  })

  it('no reintenta otros errores de PostgREST (un caducado no se cura esperando)', async () => {
    const inner = vi.fn().mockResolvedValue(pgrstResponse('PGRST301'))
    vi.stubGlobal('fetch', inner)

    const response = await createRetryFetch()('https://x/rest/v1/items')
    expect(response.status).toBe(401)
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it('no reintenta un 401 sin JSON (no es de PostgREST)', async () => {
    const inner = vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    vi.stubGlobal('fetch', inner)

    const response = await createRetryFetch()('https://x/auth/v1/user')
    expect(response.status).toBe(401)
    expect(inner).toHaveBeenCalledTimes(1)
  })
})
