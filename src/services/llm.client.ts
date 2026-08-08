import Anthropic from '@anthropic-ai/sdk'

// LLMClient (spec §6.4): la llamada al proveedor de IA vive detrás de esta
// interfaz propia. AgentService solo conoce estos tipos neutros; cambiar de
// proveedor es reescribir únicamente este archivo. La API key es secreta y
// SOLO de servidor: jamás llega al cliente ni se registra en logs.

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
  content: string
  isError: boolean
}

// La conversación como la ve el agente: turnos de texto y turnos de
// herramientas. El historial persistido solo guarda texto; los turnos de
// herramientas existen dentro de una misma petición (el bucle agéntico).
// `raw` transporta el contenido del proveedor INTACTO dentro del bucle: los
// modelos con thinking exigen que sus bloques vuelvan sin tocar en el mismo
// turno assistant, o la ronda de herramientas devuelve 400. Nunca se persiste.
export type LLMTurn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls: LLMToolCall[]; raw?: unknown }
  | { role: 'tool_results'; results: LLMToolResult[] }

export type LLMReply = { text: string; toolCalls: LLMToolCall[]; raw?: unknown }

export type LLMClient = {
  complete(input: { system: string; turns: LLMTurn[]; tools: LLMToolDef[] }): Promise<LLMReply>
}

/** Fallo del proveedor, tipado para que la ruta lo traduzca sin conocer el SDK. */
export class LLMError extends Error {
  readonly kind: 'missing_key' | 'provider'

  constructor(kind: 'missing_key' | 'provider', message: string) {
    super(message)
    this.name = 'LLMError'
    this.kind = kind
  }
}

// Modelo del MVP (spec §6.4). Se puede fijar otro con ANTHROPIC_MODEL sin
// tocar código (p. ej. para probar un modelo nuevo en preview).
const DEFAULT_MODEL = 'claude-sonnet-4-6'

// Las respuestas del agente son cortas (1-3 frases, spec §6.3 regla 12); el
// margen extra es para las llamadas a herramientas de un lote grande.
const MAX_TOKENS = 4096

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

export function createAnthropicClient(): LLMClient {
  return {
    async complete({ system, turns, tools }) {
      // se comprueba aquí y no al construir: así el resto de la app (p. ej.
      // leer el historial) funciona aunque la clave no esté configurada
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) {
        throw new LLMError('missing_key', 'Falta ANTHROPIC_API_KEY en el entorno del servidor.')
      }

      const client = new Anthropic({ apiKey })
      try {
        const response = await client.messages.create({
          model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
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
        })

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
        return { text, toolCalls, raw: response.content }
      } catch (error) {
        // se traduce a un error propio SIN adjuntar la petición (contiene la
        // rutina del usuario); el mensaje del SDK no incluye la API key
        if (error instanceof Anthropic.APIError) {
          throw new LLMError('provider', `Anthropic ${error.status ?? 'error'}: ${error.message}`)
        }
        throw error
      }
    },
  }
}
