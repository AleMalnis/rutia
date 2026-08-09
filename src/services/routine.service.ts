import { z } from 'zod'
import { normalizeAppearance, type Appearance } from '@/lib/appearance'
import {
  appearanceSchema,
  categoryInputSchema,
  categoryUpdateSchema,
  createRoutineItemSchema,
  daySchema,
  endTimeSchema,
  routineItemDataSchema,
  timeSchema,
  updateRoutineItemSchema,
  type Category,
  type CreateRoutineItemInput,
  type RoutineItem,
} from '@/lib/schemas'
import { DEFAULT_TIMEZONE, isValidTimezone, itemsForDay, todayInTimezone } from '@/lib/today'
import type { CategoriesRepo } from '@/repositories/categories.repo'
import type { CompletionsRepo } from '@/repositories/completions.repo'
import { RepoError, type ItemsRepo } from '@/repositories/items.repo'
import type { ProfilesRepo } from '@/repositories/profiles.repo'

// RoutineService (spec §7.2): toda la lógica de la rutina vive aquí. Los
// server actions y las futuras herramientas del agente llaman a este servicio;
// nadie escribe en los repositorios directamente. El userId llega siempre de
// la sesión del servidor, jamás del modelo (spec §6.2).

// ── Detección de solapes (spec §6.2) ─────────────────────────────────────────
// Solo chocan BLOQUES que compartan algún día y cuyas franjas se pisen; los
// recordatorios nunca generan conflicto (tomar la pastilla en horario de
// trabajo es lo normal). Funciones puras: los tests unitarios entran por aquí.
// Deuda registrada (spec §12): esta comprobación vive solo en el servicio;
// el refuerzo a nivel de BD (trigger de exclusión) queda aplazado a proposito.

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

/** Un ítem de hoy con su estado de completado (spec §4, panel «Hoy»). */
export type TodayEntry = { item: RoutineItem; done: boolean }
export type TodayResult = {
  ok: true
  date: string
  weekday: number
  timeZone: string
  entries: TodayEntry[]
}
export type CompletedResult =
  // `changed` distingue «se ha escrito» de «ya estaba así»: marcar dos veces
  // es idempotente, y quien decida si hubo cambio real (el agente) no puede
  // deducirlo de `ok`.
  | { ok: true; done: boolean; changed: boolean }
  | ServiceFailure
  // el panel que el usuario tiene delante es de otro día: no se escribe
  | { ok: false; reason: 'stale'; message: string }

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

export type CategoryResult = { ok: true; category: Category } | ServiceFailure
export type BulkCreateResult = { ok: true; items: RoutineItem[] } | ServiceFailure
export type ClearDayResult =
  | { ok: true; updated: RoutineItem[]; deletedIds: string[] }
  | ServiceFailure

// Lote de creación (bulk_create_items, spec §6.2). El tope de 50 acota el
// coste de una llamada del agente; una rutina inicial completa ronda los 20.
const bulkItemsSchema = z
  .array(routineItemDataSchema, 'Se espera un array de ítems.')
  .min(1, 'El lote necesita al menos un ítem.')
  .max(50, 'El lote no puede superar los 50 ítems.')

// clear_day (spec §6.2): día obligatorio, franja opcional pero completa.
const clearDaySchema = z
  .object({
    day: daySchema,
    from: timeSchema.optional(),
    to: endTimeSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.from == null) !== (value.to == null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'La franja necesita hora de inicio y de fin.',
      })
    } else if (value.from != null && value.to != null && value.to <= value.from) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'El fin de la franja debe ser posterior al inicio.',
      })
    }
  })

// ¿Cae el ítem dentro de la franja [from, to)? Un bloque cuenta si su tramo
// la pisa; un recordatorio, si su hora está dentro.
function itemInRange(item: RoutineItem, from: string, to: string): boolean {
  if (item.kind === 'block' && item.end != null) {
    return timesOverlap(item.start, item.end, from, to)
  }
  return from <= item.start && item.start < to
}

export type RoutineDeps = {
  items: ItemsRepo
  completions: CompletionsRepo
  profiles: ProfilesRepo
  categories: CategoriesRepo
}

// unique(user_id, name) en BD: el duplicado llega como 23505
function duplicateCategoryFailure(error: unknown): ServiceFailure | null {
  if (error instanceof RepoError && error.code === '23505') {
    return { ok: false, reason: 'invalid', message: 'Ya existe una categoría con ese nombre.' }
  }
  return null
}

export function createRoutineService({
  items: itemsRepo,
  completions: completionsRepo,
  profiles: profilesRepo,
  categories: categoriesRepo,
}: RoutineDeps) {
  return {
    async listItems(userId: string): Promise<ListResult> {
      return { ok: true, items: await itemsRepo.listByUser(userId) }
    },

    /**
     * Lo que toca hoy, en orden, con su check. La zona horaria se resuelve
     * aquí desde el perfil: es lógica de dominio (spec §7.2) y así las dos
     * puertas —web y, más adelante, el agente— ven siempre el mismo «hoy».
     */
    async listToday(userId: string, now: Date): Promise<TodayResult> {
      const stored = await profilesRepo.getTimezone(userId)
      // el timeZone devuelto es el EFECTIVO: si el guardado está corrupto,
      // todayInTimezone ya calcula con el de por defecto y aquí se refleja
      const timeZone = isValidTimezone(stored) ? stored : DEFAULT_TIMEZONE
      const { date, weekday } = todayInTimezone(now, timeZone)
      const [all, doneIds] = await Promise.all([
        itemsRepo.listByUser(userId),
        completionsRepo.listItemIdsByDate(userId, date),
      ])
      const done = new Set(doneIds)
      const entries = itemsForDay(all, weekday).map((item) => ({
        item,
        done: done.has(item.id),
      }))
      return { ok: true, date, weekday, timeZone, entries }
    },

    /**
     * Marca o desmarca un ítem como hecho HOY. Idempotente en ambos sentidos.
     * `expectedDate` es la fecha para la que se pintó el panel del usuario: si
     * el día ha cambiado mientras la pestaña estaba abierta, no se escribe
     * nada (marcar la medicación de ayer en la fecha de hoy sería peor que no
     * marcarla). Es obligatorio y explícito: con `null` se renuncia a esa
     * comprobación a sabiendas (el agente actúa sobre el estado del servidor,
     * no sobre una vista que pueda estar caducada), y así nadie se la salta por
     * olvidarse de pasar el parámetro.
     */
    async setCompleted(
      userId: string,
      itemId: unknown,
      done: boolean,
      now: Date,
      expectedDate: string | null,
    ): Promise<CompletedResult> {
      const parsedId = idSchema.safeParse(itemId)
      if (!parsedId.success) {
        return { ok: false, reason: 'invalid', message: firstIssue(parsedId.error) }
      }

      const timeZone = await profilesRepo.getTimezone(userId)
      const { date, weekday } = todayInTimezone(now, timeZone)
      if (expectedDate != null && expectedDate !== date) {
        return {
          ok: false,
          reason: 'stale',
          message: 'El día ha cambiado; se ha actualizado tu panel.',
        }
      }

      // sin esta comprobación, la FK dejaría marcar un ítem ajeno cuyo id se
      // conozca: las claves foráneas no pasan por la RLS
      const item = await itemsRepo.getById(userId, parsedId.data)
      if (item == null) {
        return { ok: false, reason: 'not_found', message: 'El ítem no existe.' }
      }

      // un check sobre un día en el que el ítem no toca no lo mostraría nunca
      // ningún panel: quedaría como fila huérfana imposible de desmarcar
      if (!item.days.includes(weekday)) {
        return { ok: false, reason: 'invalid', message: 'Ese ítem no toca hoy.' }
      }

      const changed = done
        ? await completionsRepo.markDone(userId, parsedId.data, date)
        : await completionsRepo.markUndone(userId, parsedId.data, date)
      return { ok: true, done, changed }
    },

    async listCategories(userId: string): Promise<Category[]> {
      return categoriesRepo.listByUser(userId)
    },

    async createCategory(userId: string, input: unknown): Promise<CategoryResult> {
      const parsed = categoryInputSchema.safeParse(input)
      if (!parsed.success) {
        return { ok: false, reason: 'invalid', message: firstIssue(parsed.error) }
      }
      try {
        return { ok: true, category: await categoriesRepo.insert(userId, parsed.data) }
      } catch (error) {
        const failure = duplicateCategoryFailure(error)
        if (failure) return failure
        throw error
      }
    },

    async updateCategory(userId: string, categoryId: unknown, input: unknown): Promise<CategoryResult> {
      const parsedId = idSchema.safeParse(categoryId)
      if (!parsedId.success) {
        return { ok: false, reason: 'invalid', message: firstIssue(parsedId.error) }
      }

      // se admite conservar el color actual aunque sea heredado (ver schema)
      const current = (await categoriesRepo.listByUser(userId)).find(
        (category) => category.id === parsedId.data,
      )
      if (current == null) {
        return { ok: false, reason: 'not_found', message: 'La categoría no existe.' }
      }

      const parsed = categoryUpdateSchema(current.color).safeParse(input)
      if (!parsed.success) {
        return { ok: false, reason: 'invalid', message: firstIssue(parsed.error) }
      }
      try {
        const category = await categoriesRepo.update(userId, parsedId.data, parsed.data)
        if (category == null) {
          return { ok: false, reason: 'not_found', message: 'La categoría no existe.' }
        }
        return { ok: true, category }
      } catch (error) {
        const failure = duplicateCategoryFailure(error)
        if (failure) return failure
        throw error
      }
    },

    /** Los ítems de la categoría borrada quedan «sin categoría». */
    async deleteCategory(userId: string, categoryId: unknown): Promise<DeleteResult> {
      const parsedId = idSchema.safeParse(categoryId)
      if (!parsedId.success) {
        return { ok: false, reason: 'invalid', message: firstIssue(parsedId.error) }
      }
      return { ok: true, deleted: await categoriesRepo.deleteById(userId, parsedId.data) }
    },

    /** Apariencia guardada, con valores por defecto si falta o es inválida. */
    async getAppearance(userId: string): Promise<Appearance> {
      const preferences = await profilesRepo.getPreferences(userId)
      return normalizeAppearance(preferences.appearance)
    },

    async updateAppearance(
      userId: string,
      input: unknown,
    ): Promise<{ ok: true; appearance: Appearance } | ServiceFailure> {
      const parsed = appearanceSchema.safeParse(input)
      if (!parsed.success) {
        return { ok: false, reason: 'invalid', message: firstIssue(parsed.error) }
      }
      await profilesRepo.setPreference(userId, 'appearance', parsed.data)
      return { ok: true, appearance: parsed.data }
    },

    /**
     * Guarda la zona horaria real del navegador (spec §5: profiles.timezone).
     * `changed` distingue «guardado» de «ya era esa», para que el llamador no
     * invalide la caché en cada montaje del panel.
     */
    async updateTimezone(
      userId: string,
      timezone: unknown,
    ): Promise<{ ok: boolean; changed: boolean }> {
      if (!isValidTimezone(timezone)) return { ok: false, changed: false }
      const current = await profilesRepo.getTimezone(userId)
      if (current === timezone) return { ok: true, changed: false }
      await profilesRepo.setTimezone(userId, timezone)
      return { ok: true, changed: true }
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

    /**
     * bulk_create_items (spec §6.2): rutina inicial o cambios masivos.
     * Todo-o-nada: se valida el lote completo, se comprueban solapes contra lo
     * existente Y entre los propios ítems del lote, y solo si todo está limpio
     * se inserta en UNA llamada. Nunca componer como bucle de createItem: un
     * conflicto a mitad dejaría escritura parcial.
     */
    async bulkCreateItems(userId: string, input: unknown): Promise<BulkCreateResult> {
      const parsed = bulkItemsSchema.safeParse(input)
      if (!parsed.success) {
        return { ok: false, reason: 'invalid', message: firstIssue(parsed.error) }
      }
      const batch = parsed.data

      // solapes dentro del propio lote: el lote está mal formado, no es un
      // conflicto negociable con la rutina existente
      for (let i = 0; i < batch.length; i++) {
        const candidate = batch[i]
        if (candidate.kind !== 'block' || candidate.end == null) continue
        for (let j = i + 1; j < batch.length; j++) {
          const other = batch[j]
          if (other.kind !== 'block' || other.end == null) continue
          if (sharedDays(candidate.days, other.days).length === 0) continue
          if (!timesOverlap(candidate.start, candidate.end, other.start, other.end)) continue
          return {
            ok: false,
            reason: 'invalid',
            message: `Los ítems «${candidate.title}» y «${other.title}» del lote se solapan entre sí.`,
          }
        }
      }

      const existing = await itemsRepo.listByUser(userId)
      const conflicts: OverlapConflict[] = []
      const seen = new Set<string>()
      for (const candidate of batch) {
        for (const conflict of findBlockOverlaps(candidate, existing)) {
          if (seen.has(conflict.itemId)) continue
          seen.add(conflict.itemId)
          conflicts.push(conflict)
        }
      }
      if (conflicts.length > 0) return { ok: false, reason: 'conflict', conflicts }

      try {
        return { ok: true, items: await itemsRepo.insertMany(userId, batch) }
      } catch (error) {
        const failure = categoryFkFailure(error)
        if (failure) return failure
        throw error
      }
    },

    /**
     * clear_day (spec §6.2): quita ese día del array de los ítems afectados;
     * si un ítem se queda sin días, se borra. Con franja, solo afecta a lo que
     * cae dentro de [from, to). Los borrados van en una sola llamada; las
     * actualizaciones, una a una (quitar un día no puede crear solapes, así
     * que no se re-comprueban).
     */
    async clearDay(userId: string, input: unknown): Promise<ClearDayResult> {
      const parsed = clearDaySchema.safeParse(input)
      if (!parsed.success) {
        return { ok: false, reason: 'invalid', message: firstIssue(parsed.error) }
      }
      const { day, from, to } = parsed.data

      const all = await itemsRepo.listByUser(userId)
      const affected = all.filter(
        (item) =>
          item.days.includes(day) && (from == null || to == null || itemInRange(item, from, to)),
      )

      const toDelete = affected.filter((item) => item.days.length === 1)
      const toUpdate = affected.filter((item) => item.days.length > 1)

      const deletedIds: string[] = []
      if (toDelete.length > 0) {
        await itemsRepo.deleteMany(
          userId,
          toDelete.map((item) => item.id),
        )
        deletedIds.push(...toDelete.map((item) => item.id))
      }

      const updated: RoutineItem[] = []
      for (const item of toUpdate) {
        const result = await itemsRepo.update(userId, item.id, {
          title: item.title,
          kind: item.kind,
          days: item.days.filter((d) => d !== day),
          start: item.start,
          end: item.end,
          categoryId: item.categoryId,
          detail: item.detail,
          notes: item.notes,
        })
        // null = borrado por la otra puerta entre la lectura y esta escritura
        if (result != null) updated.push(result)
      }

      return { ok: true, updated, deletedIds }
    },
  }
}

export type RoutineService = ReturnType<typeof createRoutineService>
