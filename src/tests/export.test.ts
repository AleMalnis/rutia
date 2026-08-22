import { describe, expect, it } from 'vitest'
import type { Category, RoutineItem } from '@/lib/schemas'
import type { CategoriesRepo } from '@/repositories/categories.repo'
import type { ChatRepo } from '@/repositories/chat.repo'
import type { CompletionsRepo } from '@/repositories/completions.repo'
import { RepoError, type ItemsRepo } from '@/repositories/items.repo'
import type { LlmSettingsRepo } from '@/repositories/llm-settings.repo'
import type { ProfilesRepo } from '@/repositories/profiles.repo'
import type { HealthConsentsRepo } from '@/repositories/health-consents.repo'
import { createExportService } from '@/services/export.service'

// Exportación de datos (spec §12.13). Lo que estos tests protegen de verdad:
// (1) que la clave de API no sale en NINGUNA forma — es la única pieza que se
// excluye a propósito y una regresión aquí sería una fuga—; (2) que el export
// es completo, porque la política de privacidad promete «todo lo tuyo» y un
// export parcial la desmentiría.

const USER = 'user-1'
const NOW = new Date('2026-08-19T10:00:00Z')

const ITEM: RoutineItem = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Medicación',
  kind: 'reminder',
  days: [0, 1, 2, 3, 4, 5, 6],
  start: '09:00',
  end: null,
  categoryId: null,
  detail: 'Enalapril 10 mg',
  notes: 'Recetada en junio',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
}

const CATEGORY: Category = {
  id: '00000000-0000-4000-8000-00000000cat1',
  name: 'Salud',
  color: '#e34948',
}

function mkService(
  overrides: {
    llmRow?: { provider: 'anthropic'; api_key_encrypted: string } | null
    consentsError?: RepoError
  } = {},
) {
  const profiles = {
    getProfile: async () => ({
      displayName: 'Ale',
      timezone: 'Europe/Madrid',
      preferences: { appearance: { mode: 'auto', theme: 'pizarra', font: 'rounded' } },
    }),
  } as unknown as ProfilesRepo
  const categories = { listByUser: async () => [CATEGORY] } as unknown as CategoriesRepo
  const items = { listByUser: async () => [ITEM] } as unknown as ItemsRepo
  const completions = {
    listAllByUser: async () => [
      { itemId: ITEM.id, date: '2026-08-18', completedAt: '2026-08-18T07:05:00Z' },
    ],
  } as unknown as CompletionsRepo
  const chat = {
    listAll: async () => [
      {
        id: 'm1',
        role: 'user' as const,
        content: 'Recuérdame la medicación a las 9',
        toolCalls: null,
        createdAt: '2026-06-01T09:00:00Z',
      },
    ],
  } as unknown as ChatRepo
  const llmSettings = {
    get: async () =>
      overrides.llmRow === undefined
        ? { provider: 'anthropic' as const, api_key_encrypted: 'v1:SECRETO-CIFRADO-QUE-NO-DEBE-SALIR' }
        : overrides.llmRow,
  } as unknown as LlmSettingsRepo
  const healthConsents: HealthConsentsRepo = {
    async has() {
      return true
    },
    async record() {},
    async listByUser() {
      if (overrides.consentsError) throw overrides.consentsError
      return [{ version: '2026-08-22', acceptedAt: '2026-08-22T10:00:00Z' }]
    },
  }
  return createExportService({ profiles, categories, items, completions, chat, llmSettings, healthConsents })
}

describe('ExportService.buildExport', () => {
  it('la clave de API no sale en NINGUNA forma, ni cifrada', async () => {
    const data = await mkService().buildExport(USER, 'ale@ejemplo.com', NOW)
    const raw = JSON.stringify(data)
    expect(raw).not.toContain('SECRETO')
    expect(raw).not.toContain('api_key')
    expect(raw).not.toContain('apiKey')
    // el proveedor sí: es el dato que el usuario nos dio
    expect(data.ajustes_ia).toEqual({ proveedor: 'anthropic' })
  })

  it('sin clave configurada, ajustes_ia es null', async () => {
    const data = await mkService({ llmRow: null }).buildExport(USER, 'ale@ejemplo.com', NOW)
    expect(data.ajustes_ia).toBeNull()
  })

  it('el consentimiento de salud sale con versión y fecha (art. 15)', async () => {
    const data = await mkService().buildExport(USER, 'ale@ejemplo.com', NOW)
    expect(data.consentimientos_salud).toEqual([
      { version: '2026-08-22', aceptado_en: '2026-08-22T10:00:00Z' },
    ])
  })

  it('sin la tabla de la 0010 (PGRST205) el export sale sin consentimientos, no en 500', async () => {
    const service = mkService({ consentsError: new RepoError('no existe', 'PGRST205') })
    const data = await service.buildExport(USER, 'ale@ejemplo.com', NOW)
    expect(data.consentimientos_salud).toEqual([])
  })

  it('cualquier otro error de consentimientos sigue siendo fatal', async () => {
    const service = mkService({ consentsError: new RepoError('caída real', '57014') })
    await expect(service.buildExport(USER, 'ale@ejemplo.com', NOW)).rejects.toThrow('caída real')
  })

  it('exporta TODO lo prometido por la política: perfil, rutina con notas, checks y conversación', async () => {
    const data = await mkService().buildExport(USER, 'ale@ejemplo.com', NOW)
    expect(data.formato).toBe('rutia-export')
    expect(data.cuenta).toEqual({ correo: 'ale@ejemplo.com' })
    expect(data.exportado_en).toBe('2026-08-19T10:00:00.000Z')
    expect(data.perfil).toEqual({
      nombre: 'Ale',
      zona_horaria: 'Europe/Madrid',
      preferencias: { appearance: { mode: 'auto', theme: 'pizarra', font: 'rounded' } },
    })
    expect(data.categorias).toEqual([{ id: CATEGORY.id, nombre: 'Salud', color: '#e34948' }])
    expect(data.rutina).toEqual([
      {
        id: ITEM.id,
        tipo: 'reminder',
        dias: [0, 1, 2, 3, 4, 5, 6],
        inicio: '09:00',
        fin: null,
        titulo: 'Medicación',
        categoria_id: null,
        // las notas VIAJAN: la política promete el export completo, y las
        // notas son justo donde pueden vivir los datos sensibles del usuario
        detalle: 'Enalapril 10 mg',
        notas: 'Recetada en junio',
        creado_en: '2026-06-01T00:00:00Z',
        actualizado_en: '2026-06-01T00:00:00Z',
      },
    ])
    expect(data.completados).toEqual([
      { item_id: ITEM.id, fecha: '2026-08-18', completado_en: '2026-08-18T07:05:00Z' },
    ])
    expect(data.conversacion).toEqual([
      {
        rol: 'user',
        contenido: 'Recuérdame la medicación a las 9',
        herramientas: null,
        fecha: '2026-06-01T09:00:00Z',
      },
    ])
  })
})
