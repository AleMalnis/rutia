import type { SupabaseClient } from '@supabase/supabase-js'
import type { LlmProviderId } from '@/lib/llm-providers'
import { RepoError } from '@/repositories/items.repo'

// Repositorio de llm_settings (spec §5): la clave BYOK cifrada, una fila por
// usuario. Aquí solo viaja el blob cifrado; cifrar y descifrar es cosa del
// servicio (lib/crypto.ts). Filtro explícito por user_id sobre la RLS.

export type LlmSettingsRow = {
  provider: LlmProviderId
  apiKeyEncrypted: string
}

const COLUMNS = 'provider, api_key_encrypted'

export function createLlmSettingsRepo(supabase: SupabaseClient) {
  return {
    async get(userId: string): Promise<LlmSettingsRow | null> {
      const { data, error } = await supabase
        .from('llm_settings')
        .select(COLUMNS)
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw new RepoError(error.message, error.code)
      if (data == null) return null
      const row = data as { provider: LlmProviderId; api_key_encrypted: string }
      return { provider: row.provider, apiKeyEncrypted: row.api_key_encrypted }
    },

    async upsert(userId: string, provider: LlmProviderId, apiKeyEncrypted: string): Promise<void> {
      const { error } = await supabase
        .from('llm_settings')
        .upsert(
          { user_id: userId, provider, api_key_encrypted: apiKeyEncrypted },
          { onConflict: 'user_id' },
        )
      if (error) throw new RepoError(error.message, error.code)
    },

    async remove(userId: string): Promise<void> {
      const { error } = await supabase.from('llm_settings').delete().eq('user_id', userId)
      if (error) throw new RepoError(error.message, error.code)
    },
  }
}

export type LlmSettingsRepo = ReturnType<typeof createLlmSettingsRepo>
