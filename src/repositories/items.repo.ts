import type { SupabaseClient } from '@supabase/supabase-js'
import type { CreateRoutineItemInput, RoutineItem } from '@/lib/schemas'

// Repositorio de routine_items: único punto de acceso a la tabla (spec §7.2).
// Recibe el cliente por parámetro porque en servidor se crea uno por petición.
// El filtro explícito por user_id es defensa en profundidad sobre la RLS.

export class RepoError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'RepoError'
    this.code = code
  }
}

type RoutineItemRow = {
  id: string
  title: string
  kind: 'block' | 'reminder'
  days: number[]
  start_time: string
  end_time: string | null
  category_id: string | null
  detail: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

const COLUMNS =
  'id, title, kind, days, start_time, end_time, category_id, detail, notes, created_at, updated_at'

// Postgres devuelve time como 'HH:MM:SS'; el dominio trabaja con 'HH:MM'.
function toTime(value: string): string {
  return value.slice(0, 5)
}

function toItem(row: RoutineItemRow): RoutineItem {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    days: row.days,
    start: toTime(row.start_time),
    end: row.end_time == null ? null : toTime(row.end_time),
    categoryId: row.category_id,
    detail: row.detail,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toRow(data: CreateRoutineItemInput): Omit<RoutineItemRow, 'id' | 'created_at' | 'updated_at'> {
  return {
    title: data.title,
    kind: data.kind,
    days: data.days,
    start_time: data.start,
    end_time: data.end ?? null,
    category_id: data.categoryId ?? null,
    detail: data.detail ?? null,
    notes: data.notes ?? null,
  }
}

export function createItemsRepo(supabase: SupabaseClient) {
  return {
    async listByUser(userId: string): Promise<RoutineItem[]> {
      const { data, error } = await supabase
        .from('routine_items')
        .select(COLUMNS)
        .eq('user_id', userId)
        .order('start_time')
        .order('created_at')
      if (error) throw new RepoError(error.message, error.code)
      return (data as RoutineItemRow[]).map(toItem)
    },

    async getById(userId: string, id: string): Promise<RoutineItem | null> {
      const { data, error } = await supabase
        .from('routine_items')
        .select(COLUMNS)
        .eq('user_id', userId)
        .eq('id', id)
        .maybeSingle()
      if (error) throw new RepoError(error.message, error.code)
      return data == null ? null : toItem(data as RoutineItemRow)
    },

    async insert(userId: string, item: CreateRoutineItemInput): Promise<RoutineItem> {
      const { data, error } = await supabase
        .from('routine_items')
        .insert({ ...toRow(item), user_id: userId })
        .select(COLUMNS)
        .single()
      if (error) throw new RepoError(error.message, error.code)
      return toItem(data as RoutineItemRow)
    },

    // Devuelve null si el ítem ya no existe (p. ej. borrado desde la otra
    // puerta entre la lectura y esta escritura): con .single() eso sería un
    // error PGRST116 en vez de un not_found manejable.
    // Deuda registrada (spec §12): si el lost-update entre puertas se vuelve
    // real, añadir aquí updated_at como revisión esperada en el WHERE.
    async update(
      userId: string,
      id: string,
      item: CreateRoutineItemInput,
    ): Promise<RoutineItem | null> {
      const { data, error } = await supabase
        .from('routine_items')
        .update(toRow(item))
        .eq('user_id', userId)
        .eq('id', id)
        .select(COLUMNS)
        .maybeSingle()
      if (error) throw new RepoError(error.message, error.code)
      return data == null ? null : toItem(data as RoutineItemRow)
    },

    async deleteMany(userId: string, ids: string[]): Promise<number> {
      const { data, error } = await supabase
        .from('routine_items')
        .delete()
        .eq('user_id', userId)
        .in('id', ids)
        .select('id')
      if (error) throw new RepoError(error.message, error.code)
      return (data as { id: string }[]).length
    },
  }
}

export type ItemsRepo = ReturnType<typeof createItemsRepo>
