import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptSecret, encryptSecret, SecretConfigError } from '@/lib/crypto'
import type { LlmSettingsRepo } from '@/repositories/llm-settings.repo'
import { createLlmSettingsService } from '@/services/llm-settings.service'
import { toGeminiContents, toOpenAIInput, type LLMTurn } from '@/services/llm.client'

const USER = 'user-1'
const SECRET = 'un-secreto-de-pruebas-suficientemente-largo'

describe('crypto: cifrado de la clave BYOK', () => {
  beforeEach(() => {
    vi.stubEnv('LLM_KEY_SECRET', SECRET)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('cifra y descifra ida y vuelta, y el blob no contiene la clave en claro', () => {
    const blob = encryptSecret('sk-ant-testkey-12345678')
    expect(blob).not.toContain('sk-ant-testkey')
    expect(blob.startsWith('v1:')).toBe(true)
    expect(decryptSecret(blob)).toBe('sk-ant-testkey-12345678')
  })

  it('dos cifrados de la misma clave difieren (IV aleatorio)', () => {
    expect(encryptSecret('misma-clave-123456789012')).not.toBe(
      encryptSecret('misma-clave-123456789012'),
    )
  })

  it('un blob manipulado no descifra a basura: revienta con error de config', () => {
    const blob = encryptSecret('sk-ant-testkey-12345678')
    const [v, iv, data, tag] = blob.split(':')
    const tampered = [v, iv, data.slice(0, -4) + 'AAAA', tag].join(':')
    expect(() => decryptSecret(tampered)).toThrow(SecretConfigError)
  })

  it('con el secreto rotado, el blob antiguo falla de forma controlada', () => {
    const blob = encryptSecret('sk-ant-testkey-12345678')
    vi.stubEnv('LLM_KEY_SECRET', 'otro-secreto-distinto-y-tambien-largo')
    expect(() => decryptSecret(blob)).toThrow(SecretConfigError)
  })

  it('sin LLM_KEY_SECRET (o demasiado corto) no se cifra nada', () => {
    vi.stubEnv('LLM_KEY_SECRET', '')
    expect(() => encryptSecret('x'.repeat(30))).toThrow(SecretConfigError)
    vi.stubEnv('LLM_KEY_SECRET', 'corto')
    expect(() => encryptSecret('x'.repeat(30))).toThrow(SecretConfigError)
  })
})

describe('LlmSettingsService (BYOK, spec §6.4)', () => {
  beforeEach(() => {
    vi.stubEnv('LLM_KEY_SECRET', SECRET)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function mkRepo() {
    let row: { provider: 'anthropic' | 'openai' | 'google'; apiKeyEncrypted: string } | null = null
    const calls = { upsert: 0, remove: 0 }
    const repo: LlmSettingsRepo = {
      async get() {
        return row
      },
      async upsert(_u, provider, apiKeyEncrypted) {
        calls.upsert += 1
        row = { provider, apiKeyEncrypted }
      },
      async remove() {
        calls.remove += 1
        row = null
      },
    }
    return { repo, calls, row: () => row }
  }

  it('guarda cifrado: lo que llega al repositorio no es la clave en claro', async () => {
    const { repo, row } = mkRepo()
    const service = createLlmSettingsService({ repo })

    const result = await service.saveKey(USER, {
      provider: 'openai',
      apiKey: 'sk-proj-abcdefghijklmnop1234',
    })

    expect(result.ok).toBe(true)
    expect(row()?.apiKeyEncrypted).not.toContain('sk-proj')
    expect(await service.getCredentials(USER)).toEqual({
      provider: 'openai',
      apiKey: 'sk-proj-abcdefghijklmnop1234',
    })
  })

  it('el estado hacia el cliente solo lleva proveedor y últimos 4', async () => {
    const { repo } = mkRepo()
    const service = createLlmSettingsService({ repo })
    await service.saveKey(USER, { provider: 'google', apiKey: 'AIzaSyExample123456789xyz9' })

    expect(await service.getStatus(USER)).toEqual({ provider: 'google', last4: 'xyz9' })
  })

  it('rechaza proveedor desconocido y claves rotas sin tocar el repositorio', async () => {
    const { repo, calls } = mkRepo()
    const service = createLlmSettingsService({ repo })

    expect(await service.saveKey(USER, { provider: 'meta', apiKey: 'x'.repeat(30) })).toMatchObject(
      { ok: false, reason: 'invalid' },
    )
    expect(await service.saveKey(USER, { provider: 'openai', apiKey: 'corta' })).toMatchObject({
      ok: false,
      reason: 'invalid',
    })
    expect(
      await service.saveKey(USER, { provider: 'openai', apiKey: 'con espacios dentro de la clave' }),
    ).toMatchObject({ ok: false, reason: 'invalid' })
    expect(calls.upsert).toBe(0)
  })

  it('sin fila guardada, estado y credenciales son null', async () => {
    const service = createLlmSettingsService({ repo: mkRepo().repo })
    expect(await service.getStatus(USER)).toBeNull()
    expect(await service.getCredentials(USER)).toBeNull()
  })

  it('borrar la clave deja el chat sin credenciales', async () => {
    const { repo, calls } = mkRepo()
    const service = createLlmSettingsService({ repo })
    await service.saveKey(USER, { provider: 'anthropic', apiKey: 'sk-ant-abcdefghijklmnop' })

    await service.deleteKey(USER)

    expect(calls.remove).toBe(1)
    expect(await service.getCredentials(USER)).toBeNull()
  })
})

describe('mapeo de turnos por proveedor', () => {
  const turns: LLMTurn[] = [
    { role: 'user', text: 'hola' },
    { role: 'assistant', text: 'pregunta previa respondida', toolCalls: [] },
    { role: 'user', text: 'ponme pilates el sábado' },
    {
      role: 'assistant',
      text: '',
      toolCalls: [{ id: 'call_1', name: 'create_item', input: { title: 'Pilates' } }],
    },
    {
      role: 'tool_results',
      results: [
        { toolCallId: 'call_1', name: 'create_item', content: '{"ok":true}', isError: false },
      ],
    },
  ]

  it('OpenAI: user/assistant como mensajes y tool results como function_call_output', () => {
    const input = toOpenAIInput(turns)

    expect(input[0]).toEqual({ role: 'user', content: 'hola' })
    expect(input[1]).toEqual({ role: 'assistant', content: 'pregunta previa respondida' })
    expect(input.at(-1)).toEqual({
      type: 'function_call_output',
      call_id: 'call_1',
      output: '{"ok":true}',
    })
  })

  it('OpenAI: el raw del proveedor (razonamiento incluido) se reenvía tal cual', () => {
    const rawItems = [
      { type: 'reasoning', id: 'rs_1', summary: [] },
      { type: 'function_call', call_id: 'call_9', name: 'create_item', arguments: '{}' },
    ]
    const input = toOpenAIInput([
      { role: 'user', text: 'hola' },
      { role: 'assistant', text: '', toolCalls: [], raw: rawItems },
    ])

    expect(input.slice(1)).toEqual(rawItems)
  })

  it('Gemini: los resultados van como functionResponse emparejados por NOMBRE', () => {
    const contents = toGeminiContents(turns)

    expect(contents[0]).toEqual({ role: 'user', parts: [{ text: 'hola' }] })
    // el turno assistant sin raw reconstruye el functionCall
    expect(contents[3]).toEqual({
      role: 'model',
      parts: [{ functionCall: { name: 'create_item', args: { title: 'Pilates' } } }],
    })
    expect(contents.at(-1)).toEqual({
      role: 'user',
      parts: [
        { functionResponse: { name: 'create_item', response: { result: '{"ok":true}' } } },
      ],
    })
  })

  it('Gemini: dos turnos user seguidos se fusionan (la API exige alternancia)', () => {
    const contents = toGeminiContents([
      { role: 'user', text: 'mensaje huérfano (el proveedor falló aquella vez)' },
      { role: 'user', text: 'mensaje nuevo' },
    ])
    expect(contents).toHaveLength(1)
    expect(contents[0].parts).toEqual([
      { text: 'mensaje huérfano (el proveedor falló aquella vez)' },
      { text: 'mensaje nuevo' },
    ])
  })

  it('Gemini: el raw del proveedor se devuelve como el Content original', () => {
    const raw = { role: 'model', parts: [{ text: 'x' }, { functionCall: { name: 'f', args: {} } }] }
    const contents = toGeminiContents([
      { role: 'user', text: 'hola' },
      { role: 'assistant', text: 'x', toolCalls: [], raw },
    ])
    expect(contents[1]).toBe(raw)
  })
})
