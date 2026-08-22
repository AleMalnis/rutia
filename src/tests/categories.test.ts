import { describe, expect, it } from 'vitest'
import { CATEGORY_COLORS, categoryColorStyle } from '@/lib/category-colors'
import { categoryInputSchema, type Category } from '@/lib/schemas'
import type { CategoriesRepo } from '@/repositories/categories.repo'
import type { CompletionsRepo } from '@/repositories/completions.repo'
import { RepoError, type ItemsRepo } from '@/repositories/items.repo'
import type { ProfilesRepo } from '@/repositories/profiles.repo'
import type { HealthConsentsRepo } from '@/repositories/health-consents.repo'
import { createRoutineService } from '@/services/routine.service'

const USER = 'user-1'
const AZUL = CATEGORY_COLORS[0].light

function mkDeps(existing: Category[] = []) {
  const store = [...existing]
  let nextId = 1

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
    async insertMany() {
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
    async listAllByUser() {
      throw new Error('no usado')
    },
    async listItemIdsByDate() {
      return []
    },
    async markDone() {
      return true
    },
    async markUndone() {
      return true
    },
  }
  const profiles: ProfilesRepo = {
    async getProfile() {
      throw new Error('no usado')
    },
    async getTimezone() {
      return 'Europe/Madrid'
    },
    async setTimezone() {},
    async getPreferences() {
      return {}
    },
    async setPreference() {},
  }
  const categories: CategoriesRepo = {
    async listByUser() {
      return store
    },
    async insert(_u, input) {
      if (store.some((c) => c.name === input.name)) {
        throw new RepoError(
          'duplicate key value violates unique constraint "categories_user_id_name_key"',
          '23505',
        )
      }
      nextId += 1
      const category = {
        id: `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`,
        ...input,
      }
      store.push(category)
      return category
    },
    async update(_u, id, input) {
      const index = store.findIndex((c) => c.id === id)
      if (index === -1) return null
      store[index] = { id, ...input }
      return store[index]
    },
    async deleteById(_u, id) {
      const index = store.findIndex((c) => c.id === id)
      if (index === -1) return 0
      store.splice(index, 1)
      return 1
    },
  }
  // consentimiento del art. 9 dado por defecto: aquí se prueban categorías
  const consents: HealthConsentsRepo = {
    async has() {
      return true
    },
    async record() {},
    async listByUser() {
      return []
    },
  }
  return { deps: { items, completions, profiles, categories, consents }, store }
}

describe('categoryInputSchema', () => {
  it('acepta nombre y color del muestrario', () => {
    expect(categoryInputSchema.safeParse({ name: 'Piano', color: AZUL }).success).toBe(true)
  })

  it('rechaza colores fuera del muestrario validado', () => {
    const result = categoryInputSchema.safeParse({ name: 'Piano', color: '#a1ff00' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('muestrario')
    }
  })

  it('rechaza nombres vacíos o demasiado largos', () => {
    expect(categoryInputSchema.safeParse({ name: '   ', color: AZUL }).success).toBe(false)
    expect(
      categoryInputSchema.safeParse({ name: 'x'.repeat(41), color: AZUL }).success,
    ).toBe(false)
  })
})

describe('categoryColorStyle', () => {
  it('cada color del muestrario tiene su par claro/oscuro', () => {
    for (const color of CATEGORY_COLORS) {
      const style = categoryColorStyle(color.light)
      expect(style['--cat-light']).toBe(color.light)
      expect(style['--cat-dark']).toBe(color.dark)
    }
  })

  it('un color heredado fuera del muestrario usa el mismo hex en ambos modos', () => {
    const style = categoryColorStyle('#3b82f6')
    expect(style['--cat-light']).toBe('#3b82f6')
    expect(style['--cat-dark']).toBe('#3b82f6')
  })

  it('sin categoría usa el gris neutro', () => {
    const style = categoryColorStyle(null)
    expect(style['--cat-light']).toBe(style['--cat-dark'])
  })
})

describe('RoutineService: categorías propias', () => {
  it('crea una categoría válida', async () => {
    const { deps, store } = mkDeps()
    const result = await createRoutineService(deps).createCategory(USER, {
      name: 'Piano',
      color: AZUL,
    })

    expect(result.ok).toBe(true)
    expect(store).toHaveLength(1)
  })

  it('el nombre duplicado (23505) se traduce a un error claro', async () => {
    const { deps } = mkDeps()
    const service = createRoutineService(deps)
    await service.createCategory(USER, { name: 'Piano', color: AZUL })

    const result = await service.createCategory(USER, { name: 'Piano', color: AZUL })

    expect(result).toEqual({
      ok: false,
      reason: 'invalid',
      message: 'Ya existe una categoría con ese nombre.',
    })
  })

  it('rechaza un color fuera del muestrario sin tocar el repo', async () => {
    const { deps, store } = mkDeps()
    const result = await createRoutineService(deps).createCategory(USER, {
      name: 'Piano',
      color: '#bada55',
    })

    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(store).toHaveLength(0)
  })

  it('actualizar una categoría inexistente devuelve not_found', async () => {
    const { deps } = mkDeps()
    const result = await createRoutineService(deps).updateCategory(
      USER,
      '00000000-0000-4000-8000-999999999999',
      { name: 'Piano', color: AZUL },
    )

    expect(result).toMatchObject({ ok: false, reason: 'not_found' })
  })

  it('renombrar conservando un color heredado es posible', async () => {
    // fila anterior al muestrario que la migración respetó a propósito
    const legada: Category = {
      id: '00000000-0000-4000-8000-00000000ffff',
      name: 'Curro',
      color: '#3b82f6',
    }
    const { deps, store } = mkDeps([legada])

    const result = await createRoutineService(deps).updateCategory(USER, legada.id, {
      name: 'Trabajo',
      color: '#3b82f6',
    })

    expect(result.ok).toBe(true)
    expect(store[0]).toEqual({ id: legada.id, name: 'Trabajo', color: '#3b82f6' })
  })

  it('pero no se puede estrenar un color fuera del muestrario en una categoría existente', async () => {
    const legada: Category = {
      id: '00000000-0000-4000-8000-00000000ffff',
      name: 'Curro',
      color: '#3b82f6',
    }
    const { deps } = mkDeps([legada])

    const result = await createRoutineService(deps).updateCategory(USER, legada.id, {
      name: 'Curro',
      color: '#bada55',
    })

    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('borra una categoría existente e informa del conteo', async () => {
    const { deps, store } = mkDeps()
    const service = createRoutineService(deps)
    const created = await service.createCategory(USER, { name: 'Piano', color: AZUL })
    if (!created.ok) throw new Error('setup')

    const result = await service.deleteCategory(USER, created.category.id)

    expect(result).toEqual({ ok: true, deleted: 1 })
    expect(store).toHaveLength(0)
  })
})
