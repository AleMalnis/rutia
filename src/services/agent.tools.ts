import type { RoutineItem } from '@/lib/schemas'
import type { LLMToolCall, LLMToolDef } from '@/services/llm.client'
import type { RoutineService } from '@/services/routine.service'

// Las 6 herramientas del agente (spec §6.2). Son SOLO de escritura: la rutina
// completa viaja siempre en el contexto, así el modelo nunca inventa IDs.
// Las descripciones se redactan con mimo porque en el modo MCP (spec §6.5)
// serán el único «prompt» que vea el cliente externo.
//
// Reglas comunes que este módulo garantiza (spec §6.2):
// - El user_id lo pone el servidor desde la sesión; el modelo jamás lo envía.
// - Toda entrada pasa por los esquemas Zod del RoutineService.
// - Un conflicto de solapes no escribe: vuelve como resultado negociable.

const DAYS_HELP = 'Días de la semana: 0=lunes … 6=domingo. «Todos los días» = [0,1,2,3,4,5,6]; «entre semana» = [0,1,2,3,4].'
const TIME_HELP = "Hora en formato 24 h 'HH:MM'."

const itemProperties = {
  title: { type: 'string', description: 'Título corto del ítem (máx. 80 caracteres).' },
  kind: {
    type: 'string',
    enum: ['block', 'reminder'],
    description:
      "'block' para franjas con duración (trabajo, gimnasio, comidas); 'reminder' para eventos puntuales (medicación, llamadas, riego).",
  },
  days: {
    type: 'array',
    items: { type: 'integer', minimum: 0, maximum: 6 },
    description: DAYS_HELP,
  },
  start: { type: 'string', description: `Inicio. ${TIME_HELP}` },
  end: {
    type: ['string', 'null'],
    description: `Fin (admite '24:00'). Obligatorio si kind='block'; omitir o null si es reminder. ${TIME_HELP}`,
  },
  category_id: {
    type: ['string', 'null'],
    description: 'UUID de una categoría de la lista del contexto. Opcional; null = sin categoría.',
  },
  detail: {
    type: ['string', 'null'],
    description: 'Detalle corto que se muestra como subtítulo: plato, dosis… (máx. 120 caracteres).',
  },
  notes: { type: ['string', 'null'], description: 'Notas largas opcionales.' },
} as const

export const AGENT_TOOLS: LLMToolDef[] = [
  {
    name: 'create_item',
    description:
      'Crea UN ítem recurrente en la rutina semanal. Si un bloque choca con otro bloque existente, no escribe y devuelve el conflicto para negociarlo.',
    inputSchema: {
      type: 'object',
      properties: itemProperties,
      required: ['title', 'kind', 'days', 'start'],
    },
  },
  {
    name: 'update_item',
    description:
      'Edita, mueve o cambia el detalle de un ítem existente. Envía SOLO los campos que cambian y usa siempre un item_id de la rutina del contexto. end=null al convertir un bloque en recordatorio; category_id=null para quitar la categoría.',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'UUID del ítem, tomado de la rutina del contexto.' },
        ...itemProperties,
      },
      required: ['item_id'],
    },
  },
  {
    name: 'delete_items',
    description: 'Borra definitivamente uno o varios ítems de la rutina.',
    inputSchema: {
      type: 'object',
      properties: {
        item_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'UUIDs de los ítems a borrar, tomados de la rutina del contexto.',
        },
      },
      required: ['item_ids'],
    },
  },
  {
    name: 'clear_day',
    description:
      'Quita un día del array de días de todos los ítems afectados; el ítem que se quede sin días se borra. Con from/to solo afecta a lo que caiga en esa franja. Útil para «déjame libre el sábado» o «quita lo del lunes por la tarde».',
    inputSchema: {
      type: 'object',
      properties: {
        day: {
          type: 'integer',
          minimum: 0,
          maximum: 6,
          description:
            'UN solo día a vaciar, como entero: 0=lunes … 6=domingo. Para vaciar varios días, llama a la herramienta una vez por día.',
        },
        from: { type: 'string', description: `Inicio de la franja (opcional; requiere to). ${TIME_HELP}` },
        to: { type: 'string', description: `Fin de la franja (opcional; requiere from). ${TIME_HELP}` },
      },
      required: ['day'],
    },
  },
  {
    name: 'bulk_create_items',
    description:
      'Crea varios ítems a la vez (rutina inicial o cambios masivos). Todo-o-nada: si algún bloque choca con la rutina existente o con otro ítem del lote, no se crea NADA y se devuelve el conflicto.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Ítems a crear (máx. 50).',
          items: {
            type: 'object',
            properties: itemProperties,
            required: ['title', 'kind', 'days', 'start'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'set_completed',
    description:
      'Marca (done=true) o desmarca (done=false) un ítem como hecho HOY. La fecha la pone el servidor; solo funciona con ítems que tocan hoy.',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'UUID del ítem, tomado de la rutina del contexto.' },
        done: { type: 'boolean', description: 'true = hecho; false = pendiente.' },
      },
      required: ['item_id', 'done'],
    },
  },
]

export type ToolExecution = {
  /** JSON con el resultado, tal y como lo leerá el modelo. */
  content: string
  isError: boolean
  /** Ítems existentes tocados por la herramienta, para resaltarlos en la UI. */
  affectedIds: string[]
}

// Versión compacta de un ítem para los resultados: suficiente para que el
// modelo confirme el cambio sin gastar tokens en timestamps.
function compactItem(item: RoutineItem) {
  return {
    id: item.id,
    title: item.title,
    kind: item.kind,
    days: item.days,
    start: item.start,
    end: item.end,
  }
}

function ok(payload: Record<string, unknown>, affectedIds: string[] = []): ToolExecution {
  return { content: JSON.stringify({ ok: true, ...payload }), isError: false, affectedIds }
}

function fail(payload: Record<string, unknown>): ToolExecution {
  return { content: JSON.stringify({ ok: false, ...payload }), isError: true, affectedIds: [] }
}

// '24:00' es válido en el dominio, pero el <input type="time"> del formulario
// manual no puede reabrirlo (deuda §12.6): el agente lo normaliza a '23:59'
// para no crear ítems que la otra puerta no pueda editar.
function normalizeEnd(value: unknown): unknown {
  return value === '24:00' ? '23:59' : value
}

// El modelo habla snake_case (category_id); el dominio, camelCase. La mezcla
// respeta la diferencia entre «campo ausente» (no cambiar) y null (borrar).
function toCreateInput(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw == null) return raw
  const input = raw as Record<string, unknown>
  const { category_id: categoryId, ...rest } = input
  if ('end' in rest) rest.end = normalizeEnd(rest.end)
  return 'category_id' in input ? { ...rest, categoryId } : rest
}

/**
 * Ejecuta una llamada a herramienta del modelo contra el RoutineService.
 * Cualquier entrada malformada vuelve como resultado de error legible para el
 * modelo (que la corrige en la siguiente ronda), nunca como excepción.
 */
export async function executeAgentTool(
  routine: RoutineService,
  userId: string,
  now: Date,
  call: LLMToolCall,
): Promise<ToolExecution> {
  const input = call.input

  switch (call.name) {
    case 'create_item': {
      const result = await routine.createItem(userId, toCreateInput(input))
      if (!result.ok) return fail(result)
      return ok({ item: compactItem(result.item) }, [result.item.id])
    }

    case 'update_item': {
      const patch: Record<string, unknown> = {}
      for (const key of ['title', 'kind', 'days', 'start', 'end', 'detail', 'notes']) {
        if (key in input) patch[key] = input[key]
      }
      if ('end' in patch) patch.end = normalizeEnd(patch.end)
      if ('category_id' in input) patch.categoryId = input.category_id
      const result = await routine.updateItem(userId, input.item_id, patch)
      if (!result.ok) return fail(result)
      return ok({ item: compactItem(result.item) }, [result.item.id])
    }

    case 'delete_items': {
      const result = await routine.deleteItems(userId, input.item_ids)
      if (!result.ok) return fail(result)
      return ok({ deleted: result.deleted })
    }

    case 'clear_day': {
      const result = await routine.clearDay(userId, input)
      if (!result.ok) return fail(result)
      return ok(
        {
          updated: result.updated.map((item) => ({ id: item.id, days: item.days })),
          deleted: result.deletedIds.length,
        },
        result.updated.map((item) => item.id),
      )
    }

    case 'bulk_create_items': {
      const items = Array.isArray(input.items) ? input.items.map(toCreateInput) : input.items
      const result = await routine.bulkCreateItems(userId, items)
      if (!result.ok) return fail(result)
      return ok(
        { created: result.items.map(compactItem) },
        result.items.map((item) => item.id),
      )
    }

    case 'set_completed': {
      if (typeof input.done !== 'boolean') {
        return fail({ reason: 'invalid', message: 'done debe ser true o false.' })
      }
      const result = await routine.setCompleted(userId, input.item_id, input.done, now, null)
      if (!result.ok) return fail(result)
      const itemId = typeof input.item_id === 'string' ? [input.item_id] : []
      return ok({ done: result.done }, itemId)
    }

    default:
      return fail({ reason: 'invalid', message: `Herramienta desconocida: ${call.name}.` })
  }
}
