import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_TIMEZONE } from '@/lib/today'
import { RepoError } from '@/repositories/items.repo'

// Repositorio de profiles. El perfil lo crea el trigger de registro.

export function createProfilesRepo(supabase: SupabaseClient) {
  return {
    async getTimezone(userId: string): Promise<string> {
      const { data, error } = await supabase
        .from('profiles')
        .select('timezone')
        .eq('id', userId)
        .maybeSingle()
      if (error) throw new RepoError(error.message, error.code)
      const timezone = (data as { timezone: string | null } | null)?.timezone
      return timezone == null || timezone === '' ? DEFAULT_TIMEZONE : timezone
    },

    async setTimezone(userId: string, timezone: string): Promise<void> {
      const { error } = await supabase
        .from('profiles')
        .update({ timezone })
        .eq('id', userId)
      if (error) throw new RepoError(error.message, error.code)
    },
  }
}

export type ProfilesRepo = ReturnType<typeof createProfilesRepo>
