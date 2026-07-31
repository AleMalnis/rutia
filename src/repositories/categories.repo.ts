import type { SupabaseClient } from '@supabase/supabase-js'
import type { Category } from '@/lib/schemas'
import { RepoError } from '@/repositories/items.repo'

// Repositorio de categories (spec §7.2). Las 8 por defecto las siembra el
// trigger de registro; aquí solo lectura por ahora.

type CategoryRow = {
  id: string
  name: string
  color: string
}

export function createCategoriesRepo(supabase: SupabaseClient) {
  return {
    async listByUser(userId: string): Promise<Category[]> {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, color')
        .eq('user_id', userId)
        .order('name')
      if (error) throw new RepoError(error.message, error.code)
      return data as CategoryRow[]
    },
  }
}

export type CategoriesRepo = ReturnType<typeof createCategoriesRepo>
