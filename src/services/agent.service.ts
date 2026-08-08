import { z } from 'zod'
import { DAY_NAMES } from '@/lib/calendar'
import type { ChatMessage, ChatRepo } from '@/repositories/chat.repo'
import { AGENT_TOOLS, executeAgentTool, type ToolExecution } from '@/services/agent.tools'
import type { LLMClient, LLMToolResult, LLMTurn } from '@/services/llm.client'
import type { RoutineService, TodayResult } from '@/services/routine.service'

// AgentService (spec §6.1): el bucle agéntico. Construye el contexto con la
// rutina completa serializada (no hay herramienta de lectura), llama al LLM,
// ejecuta sus herramientas contra RoutineService y repite hasta que responde
// solo texto, con un máximo de 5 rondas por mensaje (coste y seguridad).

const MAX_ROUNDS = 5
// Presupuesto de TODA la petición, compartido por las hasta 5 llamadas al
// proveedor. Sin él, los timeouts propios de los SDKs (10 min) más sus
// reintentos superarían de largo el límite de ejecución de la función
// serverless, y Vercel cortaría con un 504 mudo. Se deja margen bajo el
// maxDuration de /api/chat para poder responder con un mensaje útil.
const REQUEST_BUDGET_MS = 50_000
// contexto conversacional: los últimos N mensajes persistidos (spec §6.1)
const HISTORY_LIMIT = 12
// rate limit (spec §8): 20 mensajes de usuario cada 5 minutos
const RATE_LIMIT_MAX_MESSAGES = 20
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000

// El tope de longitud acota el coste de una petición; 2000 caracteres dan de
// sobra para dictar una rutina inicial completa.
const NUL_CHAR = String.fromCharCode(0)
const chatMessageSchema = z
  .string('Escribe un mensaje.')
  .trim()
  .min(1, 'Escribe un mensaje.')
  .max(2000, 'El mensaje no puede superar los 2000 caracteres.')
  .refine((value) => !value.includes(NUL_CHAR), 'El mensaje contiene caracteres no válidos.')

export type AgentChatResult =
  | { ok: true; reply: string; affectedItemIds: string[]; mutated: boolean }
  | { ok: false; reason: 'invalid' | 'rate_limited'; message: string }

export type AgentDeps = {
  routine: RoutineService
  chat: ChatRepo
  // null cuando solo se necesita el historial (p. ej. al renderizar la
  // página): la clave BYOK del usuario puede no existir todavía
  llm: LLMClient | null
}

// ── Serialización del contexto (spec §6.3) ───────────────────────────────────

function buildSystemPrompt(input: {
  today: TodayResult
  routineJson: string
  categoriesJson: string
  completedJson: string
}): string {
  const { today } = input
  return `Eres RutIA, un asistente que gestiona la rutina semanal recurrente del usuario.
Fecha actual: ${today.date} (${DAY_NAMES[today.weekday]}). Zona horaria del usuario: ${today.timeZone}.

RUTINA ACTUAL DEL USUARIO:
${input.routineJson}

CATEGORÍAS DISPONIBLES (usa su id como category_id):
${input.categoriesJson}

CHECKS DE HOY:
${input.completedJson}

REGLAS:
1. Cuando el usuario pida cambios, usa las herramientas. No describas cambios sin ejecutarlos.
2. Usa siempre los item_id que aparecen en la rutina actual. Nunca inventes IDs.
3. Horas en formato 24 h. La semana empieza en lunes (day=0). «Todos los días» = days=[0,1,2,3,4,5,6]; «entre semana» = [0,1,2,3,4].
4. Usa kind='reminder' para eventos puntuales (medicación, llamadas, riego…) y kind='block' para franjas con duración.
5. Si una acción borra o modifica 3+ ítems, pide confirmación antes de ejecutar.
6. Si detectas un conflicto de horario entre bloques, no lo pises: explica el choque y propone 1-2 alternativas.
7. Si la petición es ambigua (¿qué días?, ¿qué hora?), haz UNA pregunta corta.
8. Si el usuario dicta su dieta o una dosis, regístrala tal cual en detail. No inventes menús, no cambies dosis, no des consejos médicos ni nutricionales; si te los piden, recomienda consultar a un profesional.
9. «¿Qué me toca hoy/ahora?» se responde leyendo la rutina y los checks del contexto, sin herramientas.
10. Cuando el usuario diga que ya hizo algo de hoy, usa set_completed.
11. Al generar una rutina inicial, respeta horas de sueño razonables y reparte con equilibrio.
12. Responde en español, en 1-3 frases, con tono cercano. Tras ejecutar, resume qué has cambiado.
13. Solo gestionas la rutina. Si te piden otra cosa, redirige con amabilidad.`
}

// El historial persistido solo replays texto: los tool_use antiguos exigirían
// re-emparejar tool_result y no aportan nada (la rutina del contexto ya
// refleja su efecto). Los mensajes vacíos se saltan, y si el corte de los
// últimos N deja un assistant al frente también: la API de Anthropic exige
// que el primer mensaje sea del usuario (400 si no).
function historyToTurns(history: ChatMessage[]): LLMTurn[] {
  const turns: LLMTurn[] = []
  for (const message of history) {
    if (message.content.trim().length === 0) continue
    if (message.role === 'user') {
      turns.push({ role: 'user', text: message.content })
    } else if (turns.length > 0) {
      turns.push({ role: 'assistant', text: message.content, toolCalls: [] })
    }
  }
  return turns
}

export function createAgentService({ routine, chat, llm }: AgentDeps) {
  return {
    /** Historial para pintar el chat al cargar la página. */
    async history(userId: string, limit = 30): Promise<ChatMessage[]> {
      return chat.listRecent(userId, limit)
    },

    async chat(userId: string, rawMessage: unknown, now: Date): Promise<AgentChatResult> {
      if (llm == null) {
        // programación defensiva: la ruta resuelve la clave BYOK antes de
        // llegar aquí; sin LLM solo tiene sentido history()
        throw new Error('AgentService construido sin LLMClient.')
      }
      const parsed = chatMessageSchema.safeParse(rawMessage)
      if (!parsed.success) {
        return {
          ok: false,
          reason: 'invalid',
          message: parsed.error.issues[0]?.message ?? 'Mensaje inválido.',
        }
      }
      const message = parsed.data

      const since = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS).toISOString()
      const recentCount = await chat.countUserMessagesSince(userId, since)
      if (recentCount >= RATE_LIMIT_MAX_MESSAGES) {
        return {
          ok: false,
          reason: 'rate_limited',
          message: 'Has enviado muchos mensajes seguidos. Espera unos minutos y vuelve a intentarlo.',
        }
      }

      // contexto: rutina completa + categorías + checks de hoy + historial
      const [{ items }, categories, today, history] = await Promise.all([
        routine.listItems(userId),
        routine.listCategories(userId),
        routine.listToday(userId, now),
        chat.listRecent(userId, HISTORY_LIMIT),
      ])

      const byId = new Map(categories.map((category) => [category.id, category.name]))
      const routineJson =
        items.length === 0
          ? '(vacía: el usuario todavía no tiene rutina)'
          : JSON.stringify(
              items.map((item) => ({
                id: item.id,
                kind: item.kind,
                days: item.days,
                start: item.start,
                end: item.end,
                title: item.title,
                categoria: item.categoryId == null ? null : (byId.get(item.categoryId) ?? null),
                detail: item.detail,
              })),
            )
      const categoriesJson = JSON.stringify(
        categories.map((category) => ({ id: category.id, name: category.name })),
      )
      const completedJson =
        today.entries.length === 0
          ? '(nada programado hoy)'
          : JSON.stringify(
              today.entries.map((entry) => ({
                item_id: entry.item.id,
                title: entry.item.title,
                estado: entry.done ? 'hecho' : 'pendiente',
              })),
            )

      const system = buildSystemPrompt({ today, routineJson, categoriesJson, completedJson })
      const turns: LLMTurn[] = [...historyToTurns(history), { role: 'user', text: message }]

      // el mensaje forma parte del historial aunque el proveedor falle luego
      await chat.insert(userId, { role: 'user', content: message })

      const executed: { tool: string; input: Record<string, unknown>; ok: boolean }[] = []
      const affected = new Set<string>()
      let reply = ''
      let lastTruncated = false

      // Perder la persistencia del reply es preferible a un 500 con
      // mutaciones ya aplicadas: la UI necesita el payload para refrescar y
      // resaltar. Se registra y la conversación sigue.
      async function persistAssistant(content: string): Promise<void> {
        try {
          await chat.insert(userId, {
            role: 'assistant',
            content,
            toolCalls: executed.length > 0 ? executed : null,
          })
        } catch (error) {
          const name = error instanceof Error ? error.name : 'Error'
          console.error('[agent-persist]', name, error instanceof Error ? error.message : String(error))
        }
      }

      // una sola fecha límite para todas las rondas, no una por llamada
      const deadline = AbortSignal.timeout(REQUEST_BUDGET_MS)

      try {
        for (let round = 1; round <= MAX_ROUNDS; round++) {
          const response = await llm.complete({
            system,
            turns,
            tools: AGENT_TOOLS,
            signal: deadline,
          })
          lastTruncated = response.truncated === true

          if (response.toolCalls.length === 0) {
            reply = response.text.trim()
            break
          }

          // tope de rondas alcanzado con herramientas pendientes: no se
          // ejecutan más; se devuelve lo que haya y el usuario decide
          if (round === MAX_ROUNDS) {
            reply =
              response.text.trim() ||
              'He hecho una parte de los cambios y me he quedado sin margen en este mensaje. Dime «continúa» y sigo con el resto.'
            break
          }

          turns.push({
            role: 'assistant',
            text: response.text,
            toolCalls: response.toolCalls,
            raw: response.raw,
          })

          const results: LLMToolResult[] = []
          for (const call of response.toolCalls) {
            const startedAt = Date.now()
            let execution: ToolExecution
            try {
              execution = await executeAgentTool(routine, userId, now, call)
            } catch (error) {
              // un fallo inesperado (p. ej. la BD) no debe tumbar la petición
              // entera a mitad de bucle: vuelve al modelo como error legible
              const name = error instanceof Error ? error.name : 'Error'
              const message = error instanceof Error ? error.message : String(error)
              console.error('[agent-tool]', call.name, name, message)
              execution = {
                content: JSON.stringify({
                  ok: false,
                  reason: 'error',
                  message: 'Error interno al ejecutar la herramienta. Puedes reintentar.',
                }),
                isError: true,
                affectedIds: [],
              }
            }
            // log estructurado de cada tool call (spec §9): sin contenido del
            // usuario, solo herramienta, duración y resultado
            console.log(
              '[agent-tool]',
              JSON.stringify({
                tool: call.name,
                ok: !execution.isError,
                ms: Date.now() - startedAt,
              }),
            )
            executed.push({ tool: call.name, input: call.input, ok: !execution.isError })
            for (const id of execution.affectedIds) affected.add(id)
            results.push({
              toolCallId: call.id,
              name: call.name,
              content: execution.content,
              isError: execution.isError,
            })
          }
          turns.push({ role: 'tool_results', results })
        }
      } catch (error) {
        // El proveedor ha fallado a mitad del bucle. Si ya hubo mutaciones, el
        // usuario tiene que enterarse (refresco + resaltado) y el historial
        // debe reflejarlas; si no, el error sube tal cual a la ruta.
        if (!executed.some((call) => call.ok)) throw error
        const name = error instanceof Error ? error.name : 'Error'
        console.error('[agent-loop]', name, error instanceof Error ? error.message : String(error))
        reply =
          'He aplicado una parte de los cambios, pero me he quedado a medias por un error del asistente. Revisa el calendario y dime si sigo.'
        await persistAssistant(reply)
        return {
          ok: true,
          reply,
          affectedItemIds: [...affected],
          mutated: true,
        }
      }

      // una respuesta vacía nunca se disfraza de éxito: si el proveedor la
      // cortó (tokens, seguridad), se dice; si no hubo ni herramientas, se
      // pide reformular en vez de afirmar un «Hecho.» que no ocurrió
      if (reply.length === 0) {
        if (lastTruncated) {
          reply =
            'Me he quedado sin espacio al preparar la respuesta. Pídemelo en pasos más pequeños, por favor.'
        } else if (executed.some((call) => call.ok)) {
          reply = 'Hecho.'
        } else {
          reply = 'No he podido preparar una respuesta. ¿Puedes decírmelo de otra forma?'
        }
      }

      await persistAssistant(reply)

      return {
        ok: true,
        reply,
        affectedItemIds: [...affected],
        mutated: executed.some((call) => call.ok),
      }
    },
  }
}

export type AgentService = ReturnType<typeof createAgentService>
