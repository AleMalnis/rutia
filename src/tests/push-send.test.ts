import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// El brazo de envío (spec §4 «Avisos push», etapa B): autenticación por
// secreto compartido en tiempo constante, validación Zod del lote, un envío
// por suscripción con TTL, y los 404/410 vuelven como muertos para que el
// planificador los barra. web-push se simula: aquí se prueba el contrato.

const sendNotification = vi.fn()
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: (...args: unknown[]) => sendNotification(...args) },
}))

const { POST } = await import('@/app/api/push/send/route')

const ENV = {
  PUSH_DISPATCH_SECRET: 'secreto-de-prueba',
  VAPID_PUBLIC_KEY: 'clave-publica',
  VAPID_PRIVATE_KEY: 'clave-privada',
  VAPID_SUBJECT: 'mailto:test@rutia.local',
}

function item(endpoint: string) {
  return {
    endpoint,
    p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFg',
    auth: 'FPssNDTKnInHVndSTdbKFw',
    title: 'Medicación',
    body: 'a las 09:00',
    tag: 'item:2026-08-21',
  }
}

function request(body: unknown, secret = ENV.PUSH_DISPATCH_SECRET) {
  return new Request('http://localhost/api/push/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/push/send', () => {
  beforeEach(() => {
    sendNotification.mockReset()
    for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sin configuración del servidor responde 503', async () => {
    vi.stubEnv('PUSH_DISPATCH_SECRET', '')
    const response = await POST(request([item('https://push.example/a')]))
    expect(response.status).toBe(503)
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('con secreto equivocado responde 401 sin enviar nada', async () => {
    const response = await POST(request([item('https://push.example/a')], 'otro-secreto'))
    expect(response.status).toBe(401)
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('con lote inválido responde 400', async () => {
    const response = await POST(request([{ endpoint: 'http://sin-https', title: 'x' }]))
    expect(response.status).toBe(400)
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('envía cada aviso con su payload y TTL de 5 minutos', async () => {
    sendNotification.mockResolvedValue(undefined)
    const response = await POST(request([item('https://push.example/a'), item('https://push.example/b')]))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result).toMatchObject({ sent: 2, dead: [], failed: 0 })
    expect(sendNotification).toHaveBeenCalledTimes(2)
    const [subscription, payload, options] = sendNotification.mock.calls[0]
    expect(subscription).toMatchObject({ endpoint: 'https://push.example/a' })
    expect(JSON.parse(payload as string)).toMatchObject({ title: 'Medicación', body: 'a las 09:00' })
    expect(options).toMatchObject({ TTL: 300 })
  })

  it('devuelve como muertos los 404/410 y cuenta aparte otros fallos', async () => {
    sendNotification
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }))
      .mockResolvedValueOnce(undefined)
    const response = await POST(
      request([item('https://push.example/muerta'), item('https://push.example/rota'), item('https://push.example/viva')]),
    )
    const result = await response.json()

    expect(result.sent).toBe(1)
    expect(result.dead).toEqual(['https://push.example/muerta'])
    expect(result.failed).toBe(1)
  })
})
