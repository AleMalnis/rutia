import { z } from 'zod'
import {
  createRoutineItemSchema,
  routineItemDataSchema,
  updateRoutineItemSchema,
  type CreateRoutineItemInput,
  type RoutineItem,
} from '@/lib/schemas'
import { RepoError, type ItemsRepo } from '@/repositories/items.repo'

// RoutineService (spec §7.2): toda la lógica de la rutina vive aquí. Los
// server actions y las futuras herramientas del agente llaman a este servicio;
// nadie escribe en los repositorios directamente. El userId llega siempre de
// la sesión del servidor, jamás del modelo (spec §6.2).

// ── Detección de solapes (spec §6.2) ─────────────────────────────────────────
// Solo chocan BLOQUES que compartan algún día y cuyas franjas se pisen; los
// recordatorios nunca generan conflicto (tomar la pastilla en horario de
// trabajo es lo normal). Funciones puras: los tests unitarios entran por aquí.

export type BlockCandidate = {
  kind: 'block' | 'reminder'
  days: number[]
  start: string
  end?: string | null
}

export type OverlapConflict = {
  itemId: string
  title: string
  days: number[]
  start: string
  end: string
}

// Franjas [start, end) sobre strings 'HH:MM': el ancho fijo hace válida la
// comparación lexicográfica. Tocarse en el borde (end == start) no es solape.
function timesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA < endB && startB < endA
}

function sharedDays(a: number[], b: number[]): number[] {
  const set = new Set(b)
  return a.filter((day) => set.has(day))
}

export function findBlockOverlaps(
  candidate: BlockCandidate,
  items: RoutineItem[],
  excludeId?: string,
): OverlapConflict[] {
  if (candidate.kind !== 'block' || candidate.end == null) return []

  const conflicts: OverlapConflict[] = []
  for (const item of items) {
    if (item.kind !== 'block' || item.end == null) continue
    if (excludeId !== undefined && item.id === excludeId) continue
    const days = sharedDays(candidate.days, item.days)
    if (days.length === 0) continue
    if (!timesOverlap(candidate.start, candidate.end, item.start, item.end)) continue
    conflicts.push({ itemId: item.id, title: item.title, days, start: item.start, end: item.end })
  }
  return conflicts
}

// ── Resultados del servicio ──────────────────────────────────────────────────
// El conflicto no es una excepción: es un resultado que el agente negocia con
// el usuario (la herramienta no escribe y propone alternativas, spec §6.2).

export type ServiceFailure =
  | { ok: false; reason: 'invalid'; message: string }
  | { ok: false; reason: 'not_found'; message: string }
  | { ok: false; reason: 'conflict'; conflicts: OverlapConflict[] }

export type ItemResult = { ok: true; item: RoutineItem } | ServiceFailure
export type ListResult = { ok: true; items: RoutineItem[] }
export type DeleteResult = { ok: true; deleted: number } | ServiceFailure

const idSchema = z.uuid('El id del ítem debe ser un UUID.')
const idsSchema = z
  .array(idSchema, 'Se espera un array de ids.')
  .min(1, 'Indica al menos un ítem a borrar.')

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Datos inválidos.'
}

// La FK compuesta rechaza categorías de otro usuario o inexistentes con un
// 23503; se traduce a un resultado negociable en vez de reventar. Se comprueba
// el nombre de la constraint porque routine_items tiene otra FK (user_id →
// auth.users) que también daría 23503 y NO es un problema de categoría.
function categoryFkFailure(error: unknown): ServiceFailure | null {
  if (
    error instanceof RepoError &&
    error.code === '23503' &&
    error.message.includes('routine_items_category_same_user')
  ) {
    return { ok: false, reason: 'invalid', message: 'La categoría indicada no existe.' }
  }
  return null
}

// NOTA para bulk_create_items (herramienta futura, spec §6.2): NO componerla
// como bucle de createItem — un conflicto a mitad de lote dejaría escritura
// parcial. Debe validar todo el lote, comprobar solapes contra lo existente y
// entre los propios ítems del lote (findBlockOverlaps), y solo entonces
// insertar en una única llamada.
export function createRoutineService(itemsRepo: ItemsRepo) {
  return {
    async listItems(userId: string): Promise<ListResult> {
      return { ok: true, items: await itemsRepo.listByUser(userId) }
    },

    async createItem(userId: string, input: unknown): Promise<ItemResult> {
      const parsed = createRoutineItemSchema.safeParse(input)
      if (!parsed.success) {
        return { ok: false, reason: 'invalid', message: firstIssue(parsed.error) }
      }

      if (parsed.data.kind === 'block') {
        const existing = await itemsRepo.listByUser(userId)
        const conflicts = findBlockOverlaps(parsed.data, existing)
        if (conflicts.length > 0) return { ok: false, reason: 'conflict', conflicts }
      }

      try {
        return { ok: true, item: await itemsRepo.insert(userId, parsed.data) }
      } catch (error) {
        const failure = categoryFkFailure(error)
        if (failure) return failure
        throw error
      }
    },

    async updateItem(userId: string, itemId: unknown, patch: unknown): Promise<ItemResult> {
      const parsedId = idSchema.safeParse(itemId)
      if (!parsedId.success) {
        return { ok: false, reason: 'invalid', message: firstIssue(parsedId.error) }
      }
      const parsedPatch = updateRoutineItemSchema.safeParse(patch)
      if (!parsedPatch.success) {
        return { ok: false, reason: 'invalid', message: firstIssue(parsedPatch.error) }
      }

      const current = await itemsRepo.getById(userId, parsedId.data)
      if (current == null) {
        return { ok: false, reason: 'not_found', message: 'El ítem no existe.' }
      }

      // Mezcla: el parche pisa solo los campos presentes. Si pasa a
      // recordatorio sin tocar end, el end del bloque se anula solo.
      const changes = Object.fromEntries(
        Object.entries(parsedPatch.data).filter(([, value]) => value !== undefined),
      )
      const merged: CreateRoutineItemInput = {
        title: current.title,
        kind: current.kind,
        days: current.days,
        start: current.start,
        end: current.end,
        categoryId: current.categoryId,
        detail: current.detail,
        notes: current.notes,
        ...changes,
      }
      if (merged.kind === 'reminder' && changes.end === undefined) {
        merged.end = null
      }

      const validated = routineItemDataSchema.safeParse(merged)
      if (!validated.success) {
        return { ok: false, reason: 'invalid', message: firstIssue(validated.error) }
      }

      if (validated.data.kind === 'block') {
        const existing = await itemsRepo.listByUser(userId)
        const conflicts = findBlockOverlaps(validated.data, existing, parsedId.data)
        if (conflicts.length > 0) return { ok: false, reason: 'conflict', conflicts }
      }

      try {
        const updated = await itemsRepo.update(userId, parsedId.data, validated.data)
        if (updated == null) {
          // borrado por la otra puerta entre la lectura y esta escritura
          return { ok: false, reason: 'not_found', message: 'El ítem no existe.' }
        }
        return { ok: true, item: updated }
      } catch (error) {
        const failure = categoryFkFailure(error)
        if (failure) return failure
        throw error
      }
    },

    async deleteItems(userId: string, itemIds: unknown): Promise<DeleteResult> {
      const parsed = idsSchema.safeParse(itemIds)
      if (!parsed.success) {
        return { ok: false, reason: 'invalid', message: firstIssue(parsed.error) }
      }
      return { ok: true, deleted: await itemsRepo.deleteMany(userId, parsed.data) }
    },
  }
}

export type RoutineService = ReturnType<typeof createRoutineService>
