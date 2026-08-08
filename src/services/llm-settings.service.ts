import { decryptSecret, encryptSecret } from '@/lib/crypto'
import type { LlmProviderId } from '@/lib/llm-providers'
import { llmKeyInputSchema } from '@/lib/schemas'
import type { LlmSettingsRepo } from '@/repositories/llm-settings.repo'

// Ajustes de IA del usuario (BYOK, spec §6.4). La clave se cifra aquí antes
// de tocar el repositorio y solo se descifra para construir el LLMClient de
// una petición. Hacia el cliente nunca viaja la clave: solo el proveedor y
// los últimos 4 caracteres, para que el usuario reconozca cuál guardó.

/** Lo único que puede ver el navegador sobre la clave guardada. */
export type LlmKeyStatus = {
  provider: LlmProviderId
  last4: string
}

export type LlmCredentials = {
  provider: LlmProviderId
  apiKey: string
}

export type SaveKeyResult =
  | { ok: true; status: LlmKeyStatus }
  | { ok: false; reason: 'invalid'; message: string }

export function createLlmSettingsService({ repo }: { repo: LlmSettingsRepo }) {
  return {
    /** Estado para pintar Ajustes: proveedor y cola de la clave, nada más. */
    async getStatus(userId: string): Promise<LlmKeyStatus | null> {
      const row = await repo.get(userId)
      if (row == null) return null
      const apiKey = decryptSecret(row.apiKeyEncrypted)
      return { provider: row.provider, last4: apiKey.slice(-4) }
    },

    /** Credenciales en claro, SOLO para construir el LLMClient en el servidor. */
    async getCredentials(userId: string): Promise<LlmCredentials | null> {
      const row = await repo.get(userId)
      if (row == null) return null
      return { provider: row.provider, apiKey: decryptSecret(row.apiKeyEncrypted) }
    },

    async saveKey(userId: string, input: unknown): Promise<SaveKeyResult> {
      const parsed = llmKeyInputSchema.safeParse(input)
      if (!parsed.success) {
        return {
          ok: false,
          reason: 'invalid',
          message: parsed.error.issues[0]?.message ?? 'Datos inválidos.',
        }
      }
      const { provider, apiKey } = parsed.data
      await repo.upsert(userId, provider, encryptSecret(apiKey))
      return { ok: true, status: { provider, last4: apiKey.slice(-4) } }
    },

    async deleteKey(userId: string): Promise<void> {
      await repo.remove(userId)
    },
  }
}

export type LlmSettingsService = ReturnType<typeof createLlmSettingsService>
