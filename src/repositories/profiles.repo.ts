import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_TIMEZONE } from '@/lib/today'
import { RepoError } from '@/repositories/items.repo'

// Repositorio de profiles. El perfil lo crea el trigger de registro.

export function createProfilesRepo(supabase: SupabaseClient) {
  return {
    /** El perfil entero de una vez, para la exportación de datos (§12.13). */
    async getProfile(
      userId: string,
    ): Promise<{ displayName: string | null; timezone: string; preferences: Record<string, unknown> }> {
      const { data, error } = await supabase
        .from('profiles')
        .select('display_name, timezone, preferences')
        .eq('id', userId)
        .maybeSingle()
      if (error) throw new RepoError(error.message, error.code)
      const row = data as {
        display_name: string | null
        timezone: string | null
        preferences: Record<string, unknown> | null
      } | null
      return {
        displayName: row?.display_name ?? null,
        timezone: row?.timezone == null || row.timezone === '' ? DEFAULT_TIMEZONE : row.timezone,
        preferences: row?.preferences ?? {},
      }
    },

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

    async getPreferences(userId: string): Promise<Record<string, unknown>> {
      const { data, error } = await supabase
        .from('profiles')
        .select('preferences')
        .eq('id', userId)
        .maybeSingle()
      if (error) throw new RepoError(error.message, error.code)
      const preferences = (data as { preferences: unknown } | null)?.preferences
      return typeof preferences === 'object' && preferences != null
        ? (preferences as Record<string, unknown>)
        : {}
    },

    /**
     * Sobrescribe una clave de preferences conservando las demás.
     * Deuda conocida: es un leer-mezclar-escribir no atómico. Hoy `appearance`
     * es la única clave y el peor caso es last-write-wins entre pestañas; si
     * algún día hay una segunda clave, esto debe pasar a un merge atómico en
     * BD (`preferences = preferences || $1` vía función SQL + rpc).
     */
    async setPreference(userId: string, key: string, value: unknown): Promise<void> {
      const current = await this.getPreferences(userId)
      const { error } = await supabase
        .from('profiles')
        .update({ preferences: { ...current, [key]: value } })
        .eq('id', userId)
      if (error) throw new RepoError(error.message, error.code)
    },
  }
}

export type ProfilesRepo = ReturnType<typeof createProfilesRepo>
