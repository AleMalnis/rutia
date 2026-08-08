import { describe, expect, it } from 'vitest'
import type { Category, CreateRoutineItemInput, RoutineItem } from '@/lib/schemas'
import type { ChatMessage, ChatRepo } from '@/repositories/chat.repo'
import type { CategoriesRepo } from '@/repositories/categories.repo'
import type { CompletionsRepo } from '@/repositories/completions.repo'
import type { ItemsRepo } from '@/repositories/items.repo'
import type { ProfilesRepo } from '@/repositories/profiles.repo'
import { createAgentService } from '@/services/agent.service'
import { AGENT_TOOLS, executeAgentTool } from '@/services/agent.tools'
import type { LLMClient, LLMReply, LLMToolDef, LLMTurn } from '@/services/llm.client'
import { createRoutineService } from '@/services/routine.service'

const USER = 'user-1'
// sábado en Madrid → weekday 5 (mismo instante que en today.test.ts)
const NOW = new Date('2026-08-01T10:00:00Z')

let seq = 0
function nextId(): string {
  seq += 1
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`
}

function mkItem(partial: Partial<RoutineItem>): RoutineItem {
  return {
    id: nextId(),
    title: `Ítem ${seq}`,
    kind: 'reminder',
    days: [5],
    start: '09:00',
    end: null,
    categoryId: null,
    detail: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

function fromInput(input: CreateRoutineItemInput): RoutineItem {
  return mkItem({
    title: input.title,
    kind: input.kind,
    days: input.days,
    start: input.start,
    end: input.end ?? null,
    categoryId: input.categoryId ?? null,
    detail: input.detail ?? null,
    notes: input.notes ?? null,
  })
}

// Repositorio de ítems en memoria con contadores de llamadas: los tests de
// bulk comprueban que el lote va en UNA sola escritura.
function mkItemsRepo(initial: RoutineItem[] = []) {
  const store = [...initial]
  const calls = { insert: 0, insertMany: 0, update: 0, deleteMany: 0 }
  const repo: ItemsRepo = {
    async listByUser() {
      return [...store]
    },
    async getById(_u, id) {
      return store.find((item) => item.id === id) ?? null
    },
    async insert(_u, input) {
      calls.insert += 1
      const item = fromInput(input)
      store.push(item)
      return item
    },
    async insertMany(_u, inputs) {
      calls.insertMany += 1
      const items = inputs.map(fromInput)
      store.push(...items)
      return items
    },
    async update(_u, id, input) {
      calls.update += 1
      const index = store.findIndex((item) => item.id === id)
      if (index === -1) return null
      store[index] = {
        ...store[index],
        title: input.title,
        kind: input.kind,
        days: input.days,
        start: input.start,
        end: input.end ?? null,
        categoryId: input.categoryId ?? null,
        detail: input.detail ?? null,
        notes: input.notes ?? null,
      }
      return store[index]
    },
    async deleteMany(_u, ids) {
      calls.deleteMany += 1
      const before = store.length
      for (const id of ids) {
        const index = store.findIndex((item) => item.id === id)
        if (index !== -1) store.splice(index, 1)
      }
      return before - store.length
    },
  }
  return { repo, store, calls }
}

function mkDeps(initialItems: RoutineItem[] = [], categories: Category[] = []) {
  const items = mkItemsRepo(initialItems)
  const marked = new Set<string>()
  const completions: CompletionsRepo = {
    async listItemIdsByDate() {
      return [...marked]
    },
    async markDone(_u, itemId) {
      marked.add(itemId)
    },
    async markUndone(_u, itemId) {
      marked.delete(itemId)
    },
  }
  const profiles: ProfilesRepo = {
    async getTimezone() {
      return 'Europe/Madrid'
    },
    async setTimezone() {},
    async getPreferences() {
      return {}
    },
    async setPreference() {},
  }
  const categoriesRepo: CategoriesRepo = {
    async listByUser() {
      return categories
    },
    async insert() {
      throw new Error('no usado')
    },
    async update() {
      return null
    },
    async deleteById() {
      return 0
    },
  }
  return {
    deps: { items: items.repo, completions, profiles, categories: categoriesRepo },
    items,
    marked,
  }
}

function mkChatRepo(recentUserCount = 0, history: ChatMessage[] = []) {
  const persisted: { role: string; content: string; toolCalls: unknown }[] = []
  const repo: ChatRepo = {
    async insert(_u, message) {
      persisted.push({
        role: message.role,
        content: message.content,
        toolCalls: message.toolCalls ?? null,
      })
      return {
        id: nextId(),
        role: message.role,
        content: message.content,
        toolCalls: message.toolCalls ?? null,
        createdAt: NOW.toISOString(),
      } satisfies ChatMessage
    },
    async listRecent() {
      return history
    },
    async countUserMessagesSince() {
      return recentUserCount
    },
  }
  return { repo, persisted }
}

function mkChatMessage(role: 'user' | 'assistant', content: string): ChatMessage {
  return { id: nextId(), role, content, toolCalls: null, createdAt: NOW.toISOString() }
}

// LLM mockeado (spec §9): un guion de respuestas; si el guion se acaba, se
// repite la última (útil para probar el tope de rondas). Una entrada Error
// simula la caída del proveedor en esa llamada.
function mkLLM(script: (LLMReply | Error)[]) {
  const calls: { system: string; turns: LLMTurn[]; tools: LLMToolDef[] }[] = []
  const llm: LLMClient = {
    async complete(input) {
      calls.push(input)
      const entry = script[Math.min(calls.length - 1, script.length - 1)]
      if (entry instanceof Error) throw entry
      return entry
    },
  }
  return { llm, calls }
}

describe('RoutineService.clearDay', () => {
  it('quita el día del array y borra el ítem que se queda sin días', async () => {
    const multiDia = mkItem({ title: 'Gimnasio', days: [0, 5] })
    const soloSabado = mkItem({ title: 'Excursión', days: [5] })
    const otroDia = mkItem({ title: 'Piano', days: [2] })
    const { deps, items } = mkDeps([multiDia, soloSabado, otroDia])

    const result = await createRoutineService(deps).clearDay(USER, { day: 5 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.updated.map((i) => i.days)).toEqual([[0]])
    expect(result.deletedIds).toEqual([soloSabado.id])
    // el ítem de otro día queda intacto
    expect(items.store.map((i) => i.title).sort()).toEqual(['Gimnasio', 'Piano'])
  })

  it('con franja solo afecta a lo que cae dentro, incluidos bloques que la pisan', async () => {
    const manana = mkItem({ title: 'Medicación', days: [5], start: '09:00' })
    const bloqueManana = mkItem({
      title: 'Curro',
      kind: 'block',
      days: [5],
      start: '09:00',
      end: '14:00',
    })
    const tarde = mkItem({ title: 'Llamada', days: [5], start: '15:00' })
    const { deps, items } = mkDeps([manana, bloqueManana, tarde])

    // franja de tarde: pilla la llamada (15:00); el bloque que termina JUSTO
    // a las 14:00 no la pisa (franjas semiabiertas) y la medicación tampoco
    const result = await createRoutineService(deps).clearDay(USER, {
      day: 5,
      from: '14:00',
      to: '16:00',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.deletedIds).toEqual([tarde.id])
    expect(items.store.map((i) => i.title).sort()).toEqual(['Curro', 'Medicación'])
  })

  it('un bloque que solo pisa parcialmente la franja también cuenta', async () => {
    const bloque = mkItem({
      title: 'Curro',
      kind: 'block',
      days: [4, 5],
      start: '09:00',
      end: '15:00',
    })
    const { deps } = mkDeps([bloque])

    const result = await createRoutineService(deps).clearDay(USER, {
      day: 5,
      from: '14:00',
      to: '16:00',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.updated.map((i) => i.days)).toEqual([[4]])
  })

  it('rechaza día fuera de rango y franjas incompletas o invertidas', async () => {
    const service = createRoutineService(mkDeps().deps)
    expect(await service.clearDay(USER, { day: 7 })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(await service.clearDay(USER, { day: 5, from: '10:00' })).toMatchObject({
      ok: false,
      reason: 'invalid',
    })
    expect(
      await service.clearDay(USER, { day: 5, from: '16:00', to: '14:00' }),
    ).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('un día sin nada devuelve listas vacías sin escribir', async () => {
    const { deps, items } = mkDeps([mkItem({ days: [0] })])
    const result = await createRoutineService(deps).clearDay(USER, { day: 6 })
    expect(result).toEqual({ ok: true, updated: [], deletedIds: [] })
    expect(items.calls.update + items.calls.deleteMany).toBe(0)
  })
})

describe('RoutineService.bulkCreateItems', () => {
  it('inserta el lote válido en UNA sola llamada', async () => {
    const { deps, items } = mkDeps()
    const result = await createRoutineService(deps).bulkCreateItems(USER, [
      { title: 'Medicación', kind: 'reminder', days: [0, 1, 2, 3, 4, 5, 6], start: '09:00' },
      { title: 'Curro', kind: 'block', days: [0, 1, 2, 3, 4], start: '09:00', end: '17:00' },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toHaveLength(2)
    expect(items.calls.insertMany).toBe(1)
    expect(items.calls.insert).toBe(0)
  })

  it('dos bloques del lote que se pisan entre sí: no se escribe nada', async () => {
    const { deps, items } = mkDeps()
    const result = await createRoutineService(deps).bulkCreateItems(USER, [
      { title: 'Curro', kind: 'block', days: [0], start: '09:00', end: '17:00' },
      { title: 'Gimnasio', kind: 'block', days: [0], start: '16:00', end: '18:00' },
    ])

    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    if (result.ok || result.reason !== 'invalid') return
    expect(result.message).toContain('se solapan entre sí')
    expect(items.calls.insertMany).toBe(0)
  })

  it('un bloque que choca con la rutina existente devuelve el conflicto sin escribir', async () => {
    const existente = mkItem({
      title: 'Curro',
      kind: 'block',
      days: [0],
      start: '09:00',
      end: '17:00',
    })
    const { deps, items } = mkDeps([existente])

    const result = await createRoutineService(deps).bulkCreateItems(USER, [
      { title: 'Siesta', kind: 'block', days: [0], start: '16:00', end: '18:00' },
    ])

    expect(result).toMatchObject({ ok: false, reason: 'conflict' })
    if (result.ok || result.reason !== 'conflict') return
    expect(result.conflicts[0].itemId).toBe(existente.id)
    expect(items.calls.insertMany).toBe(0)
  })

  it('un ítem inválido invalida el lote completo', async () => {
    const { deps, items } = mkDeps()
    const result = await createRoutineService(deps).bulkCreateItems(USER, [
      { title: 'Bien', kind: 'reminder', days: [0], start: '09:00' },
      { title: 'Mal', kind: 'block', days: [0], start: '09:00' }, // bloque sin end
    ])
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(items.calls.insertMany).toBe(0)
  })

  it('rechaza lotes vacíos o desmesurados', async () => {
    const service = createRoutineService(mkDeps().deps)
    expect(await service.bulkCreateItems(USER, [])).toMatchObject({ ok: false, reason: 'invalid' })
    const enormes = Array.from({ length: 51 }, (_, i) => ({
      title: `Ítem ${i}`,
      kind: 'reminder',
      days: [0],
      start: '09:00',
    }))
    expect(await service.bulkCreateItems(USER, enormes)).toMatchObject({
      ok: false,
      reason: 'invalid',
    })
  })
})

describe('executeAgentTool: mapeo de llamadas → RoutineService', () => {
  it('create_item traduce category_id a categoryId', async () => {
    const categoria: Category = { id: nextId(), name: 'Salud', color: '#2a78d6' }
    const { deps, items } = mkDeps([], [categoria])
    const routine = createRoutineService(deps)

    const execution = await executeAgentTool(routine, USER, NOW, {
      id: 't1',
      name: 'create_item',
      input: {
        title: 'Pastilla',
        kind: 'reminder',
        days: [5],
        start: '09:00',
        category_id: categoria.id,
      },
    })

    expect(execution.isError).toBe(false)
    expect(items.store[0].categoryId).toBe(categoria.id)
    expect(execution.affectedIds).toEqual([items.store[0].id])
  })

  it('un conflicto vuelve como resultado legible, no como excepción', async () => {
    const existente = mkItem({
      title: 'Curro',
      kind: 'block',
      days: [0],
      start: '09:00',
      end: '17:00',
    })
    const routine = createRoutineService(mkDeps([existente]).deps)

    const execution = await executeAgentTool(routine, USER, NOW, {
      id: 't1',
      name: 'create_item',
      input: { title: 'Siesta', kind: 'block', days: [0], start: '10:00', end: '11:00' },
    })

    expect(execution.isError).toBe(true)
    const payload = JSON.parse(execution.content)
    expect(payload.reason).toBe('conflict')
    expect(payload.conflicts[0].itemId).toBe(existente.id)
  })

  it('update_item aplica solo los campos presentes y category_id=null limpia', async () => {
    const categoria: Category = { id: nextId(), name: 'Salud', color: '#2a78d6' }
    const item = mkItem({ title: 'Pastilla', days: [5], start: '09:00', categoryId: categoria.id })
    const { deps, items } = mkDeps([item], [categoria])
    const routine = createRoutineService(deps)

    const execution = await executeAgentTool(routine, USER, NOW, {
      id: 't1',
      name: 'update_item',
      input: { item_id: item.id, start: '10:30', category_id: null },
    })

    expect(execution.isError).toBe(false)
    expect(items.store[0]).toMatchObject({
      title: 'Pastilla', // no viajó en el parche: intacto
      start: '10:30',
      categoryId: null,
    })
    expect(execution.affectedIds).toEqual([item.id])
  })

  it('delete_items borra y devuelve el conteo', async () => {
    const a = mkItem({})
    const b = mkItem({})
    const { deps, items } = mkDeps([a, b])
    const routine = createRoutineService(deps)

    const execution = await executeAgentTool(routine, USER, NOW, {
      id: 't1',
      name: 'delete_items',
      input: { item_ids: [a.id, b.id] },
    })

    expect(execution.isError).toBe(false)
    expect(JSON.parse(execution.content)).toEqual({ ok: true, deleted: 2 })
    expect(items.store).toHaveLength(0)
  })

  it('clear_day reporta actualizados (para resaltar) y borrados', async () => {
    const multiDia = mkItem({ days: [0, 5] })
    const soloSabado = mkItem({ days: [5] })
    const routine = createRoutineService(mkDeps([multiDia, soloSabado]).deps)

    const execution = await executeAgentTool(routine, USER, NOW, {
      id: 't1',
      name: 'clear_day',
      input: { day: 5 },
    })

    expect(execution.isError).toBe(false)
    expect(execution.affectedIds).toEqual([multiDia.id])
    expect(JSON.parse(execution.content)).toMatchObject({ ok: true, deleted: 1 })
  })

  it('bulk_create_items traduce category_id en cada ítem del lote', async () => {
    const categoria: Category = { id: nextId(), name: 'Salud', color: '#2a78d6' }
    const { deps, items } = mkDeps([], [categoria])
    const routine = createRoutineService(deps)

    const execution = await executeAgentTool(routine, USER, NOW, {
      id: 't1',
      name: 'bulk_create_items',
      input: {
        items: [
          { title: 'Pastilla', kind: 'reminder', days: [5], start: '09:00', category_id: categoria.id },
          { title: 'Paseo', kind: 'reminder', days: [5], start: '18:00' },
        ],
      },
    })

    expect(execution.isError).toBe(false)
    expect(items.store.map((i) => i.categoryId)).toEqual([categoria.id, null])
    expect(execution.affectedIds).toHaveLength(2)
  })

  it("normaliza end='24:00' a '23:59': el formulario manual no puede reabrir 24:00 (§12.6)", async () => {
    const { deps, items } = mkDeps()
    const routine = createRoutineService(deps)

    const execution = await executeAgentTool(routine, USER, NOW, {
      id: 't1',
      name: 'create_item',
      input: { title: 'Cena', kind: 'block', days: [5], start: '23:00', end: '24:00' },
    })

    expect(execution.isError).toBe(false)
    expect(items.store[0].end).toBe('23:59')
  })

  it('bulk_create_items con items que no es array devuelve error legible', async () => {
    const routine = createRoutineService(mkDeps().deps)
    const execution = await executeAgentTool(routine, USER, NOW, {
      id: 't1',
      name: 'bulk_create_items',
      input: { items: 'no soy un array' },
    })
    expect(execution.isError).toBe(true)
    expect(JSON.parse(execution.content).reason).toBe('invalid')
  })

  it('set_completed marca el ítem de hoy y lo reporta para resaltar', async () => {
    const item = mkItem({ days: [5] })
    const { deps, marked } = mkDeps([item])
    const routine = createRoutineService(deps)

    const execution = await executeAgentTool(routine, USER, NOW, {
      id: 't1',
      name: 'set_completed',
      input: { item_id: item.id, done: true },
    })

    expect(execution.isError).toBe(false)
    expect(marked.has(item.id)).toBe(true)
    expect(execution.affectedIds).toEqual([item.id])
  })

  it('set_completed exige un done booleano de verdad', async () => {
    const routine = createRoutineService(mkDeps().deps)
    const execution = await executeAgentTool(routine, USER, NOW, {
      id: 't1',
      name: 'set_completed',
      input: { item_id: nextId(), done: 'true' },
    })
    expect(execution.isError).toBe(true)
  })

  it('una herramienta desconocida no revienta el bucle', async () => {
    const routine = createRoutineService(mkDeps().deps)
    const execution = await executeAgentTool(routine, USER, NOW, {
      id: 't1',
      name: 'drop_database',
      input: {},
    })
    expect(execution.isError).toBe(true)
    expect(JSON.parse(execution.content).message).toContain('desconocida')
  })
})

describe('AgentService.chat (LLM mockeado, spec §9)', () => {
  function mkAgent(options: {
    items?: RoutineItem[]
    script: (LLMReply | Error)[]
    recentUserCount?: number
    history?: ChatMessage[]
  }) {
    const { deps, items } = mkDeps(options.items ?? [])
    const routine = createRoutineService(deps)
    const chat = mkChatRepo(options.recentUserCount ?? 0, options.history ?? [])
    const llm = mkLLM(options.script)
    const agent = createAgentService({ routine, chat: chat.repo, llm: llm.llm })
    return { agent, items, chat, llm }
  }

  it('respuesta solo texto: sin herramientas, dos mensajes persistidos', async () => {
    const { agent, chat, llm } = mkAgent({
      script: [{ text: 'Hoy te toca Pilates a las 11:00.', toolCalls: [] }],
    })

    const result = await agent.chat(USER, '¿Qué me toca hoy?', NOW)

    expect(result).toEqual({
      ok: true,
      reply: 'Hoy te toca Pilates a las 11:00.',
      affectedItemIds: [],
      mutated: false,
    })
    expect(llm.calls).toHaveLength(1)
    expect(chat.persisted.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(chat.persisted[1].toolCalls).toBeNull()
  })

  it('el system prompt lleva la rutina serializada con sus IDs y los checks de hoy', async () => {
    const item = mkItem({ title: 'Pilates', days: [5], start: '11:00' })
    const { agent, llm } = mkAgent({
      items: [item],
      script: [{ text: 'Te toca Pilates.', toolCalls: [] }],
    })

    await agent.chat(USER, '¿Qué me toca hoy?', NOW)

    const system = llm.calls[0].system
    expect(system).toContain('RUTINA ACTUAL')
    expect(system).toContain(item.id)
    expect(system).toContain('2026-08-01')
    expect(system).toContain('Europe/Madrid')
    expect(system).toContain('pendiente')
  })

  it('una ronda de herramientas: ejecuta, devuelve el resultado al LLM y refresca', async () => {
    const { agent, items, chat, llm } = mkAgent({
      script: [
        {
          text: '',
          toolCalls: [
            {
              id: 't1',
              name: 'create_item',
              input: { title: 'Pilates', kind: 'reminder', days: [5], start: '11:00' },
            },
          ],
        },
        { text: 'He añadido Pilates el sábado a las 11:00.', toolCalls: [] },
      ],
    })

    const result = await agent.chat(USER, 'Ponme pilates el sábado a las 11', NOW)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mutated).toBe(true)
    expect(result.affectedItemIds).toEqual([items.store[0].id])
    expect(result.reply).toContain('Pilates')

    // el resultado de la herramienta viajó de vuelta al modelo
    expect(llm.calls).toHaveLength(2)
    const lastTurn = llm.calls[1].turns.at(-1)
    expect(lastTurn?.role).toBe('tool_results')
    if (lastTurn?.role !== 'tool_results') return
    expect(lastTurn.results[0].content).toContain('"ok":true')

    // la ejecución queda registrada en el mensaje persistido (spec §5)
    expect(chat.persisted[1].toolCalls).toMatchObject([{ tool: 'create_item', ok: true }])
  })

  it('si el corte del historial deja un assistant al frente, se descarta (la API exige empezar por user)', async () => {
    const { agent, llm } = mkAgent({
      script: [{ text: 'ok', toolCalls: [] }],
      history: [
        mkChatMessage('assistant', 'respuesta huérfana por el corte de los últimos N'),
        mkChatMessage('user', 'mensaje antiguo'),
        mkChatMessage('assistant', 'respuesta antigua'),
      ],
    })

    await agent.chat(USER, 'hola', NOW)

    const turns = llm.calls[0].turns
    expect(turns[0].role).toBe('user')
    expect(turns).toHaveLength(3) // user antiguo + assistant antiguo + mensaje nuevo
  })

  it('el contenido raw del proveedor vuelve intacto en el turno del bucle (modelos con thinking)', async () => {
    const raw = [{ type: 'thinking', thinking: 'privado' }]
    const { agent, llm } = mkAgent({
      script: [
        {
          text: '',
          toolCalls: [
            {
              id: 't1',
              name: 'create_item',
              input: { title: 'Pilates', kind: 'reminder', days: [5], start: '11:00' },
            },
          ],
          raw,
        },
        { text: 'Hecho.', toolCalls: [] },
      ],
    })

    await agent.chat(USER, 'ponme pilates', NOW)

    const assistantTurn = llm.calls[1].turns.at(-2)
    expect(assistantTurn?.role).toBe('assistant')
    if (assistantTurn?.role !== 'assistant') return
    expect(assistantTurn.raw).toBe(raw)
  })

  it('fallo del proveedor tras una mutación: aviso persistido y la UI aún refresca', async () => {
    const { agent, items, chat } = mkAgent({
      script: [
        {
          text: '',
          toolCalls: [
            {
              id: 't1',
              name: 'create_item',
              input: { title: 'Pilates', kind: 'reminder', days: [5], start: '11:00' },
            },
          ],
        },
        new Error('proveedor caído'),
      ],
    })

    const result = await agent.chat(USER, 'ponme pilates', NOW)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mutated).toBe(true)
    expect(result.affectedItemIds).toEqual([items.store[0].id])
    expect(result.reply).toContain('a medias')
    expect(chat.persisted.at(-1)?.role).toBe('assistant')
  })

  it('una respuesta vacía truncada no se disfraza de «Hecho.»', async () => {
    const { agent, chat } = mkAgent({
      script: [{ text: '', toolCalls: [], truncated: true }],
    })

    const result = await agent.chat(USER, 'móntame la rutina entera', NOW)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.reply).toContain('sin espacio')
    expect(result.reply).not.toBe('Hecho.')
    expect(chat.persisted[1].content).toContain('sin espacio')
  })

  it('una respuesta vacía sin herramientas pide reformular, no afirma éxito', async () => {
    const { agent } = mkAgent({ script: [{ text: '', toolCalls: [] }] })
    const result = await agent.chat(USER, 'hola', NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.reply).not.toBe('Hecho.')
  })

  it('si falla la persistencia del reply tras una mutación, la petición NO se cae', async () => {
    const { deps, items } = mkDeps()
    const routine = createRoutineService(deps)
    const chat = mkChatRepo()
    // el insert del assistant (2º insert) revienta: la UI aún debe refrescar
    const originalInsert = chat.repo.insert.bind(chat.repo)
    let inserts = 0
    chat.repo.insert = async (userId, message) => {
      inserts += 1
      if (inserts > 1) throw new Error('Supabase caído')
      return originalInsert(userId, message)
    }
    const llm = mkLLM([
      {
        text: '',
        toolCalls: [
          {
            id: 't1',
            name: 'create_item',
            input: { title: 'Pilates', kind: 'reminder', days: [5], start: '11:00' },
          },
        ],
      },
      { text: 'He añadido Pilates.', toolCalls: [] },
    ])
    const agent = createAgentService({ routine, chat: chat.repo, llm: llm.llm })

    const result = await agent.chat(USER, 'ponme pilates', NOW)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mutated).toBe(true)
    expect(result.affectedItemIds).toEqual([items.store[0].id])
  })

  it('fallo del proveedor sin mutaciones: el error sube tal cual a la ruta', async () => {
    const { agent } = mkAgent({ script: [new Error('proveedor caído')] })
    await expect(agent.chat(USER, 'hola', NOW)).rejects.toThrow('proveedor caído')
  })

  it('una herramienta que revienta (BD caída) vuelve al modelo como error, no como 500', async () => {
    const { deps } = mkDeps()
    // el insert del repo revienta: el bucle debe convertirlo en tool_result
    deps.items.insert = async () => {
      throw new Error('conexión perdida')
    }
    const routine = createRoutineService(deps)
    const chat = mkChatRepo()
    const llm = mkLLM([
      {
        text: '',
        toolCalls: [
          {
            id: 't1',
            name: 'create_item',
            input: { title: 'Pilates', kind: 'reminder', days: [5], start: '11:00' },
          },
        ],
      },
      { text: 'No he podido guardarlo, ¿reintento?', toolCalls: [] },
    ])
    const agent = createAgentService({ routine, chat: chat.repo, llm: llm.llm })

    const result = await agent.chat(USER, 'ponme pilates', NOW)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mutated).toBe(false)
    const lastTurn = llm.calls[1].turns.at(-1)
    if (lastTurn?.role !== 'tool_results') throw new Error('esperaba tool_results')
    expect(lastTurn.results[0].isError).toBe(true)
    expect(lastTurn.results[0].content).toContain('Error interno')
  })

  it('tope de 5 rondas: al llegar al límite no se ejecutan más herramientas', async () => {
    const { agent, items, llm } = mkAgent({
      // el guion repite siempre la misma llamada: sin tope sería infinito
      script: [
        {
          text: '',
          toolCalls: [
            {
              id: 't1',
              name: 'create_item',
              input: { title: 'Eco', kind: 'reminder', days: [0], start: '09:00' },
            },
          ],
        },
      ],
    })

    const result = await agent.chat(USER, 'bucle', NOW)

    expect(result.ok).toBe(true)
    expect(llm.calls).toHaveLength(5)
    // 5 llamadas al LLM = 4 rondas de ejecución; la quinta no ejecuta
    expect(items.calls.insert).toBe(4)
  })

  it('rate limit (spec §8): con 20 mensajes en 5 minutos ni siquiera llama al LLM', async () => {
    const { agent, chat, llm } = mkAgent({
      script: [{ text: 'no debería llegar', toolCalls: [] }],
      recentUserCount: 20,
    })

    const result = await agent.chat(USER, 'hola', NOW)

    expect(result).toMatchObject({ ok: false, reason: 'rate_limited' })
    expect(llm.calls).toHaveLength(0)
    expect(chat.persisted).toHaveLength(0)
  })

  it('rechaza mensajes vacíos o desmesurados sin llamar al LLM', async () => {
    const { agent, llm } = mkAgent({ script: [{ text: 'no', toolCalls: [] }] })
    expect(await agent.chat(USER, '   ', NOW)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(await agent.chat(USER, 'x'.repeat(2001), NOW)).toMatchObject({
      ok: false,
      reason: 'invalid',
    })
    expect(await agent.chat(USER, 42, NOW)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(llm.calls).toHaveLength(0)
  })

  it('las herramientas del agente jamás exponen user_id (spec §6.2)', () => {
    for (const tool of AGENT_TOOLS) {
      expect(JSON.stringify(tool.inputSchema)).not.toContain('user_id')
    }
  })
})
