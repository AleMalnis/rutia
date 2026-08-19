import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllPages } from '@/lib/pagination'
import { RepoError } from '@/repositories/items.repo'

// Repositorio de completions: un check por ítem y día (spec §5). La fecha la
// pone siempre el servidor, nunca el modelo ni el cliente (spec §6.2).

export type CompletionRecord = {
  itemId: string
  date: string
  completedAt: string
}

export function createCompletionsRepo(supabase: SupabaseClient) {
  return {
    /**
     * Todo el historial de checks, para la exportación de datos (§12.13).
     * Paginado: PostgREST corta en Max Rows (1000) sin error, y un export
     * parcial que dice ser completo es el peor fallo posible aquí.
     */
    async listAllByUser(userId: string): Promise<CompletionRecord[]> {
      type Row = { item_id: string; date: string; completed_at: string }
      const rows = await fetchAllPages<Row>(1000, async (from, to) => {
        const { data, error, count } = await supabase
          .from('completions')
          .select('item_id, date, completed_at', { count: 'exact' })
          .eq('user_id', userId)
          .order('date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
        if (error) throw new RepoError(error.message, error.code)
        return { rows: data as Row[], count }
      })
      return rows.map((row) => ({
        itemId: row.item_id,
        date: row.date,
        completedAt: row.completed_at,
      }))
    },

    /** Ids de los ítems marcados como hechos en esa fecha. */
    async listItemIdsByDate(userId: string, date: string): Promise<string[]> {
      const { data, error } = await supabase
        .from('completions')
        .select('item_id')
        .eq('user_id', userId)
        .eq('date', date)
      if (error) throw new RepoError(error.message, error.code)
      return (data as { item_id: string }[]).map((row) => row.item_id)
    },

    /**
     * Idempotente: marcar dos veces el mismo ítem y día no falla. Devuelve si
     * de verdad escribió: con ignoreDuplicates, la fila que ya existía no se
     * inserta y no vuelve en el select.
     */
    async markDone(userId: string, itemId: string, date: string): Promise<boolean> {
      const { data, error } = await supabase
        .from('completions')
        .upsert(
          { user_id: userId, item_id: itemId, date },
          { onConflict: 'item_id,date', ignoreDuplicates: true },
        )
        .select('id')
      if (error) throw new RepoError(error.message, error.code)
      return (data as { id: string }[]).length > 0
    },

    /** Idempotente: desmarcar algo que no estaba marcado no falla. */
    async markUndone(userId: string, itemId: string, date: string): Promise<boolean> {
      const { data, error } = await supabase
        .from('completions')
        .delete()
        .eq('user_id', userId)
        .eq('item_id', itemId)
        .eq('date', date)
        .select('id')
      if (error) throw new RepoError(error.message, error.code)
      return (data as { id: string }[]).length > 0
    },
  }
}

export type CompletionsRepo = ReturnType<typeof createCompletionsRepo>
