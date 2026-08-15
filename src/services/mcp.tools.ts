import { DAY_NAMES } from '@/lib/calendar'
import type { ToolAnnotations, ToolListing } from '@/lib/mcp/protocol'
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

/**
 * Una herramienta publicada, con título y anotaciones OBLIGATORIOS: en el
 * protocolo son opcionales, pero aquí se exigen para que ninguna salga sin
 * anotar y el cliente tenga que suponer que puede destruir datos.
 */
export type McpToolDef = ToolListing & { title: string; annotations: ToolAnnotations }

const GET_ROUTINE: McpToolDef = {
  name: 'get_routine',
  title: 'Consultar la rutina',
  // Descriptiva, no imperativa: dice QUÉ devuelve, y que ahí están los
  // identificadores que las demás herramientas necesitan. Antes daba
  // instrucciones de comportamiento al modelo, que es justo lo que los
  // criterios de revisión piden evitar.
  description:
    'Devuelve la rutina semanal completa del usuario: cada ítem con su identificador, tipo, días, horas, categoría, detalle y notas; la lista de categorías; y lo que toca hoy con su estado de completado. Los identificadores de ítem que requieren las herramientas de edición, borrado y completado provienen de aquí.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
}

/**
 * Título y anotaciones de cada herramienta de escritura. `destructiveHint` se
 * reserva a las que pueden perder datos que ya existían: crear no destruye
 * nada, mientras que editar sobrescribe valores y borrar o vaciar un día
 * eliminan ítems.
 */
const WRITE_METADATA: Record<string, { title: string; annotations: ToolAnnotations }> = {
  create_item: {
    title: 'Crear un ítem',
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  update_item: {
    title: 'Editar un ítem',
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  delete_items: {
    title: 'Borrar ítems',
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  clear_day: {
    title: 'Vaciar un día',
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  bulk_create_items: {
    title: 'Crear varios ítems',
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  set_completed: {
    title: 'Marcar como hecho',
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
}

/** Las 7 herramientas que ve un cliente MCP. */
export const MCP_TOOLS: McpToolDef[] = [
  GET_ROUTINE,
  ...AGENT_TOOLS.map((tool) => {
    const meta = WRITE_METADATA[tool.name]
    if (meta == null) {
      // una herramienta nueva en el chat sin metadatos aquí saldría al mundo
      // sin anotar, y el cliente la trataría como si pudiera destruir datos
      throw new Error(`Falta el título y las anotaciones MCP de la herramienta ${tool.name}.`)
    }
    return {
      name: tool.name,
      title: meta.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: meta.annotations,
    }
  }),
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
      // `notes` viaja aunque sea largo: update_item lo acepta, así que sin
      // leerlo primero un cliente sobrescribiría a ciegas lo que ya había
      notes: item.notes,
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
