import type { SupabaseClient } from '@supabase/supabase-js'
import type { Category, CategoryInput } from '@/lib/schemas'
import { RepoError } from '@/repositories/items.repo'

// Repositorio de categories (spec §7.2). Las 8 por defecto las siembra el
// trigger de registro; el usuario puede crear, renombrar y borrar las suyas.

type CategoryRow = {
  id: string
  name: string
  color: string
}

const COLUMNS = 'id, name, color'

export function createCategoriesRepo(supabase: SupabaseClient) {
  return {
    async listByUser(userId: string): Promise<Category[]> {
      const { data, error } = await supabase
        .from('categories')
        .select(COLUMNS)
        .eq('user_id', userId)
        .order('name')
      if (error) throw new RepoError(error.message, error.code)
      return data as CategoryRow[]
    },

    async insert(userId: string, input: CategoryInput): Promise<Category> {
      const { data, error } = await supabase
        .from('categories')
        .insert({ user_id: userId, name: input.name, color: input.color })
        .select(COLUMNS)
        .single()
      if (error) throw new RepoError(error.message, error.code)
      return data as CategoryRow
    },

    // null si la categoría ya no existe (borrada desde otra pestaña)
    async update(userId: string, id: string, input: CategoryInput): Promise<Category | null> {
      const { data, error } = await supabase
        .from('categories')
        .update({ name: input.name, color: input.color })
        .eq('user_id', userId)
        .eq('id', id)
        .select(COLUMNS)
        .maybeSingle()
      if (error) throw new RepoError(error.message, error.code)
      return data as CategoryRow | null
    },

    /** Los ítems de la categoría quedan «sin categoría» (FK on delete set null). */
    async deleteById(userId: string, id: string): Promise<number> {
      const { data, error } = await supabase
        .from('categories')
        .delete()
        .eq('user_id', userId)
        .eq('id', id)
        .select('id')
      if (error) throw new RepoError(error.message, error.code)
      return (data as { id: string }[]).length
    },
  }
}

export type CategoriesRepo = ReturnType<typeof createCategoriesRepo>
