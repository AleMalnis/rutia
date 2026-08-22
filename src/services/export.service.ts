import type { ChatRepo } from '@/repositories/chat.repo'
import type { CategoriesRepo } from '@/repositories/categories.repo'
import type { CompletionsRepo } from '@/repositories/completions.repo'
import { RepoError, type ItemsRepo } from '@/repositories/items.repo'
import type { HealthConsentsRepo } from '@/repositories/health-consents.repo'
import type { LlmSettingsRepo } from '@/repositories/llm-settings.repo'
import type { ProfilesRepo } from '@/repositories/profiles.repo'

// Exportación de datos (spec §12.13, RGPD art. 15 y 20): TODO lo del usuario
// en un JSON, ensamblado aquí para que sea testeable sin red. Claves en
// español: el destinatario es el usuario (el modo MCP usa su propia
// serialización, pensada para el modelo del cliente).
//
// Lo que NO va, a propósito (documentado también en la política, apartado 9):
// - La clave de API — ni cifrada. Un blob cifrado es inútil fuera del servidor
//   (el secreto no viaja), así que no es un dato del usuario: es una tentación
//   de soporte. Se exporta solo el proveedor elegido.
// - Las fechas técnicas de registro/inicios de sesión y los grants OAuth del
//   modo MCP: viven en el schema auth de Supabase, fuera del alcance de la
//   sesión del propio usuario. El correo sí va: llega en los claims y es el
//   dato ancla de la cuenta.

export type ExportDeps = {
  profiles: ProfilesRepo
  categories: CategoriesRepo
  items: ItemsRepo
  completions: CompletionsRepo
  chat: ChatRepo
  llmSettings: LlmSettingsRepo
  healthConsents: HealthConsentsRepo
}

export function createExportService(deps: ExportDeps) {
  return {
    // el tipo se INFIERE: así la ruta ve perfil.zona_horaria tipado y no
    // necesita ningún cast sobre el payload
    async buildExport(userId: string, email: string | null, now: Date) {
      const [profile, categories, items, completions, conversation, llm, consents] = await Promise.all([
        deps.profiles.getProfile(userId),
        deps.categories.listByUser(userId),
        deps.items.listByUser(userId),
        deps.completions.listAllByUser(userId),
        deps.chat.listAll(userId),
        deps.llmSettings.get(userId),
        // resiliente al despliegue-antes-de-migración: si la tabla de la 0010
        // aún no existe (PGRST205), el export sale sin consentimientos en vez
        // de morir en 500; cualquier otro error sigue siendo fatal
        deps.healthConsents.listByUser(userId).catch((error: unknown) => {
          if (error instanceof RepoError && error.code === 'PGRST205') return []
          throw error
        }),
      ])

      return {
        formato: 'rutia-export',
        version: 1,
        exportado_en: now.toISOString(),
        cuenta: { correo: email },
        perfil: {
          nombre: profile.displayName,
          zona_horaria: profile.timezone,
          preferencias: profile.preferences,
        },
        categorias: categories.map((category) => ({
          id: category.id,
          nombre: category.name,
          color: category.color,
        })),
        rutina: items.map((item) => ({
          id: item.id,
          tipo: item.kind,
          dias: item.days,
          inicio: item.start,
          fin: item.end,
          titulo: item.title,
          categoria_id: item.categoryId,
          detalle: item.detail,
          notas: item.notes,
          creado_en: item.createdAt,
          actualizado_en: item.updatedAt,
        })),
        completados: completions.map((completion) => ({
          item_id: completion.itemId,
          fecha: completion.date,
          completado_en: completion.completedAt,
        })),
        conversacion: conversation.map((message) => ({
          rol: message.role,
          contenido: message.content,
          herramientas: message.toolCalls,
          fecha: message.createdAt,
        })),
        // solo el proveedor: la clave no sale del servidor en ninguna forma
        ajustes_ia: llm == null ? null : { proveedor: llm.provider },
        // el registro auditable del art. 9 también es un dato del usuario
        consentimientos_salud: consents.map((consent) => ({
          version: consent.version,
          aceptado_en: consent.acceptedAt,
        })),
      }
    },
  }
}

export type ExportService = ReturnType<typeof createExportService>
