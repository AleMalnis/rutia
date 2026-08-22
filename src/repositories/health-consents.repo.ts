import type { SupabaseClient } from '@supabase/supabase-js'
import { RepoError } from '@/repositories/items.repo'

// Repositorio de health_consents (spec §12.12): el registro auditable del
// consentimiento de datos de salud. Solo dos operaciones a propósito — saber
// si existe y registrarlo —: un consentimiento no se edita ni se borra
// (la RLS tampoco lo permitiría). Filtro explícito por user_id sobre la RLS.

export type HealthConsentRow = { version: string; acceptedAt: string }

export function createHealthConsentsRepo(supabase: SupabaseClient) {
  return {
    async has(userId: string, version: string): Promise<boolean> {
      const { data, error } = await supabase
        .from('health_consents')
        .select('version')
        .eq('user_id', userId)
        .eq('version', version)
        .maybeSingle()
      if (error) throw new RepoError(error.message, error.code)
      return data != null
    },

    async record(userId: string, version: string): Promise<void> {
      // idempotente: consentir dos veces la misma versión no es un error
      const { error } = await supabase
        .from('health_consents')
        .upsert({ user_id: userId, version }, { onConflict: 'user_id,version', ignoreDuplicates: true })
      if (error) throw new RepoError(error.message, error.code)
    },

    async listByUser(userId: string): Promise<HealthConsentRow[]> {
      const { data, error } = await supabase
        .from('health_consents')
        .select('version, accepted_at')
        .eq('user_id', userId)
        .order('accepted_at', { ascending: true })
      if (error) throw new RepoError(error.message, error.code)
      return (data ?? []).map((row) => ({
        version: (row as { version: string }).version,
        acceptedAt: (row as { accepted_at: string }).accepted_at,
      }))
    },
  }
}

export type HealthConsentsRepo = ReturnType<typeof createHealthConsentsRepo>
