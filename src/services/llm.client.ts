import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI, type Content, type Part } from '@google/genai'
import OpenAI from 'openai'
import type { LlmProviderId } from '@/lib/llm-providers'

// LLMClient (spec §6.4): los tres proveedores del BYOK viven en este archivo,
// detrás de una interfaz neutra. AgentService no sabe cuál hay debajo; añadir
// un proveedor es añadir aquí una implementación y su entrada en el factory.
// La clave llega SIEMPRE por parámetro desde los ajustes cifrados del usuario:
// aquí no se lee ninguna clave del entorno ni se registra nada sensible.

export type LLMToolDef = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type LLMToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
}

export type LLMToolResult = {
  toolCallId: string
  /** Nombre de la herramienta: Gemini empareja resultados por nombre, no por id. */
  name: string
  content: string
  isError: boolean
}

// La conversación como la ve el agente: turnos de texto y turnos de
// herramientas. El historial persistido solo guarda texto; los turnos de
// herramientas existen dentro de una misma petición (el bucle agéntico).
// `raw` transporta el contenido del proveedor INTACTO dentro del bucle:
// Anthropic exige devolver sus bloques thinking sin tocar, y OpenAI exige
// reenviar sus items de razonamiento junto a los resultados. Nunca se
// persiste y nunca cruza de un proveedor a otro (vive en una sola petición).
export type LLMTurn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls: LLMToolCall[]; raw?: unknown }
  | { role: 'tool_results'; results: LLMToolResult[] }

export type LLMReply = {
  text: string
  toolCalls: LLMToolCall[]
  raw?: unknown
  /** El proveedor cortó la respuesta (tokens, seguridad…): no fiarse de ella. */
  truncated?: boolean
}

export type LLMClient = {
  complete(input: {
    system: string
    turns: LLMTurn[]
    tools: LLMToolDef[]
    /** Fecha límite compartida de toda la petición (ver AgentService). */
    signal?: AbortSignal
  }): Promise<LLMReply>
}

/**
 * Fallo del proveedor, tipado para que la ruta lo traduzca sin conocer SDKs.
 * bad_key: clave inválida/revocada → revisar Ajustes. quota: cuenta sin
 * crédito o cuota agotada → arreglar facturación (condición PERMANENTE, no
 * «vuelve a intentarlo»). timeout: se agotó el presupuesto de la petición.
 * provider: fallo transitorio del servicio.
 */
export class LLMError extends Error {
  readonly kind: 'bad_key' | 'quota' | 'timeout' | 'provider'

  constructor(kind: 'bad_key' | 'quota' | 'timeout' | 'provider', message: string) {
    super(message)
    this.name = 'LLMError'
    this.kind = kind
  }
}

// Un proveedor colgado no puede comerse el presupuesto de la función
// serverless: los SDKs traen timeouts de 10 min y reintentos propios, muy por
// encima de lo que Vercel permite.
//
// Anthropic y OpenAI se quedan SIN reintentos a propósito. Su espera entre
// intentos es un setTimeout que no mira el signal, y el valor de la cabecera
// `retry-after` no está acotado: ante un 429 con `retry-after: 30` duermen
// esos 30 s enteros aunque la fecha límite haya vencido hace rato, y para
// entonces la plataforma ya ha matado la función. Con cero reintentos la
// única espera es el fetch, que el signal sí aborta; a cambio, un fallo
// transitorio se le cuenta al usuario en vez de reintentarse solo, que en un
// chat con tope de tiempo es el intercambio correcto (un reintento a los 30 s
// no llegaría a tiempo de todos modos).
const STAINLESS_MAX_RETRIES = 0
// Google sí comprueba el signal entre reintentos y su espera es de ~1 s, así
// que ahí un reintento sigue mereciendo la pena.
const GOOGLE_ATTEMPTS = 2

/** Distingue «lo hemos cortado nosotros» de un fallo real del proveedor. */
function abortedFailure(signal: AbortSignal | undefined, provider: string): LLMError | null {
  if (signal?.aborted !== true) return null
  return new LLMError('timeout', `${provider}: petición cancelada por tiempo.`)
}

// Modelos por defecto (spec §6.4); ajustables por env sin tocar código.
const DEFAULT_MODELS: Record<LlmProviderId, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5.6-terra',
  google: 'gemini-2.5-flash',
}

function modelFor(provider: LlmProviderId): string {
  const override = {
    anthropic: process.env.ANTHROPIC_MODEL,
    openai: process.env.OPENAI_MODEL,
    google: process.env.GOOGLE_MODEL,
  }[provider]
  return override || DEFAULT_MODELS[provider]
}

// Las respuestas del agente son cortas (1-3 frases, spec §6.3 regla 12), pero
// el presupuesto también paga el razonamiento interno de los modelos que
// piensan (Gemini 2.5, gpt-5.x) y los lotes grandes de bulk_create_items:
// corto de tokens, el proveedor devuelve una respuesta vacía truncada.
const MAX_TOKENS = 8192

// El modelo puede truncar los argumentos si se queda sin tokens: mejor un
// objeto vacío (que Zod rechaza con mensaje claro) que reventar el bucle.
function parseJsonArguments(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed != null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// ── Anthropic (Messages API) ─────────────────────────────────────────────────

function toAnthropicMessages(turns: LLMTurn[]): Anthropic.MessageParam[] {
  return turns.map((turn): Anthropic.MessageParam => {
    if (turn.role === 'user') {
      return { role: 'user', content: turn.text }
    }
    if (turn.role === 'assistant') {
      // dentro del bucle vuelve el contenido tal cual lo dio el proveedor
      // (conserva bloques thinking); el historial replayado no trae raw
      if (turn.raw != null) {
        return { role: 'assistant', content: turn.raw as Anthropic.ContentBlockParam[] }
      }
      const content: Anthropic.ContentBlockParam[] = []
      if (turn.text.length > 0) content.push({ type: 'text', text: turn.text })
      for (const call of turn.toolCalls) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
      }
      return { role: 'assistant', content }
    }
    return {
      role: 'user',
      content: turn.results.map(
        (result): Anthropic.ToolResultBlockParam => ({
          type: 'tool_result',
          tool_use_id: result.toolCallId,
          content: result.content,
          is_error: result.isError,
        }),
      ),
    }
  })
}

function createAnthropicClient(apiKey: string): LLMClient {
  // el cliente se construye UNA vez por petición, no en cada ronda del bucle
  const client = new Anthropic({ apiKey, maxRetries: STAINLESS_MAX_RETRIES })
  return {
    async complete({ system, turns, tools, signal }) {
      try {
        const response = await client.messages.create(
          {
            model: modelFor('anthropic'),
            max_tokens: MAX_TOKENS,
            system,
            messages: toAnthropicMessages(turns),
            tools: tools.map(
              (tool): Anthropic.Tool => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
              }),
            ),
          },
          { signal },
        )

        const text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('')
        const toolCalls = response.content
          .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
          .map((block) => ({
            id: block.id,
            name: block.name,
            input: (block.input ?? {}) as Record<string, unknown>,
          }))
        return {
          text,
          toolCalls,
          raw: response.content,
          truncated: response.stop_reason === 'max_tokens',
        }
      } catch (error) {
        // sin adjuntar la petición (contiene la rutina del usuario) y sin la
        // clave (los SDKs no la incluyen en sus mensajes de error)
        const aborted = abortedFailure(signal, 'Anthropic')
        if (aborted) throw aborted
        if (error instanceof Anthropic.APIError) {
          if (error.status === 401 || error.status === 403) {
            throw new LLMError('bad_key', `Anthropic ${error.status}: clave rechazada.`)
          }
          // condición permanente de la cuenta, no un fallo transitorio
          if (error.status === 400 && /credit balance/i.test(error.message)) {
            throw new LLMError('quota', 'Anthropic: cuenta sin crédito.')
          }
          throw new LLMError('provider', `Anthropic ${error.status ?? 'error'}: ${error.message}`)
        }
        throw error
      }
    },
  }
}

// ── OpenAI (Responses API) ───────────────────────────────────────────────────

/** Exportado solo para tests. */
export function toOpenAIInput(turns: LLMTurn[]): OpenAI.Responses.ResponseInputItem[] {
  const input: OpenAI.Responses.ResponseInputItem[] = []
  for (const turn of turns) {
    if (turn.role === 'user') {
      input.push({ role: 'user', content: turn.text })
    } else if (turn.role === 'assistant') {
      if (turn.raw != null) {
        // los items de salida (razonamiento incluido) vuelven tal cual: la
        // Responses API exige reenviarlos junto a los function_call_output
        input.push(...(turn.raw as OpenAI.Responses.ResponseInputItem[]))
      } else if (turn.text.length > 0) {
        input.push({ role: 'assistant', content: turn.text })
      }
    } else {
      for (const result of turn.results) {
        input.push({
          type: 'function_call_output',
          call_id: result.toolCallId,
          output: result.content,
        })
      }
    }
  }
  return input
}

function createOpenAIClient(apiKey: string): LLMClient {
  const client = new OpenAI({ apiKey, maxRetries: STAINLESS_MAX_RETRIES })
  return {
    async complete({ system, turns, tools, signal }) {
      try {
        const response = await client.responses.create(
          {
            model: modelFor('openai'),
            max_output_tokens: MAX_TOKENS,
            instructions: system,
            input: toOpenAIInput(turns),
            tools: tools.map((tool) => ({
              type: 'function' as const,
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
              strict: false,
            })),
          },
          { signal },
        )

        const toolCalls = response.output
          .filter(
            (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
              item.type === 'function_call',
          )
          .map((item) => ({
            id: item.call_id,
            name: item.name,
            input: parseJsonArguments(item.arguments),
          }))
        return {
          text: response.output_text ?? '',
          toolCalls,
          raw: response.output,
          truncated: response.status === 'incomplete',
        }
      } catch (error) {
        const aborted = abortedFailure(signal, 'OpenAI')
        if (aborted) throw aborted
        if (error instanceof OpenAI.APIError) {
          if (error.status === 401 || error.status === 403) {
            throw new LLMError('bad_key', `OpenAI ${error.status}: clave rechazada.`)
          }
          // clave recién creada sin crédito: el caso más común del onboarding
          // BYOK; es permanente, no un «vuelve a intentarlo»
          if (error.code === 'insufficient_quota') {
            throw new LLMError('quota', 'OpenAI: cuenta sin crédito o cuota agotada.')
          }
          throw new LLMError('provider', `OpenAI ${error.status ?? 'error'}: ${error.message}`)
        }
        throw error
      }
    },
  }
}

// ── Google (Gemini, @google/genai) ───────────────────────────────────────────

/** Exportado solo para tests. */
export function toGeminiContents(turns: LLMTurn[]): Content[] {
  const mapped = turns.map((turn): Content => {
    if (turn.role === 'user') {
      return { role: 'user', parts: [{ text: turn.text }] }
    }
    if (turn.role === 'assistant') {
      if (turn.raw != null) return turn.raw as Content
      const parts: Part[] = []
      if (turn.text.length > 0) parts.push({ text: turn.text })
      for (const call of turn.toolCalls) {
        parts.push({ functionCall: { name: call.name, args: call.input } })
      }
      return { role: 'model', parts }
    }
    return {
      role: 'user',
      parts: turn.results.map(
        (result): Part => ({
          // Gemini empareja por nombre; el error va dentro del payload
          functionResponse: { name: result.name, response: { result: result.content } },
        }),
      ),
    }
  })

  // Gemini exige alternancia estricta user/model: dos turnos seguidos del
  // mismo rol (p. ej. un mensaje huérfano del historial + el mensaje nuevo)
  // se fusionan en un solo content con las parts concatenadas.
  const contents: Content[] = []
  for (const content of mapped) {
    const previous = contents.at(-1)
    if (previous != null && previous.role === content.role) {
      contents[contents.length - 1] = {
        ...previous,
        parts: [...(previous.parts ?? []), ...(content.parts ?? [])],
      }
    } else {
      contents.push(content)
    }
  }
  return contents
}

function createGoogleClient(apiKey: string): LLMClient {
  const client = new GoogleGenAI({
    apiKey,
    httpOptions: { retryOptions: { attempts: GOOGLE_ATTEMPTS } },
  })
  return {
    async complete({ system, turns, tools, signal }) {
      try {
        const response = await client.models.generateContent({
          model: modelFor('google'),
          contents: toGeminiContents(turns),
          config: {
            systemInstruction: system,
            maxOutputTokens: MAX_TOKENS,
            abortSignal: signal,
            tools: [
              {
                functionDeclarations: tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  parametersJsonSchema: tool.inputSchema,
                })),
              },
            ],
          },
        })

        const calls = response.functionCalls ?? []
        const toolCalls = calls.map((call, index) => ({
          id: call.id ?? `${index}:${call.name ?? 'tool'}`,
          name: call.name ?? '',
          input: (call.args ?? {}) as Record<string, unknown>,
        }))
        // cualquier parada que no sea STOP (MAX_TOKENS, SAFETY, MALFORMED_
        // FUNCTION_CALL…) o un prompt bloqueado invalidan la respuesta
        const finishReason = response.candidates?.[0]?.finishReason
        const truncated =
          (finishReason != null && finishReason !== 'STOP') ||
          response.promptFeedback?.blockReason != null
        return {
          text: response.text ?? '',
          toolCalls,
          raw: response.candidates?.[0]?.content ?? null,
          truncated,
        }
      } catch (error) {
        const aborted = abortedFailure(signal, 'Google')
        if (aborted) throw aborted
        const message = error instanceof Error ? error.message : String(error)
        // Google devuelve la clave inválida como 400 INVALID_ARGUMENT y la
        // clave deshabilitada/proyecto suspendido como PERMISSION_DENIED
        if (
          /api key not valid|api_key_invalid|unauthenticated|permission_denied|consumer .*suspended/i.test(
            message,
          )
        ) {
          throw new LLMError('bad_key', 'Google: clave rechazada.')
        }
        if (/resource_exhausted|quota/i.test(message)) {
          throw new LLMError('quota', 'Google: cuota agotada.')
        }
        throw new LLMError('provider', `Google: ${message}`)
      }
    },
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createLLMClient(provider: LlmProviderId, apiKey: string): LLMClient {
  switch (provider) {
    case 'anthropic':
      return createAnthropicClient(apiKey)
    case 'openai':
      return createOpenAIClient(apiKey)
    case 'google':
      return createGoogleClient(apiKey)
  }
}
