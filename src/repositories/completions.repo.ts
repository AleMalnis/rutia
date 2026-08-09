import type { SupabaseClient } from '@supabase/supabase-js'
import { RepoError } from '@/repositories/items.repo'

// Repositorio de completions: un check por ítem y día (spec §5). La fecha la
// pone siempre el servidor, nunca el modelo ni el cliente (spec §6.2).

export function createCompletionsRepo(supabase: SupabaseClient) {
  return {
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
