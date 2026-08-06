import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  THEME_IDS,
} from '@/lib/appearance'
import { appearanceSchema } from '@/lib/schemas'
import type { CategoriesRepo } from '@/repositories/categories.repo'
import type { CompletionsRepo } from '@/repositories/completions.repo'
import type { ItemsRepo } from '@/repositories/items.repo'
import type { ProfilesRepo } from '@/repositories/profiles.repo'
import { createRoutineService } from '@/services/routine.service'

const USER = 'user-1'

function mkDeps(initialPreferences: Record<string, unknown> = {}) {
  let preferences = initialPreferences
  const items: ItemsRepo = {
    async listByUser() {
      return []
    },
    async getById() {
      return null
    },
    async insert() {
      throw new Error('no usado')
    },
    async update() {
      return null
    },
    async deleteMany() {
      return 0
    },
  }
  const completions: CompletionsRepo = {
    async listItemIdsByDate() {
      return []
    },
    async markDone() {},
    async markUndone() {},
  }
  const profiles: ProfilesRepo = {
    async getTimezone() {
      return 'Europe/Madrid'
    },
    async setTimezone() {},
    async getPreferences() {
      return preferences
    },
    async setPreference(_u, key, value) {
      preferences = { ...preferences, [key]: value }
    },
  }
  const categories: CategoriesRepo = {
    async listByUser() {
      return []
    },
    async insert() {
      throw new Error('no usado')
    },
    async update() {
      return null
    },
    async deleteById() {
      return 0
    },
  }
  return { deps: { items, completions, profiles, categories }, prefs: () => preferences }
}

describe('normalizeAppearance', () => {
  it('sin preferencias devuelve los valores por defecto', () => {
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance({})).toEqual(DEFAULT_APPEARANCE)
  })

  it('un campo inválido cae a su valor por defecto sin arrastrar a los demás', () => {
    expect(
      normalizeAppearance({ mode: 'neón', theme: 'pizarra', font: 'serif' }),
    ).toEqual({ mode: 'auto', theme: 'pizarra', font: 'serif' })
  })

  it('valores manipulados (tipos raros) no rompen', () => {
    expect(normalizeAppearance({ mode: 7, theme: ['x'], font: {} })).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance('cadena')).toEqual(DEFAULT_APPEARANCE)
  })

  it('acepta todos los temas publicados', () => {
    for (const theme of THEME_IDS) {
      expect(normalizeAppearance({ theme }).theme).toBe(theme)
    }
  })
})

describe('appearanceSchema', () => {
  it('acepta una apariencia completa válida', () => {
    expect(
      appearanceSchema.safeParse({ mode: 'dark', theme: 'bosque', font: 'rounded' }).success,
    ).toBe(true)
  })

  it('rechaza temas fuera de la lista', () => {
    const result = appearanceSchema.safeParse({ mode: 'auto', theme: 'fucsia', font: 'system' })
    expect(result.success).toBe(false)
  })
})

describe('ProfilesRepo.setPreference (merge real, no el del mock)', () => {
  it('el UPDATE enviado a la BD conserva las claves existentes de preferences', async () => {
    let updatePayload: Record<string, unknown> | null = null

    // stub mínimo del cliente de Supabase: select devuelve preferences con
    // otra clave; update captura el payload que se enviaría a la BD
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: { preferences: { otraClave: 'intacta' } }, error: null }
                  },
                }
              },
            }
          },
          update(payload: Record<string, unknown>) {
            updatePayload = payload
            return {
              async eq() {
                return { error: null }
              },
            }
          },
        }
      },
    }

    const { createProfilesRepo } = await import('@/repositories/profiles.repo')
    // doble cast honesto: el stub cubre solo la porción del cliente que usa
    // este repositorio, no la superficie completa de SupabaseClient
    const repo = createProfilesRepo(supabase as unknown as SupabaseClient)
    await repo.setPreference(USER, 'appearance', { mode: 'dark' })

    expect(updatePayload).toEqual({
      preferences: { otraClave: 'intacta', appearance: { mode: 'dark' } },
    })
  })
})

describe('RoutineService: apariencia', () => {
  it('getAppearance normaliza lo guardado', async () => {
    const { deps } = mkDeps({ appearance: { mode: 'dark', theme: 'uva', font: 'serif' } })
    expect(await createRoutineService(deps).getAppearance(USER)).toEqual({
      mode: 'dark',
      theme: 'uva',
      font: 'serif',
    })
  })

  it('updateAppearance guarda sin pisar otras claves de preferences', async () => {
    const { deps, prefs } = mkDeps({ otraClave: 'intacta' })
    const service = createRoutineService(deps)

    const result = await service.updateAppearance(USER, {
      mode: 'light',
      theme: 'arena',
      font: 'rounded',
    })

    expect(result.ok).toBe(true)
    expect(prefs()).toEqual({
      otraClave: 'intacta',
      appearance: { mode: 'light', theme: 'arena', font: 'rounded' },
    })
  })

  it('updateAppearance rechaza entradas inválidas sin escribir', async () => {
    const { deps, prefs } = mkDeps()
    const result = await createRoutineService(deps).updateAppearance(USER, {
      mode: 'light',
      theme: 'no-existe',
      font: 'system',
    })

    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(prefs()).toEqual({})
  })
})
