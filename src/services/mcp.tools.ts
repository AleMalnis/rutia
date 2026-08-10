import { DAY_NAMES } from '@/lib/calendar'
import { AGENT_TOOLS, executeAgentTool } from '@/services/agent.tools'
import type { RoutineService } from '@/services/routine.service'

// Herramientas del servidor MCP (spec §6.5). Adaptador fino: las seis de
// escritura son literalmente las del chat integrado (§6.2) y su ejecución
// pasa por el mismo despachador, así que no hay lógica duplicada.
//
// La séptima, get_routine, existe SOLO aquí. En el chat la rutina se inyecta
// en el contexto (§6.1) y por eso las herramientas pueden ser solo de
// escritura; un cliente MCP no recibe esa inyección, así que sin lectura no
// podría conocer los identificadores que exigen update_item, delete_items y
// set_completed. Añadirla al chat sería gastar rondas para nada.

export type McpToolDef = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const GET_ROUTINE: McpToolDef = {
  name: 'get_routine',
  description:
    'Devuelve la rutina semanal completa del usuario con los identificadores de cada ítem, sus categorías y qué toca hoy con su estado de completado. Llámala ANTES de editar, borrar o marcar algo: los identificadores que necesitan las demás herramientas solo se obtienen aquí, y nunca deben inventarse.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
}

/** Las 7 herramientas que ve un cliente MCP. */
export const MCP_TOOLS: McpToolDef[] = [
  GET_ROUTINE,
  ...AGENT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })),
]

export type McpToolResult = {
  /** Texto que verá el modelo del cliente (JSON serializado). */
  text: string
  isError: boolean
}

/** Rutina serializada para el cliente externo: con ids, que es lo que le falta. */
async function readRoutine(routine: RoutineService, userId: string, now: Date): Promise<string> {
  const [{ items }, categories, today] = await Promise.all([
    routine.listItems(userId),
    routine.listCategories(userId),
    routine.listToday(userId, now),
  ])
  const nombrePorId = new Map(categories.map((category) => [category.id, category.name]))

  return JSON.stringify({
    hoy: {
      fecha: today.date,
      dia_semana: DAY_NAMES[today.weekday],
      day: today.weekday,
      zona_horaria: today.timeZone,
      items: today.entries.map((entry) => ({
        item_id: entry.item.id,
        title: entry.item.title,
        start: entry.item.start,
        estado: entry.done ? 'hecho' : 'pendiente',
      })),
    },
    categorias: categories.map((category) => ({ id: category.id, name: category.name })),
    rutina: items.map((item) => ({
      item_id: item.id,
      kind: item.kind,
      days: item.days,
      start: item.start,
      end: item.end,
      title: item.title,
      categoria: item.categoryId == null ? null : (nombrePorId.get(item.categoryId) ?? null),
      detail: item.detail,
    })),
  })
}

/**
 * Ejecuta una herramienta pedida por un cliente MCP. El userId sale SIEMPRE
 * del token validado, jamás de los argumentos (spec §6.2), y cualquier entrada
 * malformada vuelve como resultado de error legible para el modelo.
 */
export async function executeMcpTool(
  routine: RoutineService,
  userId: string,
  now: Date,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  if (name === GET_ROUTINE.name) {
    return { text: await readRoutine(routine, userId, now), isError: false }
  }

  if (!AGENT_TOOLS.some((tool) => tool.name === name)) {
    return {
      text: JSON.stringify({ ok: false, reason: 'invalid', message: `Herramienta desconocida: ${name}.` }),
      isError: true,
    }
  }

  // el id de la llamada no se usa en modo MCP (no hay bucle agéntico que
  // empareje resultados), pero el despachador lo pide
  const execution = await executeAgentTool(routine, userId, now, { id: name, name, input: args })
  return { text: execution.content, isError: execution.isError }
}
