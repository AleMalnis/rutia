import { describe, expect, it } from 'vitest'
import type { RoutineItem } from '@/lib/schemas'
import {
  createRoutineService,
  findBlockOverlaps,
  type BlockCandidate,
} from '@/services/routine.service'
import type { CategoriesRepo } from '@/repositories/categories.repo'
import type { CompletionsRepo } from '@/repositories/completions.repo'
import { RepoError, type ItemsRepo } from '@/repositories/items.repo'
import type { ProfilesRepo } from '@/repositories/profiles.repo'

// Los tests de este archivo no tocan completions ni el perfil: stubs inertes.
function deps(items: ItemsRepo) {
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
  return { items, completions, profiles, categories }
}

let seq = 0
function mkItem(partial: Partial<RoutineItem>): RoutineItem {
  seq += 1
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    title: `Ítem ${seq}`,
    kind: 'block',
    days: [0],
    start: '09:00',
    end: '10:00',
    categoryId: null,
    detail: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

function block(days: number[], start: string, end: string, partial?: Partial<RoutineItem>) {
  return mkItem({ kind: 'block', days, start, end, ...partial })
}

function reminder(days: number[], start: string, partial?: Partial<RoutineItem>) {
  return mkItem({ kind: 'reminder', days, start, end: null, ...partial })
}

function candidate(days: number[], start: string, end: string): BlockCandidate {
  return { kind: 'block', days, start, end }
}

describe('findBlockOverlaps', () => {
  it('detecta el choque entre bloques del mismo día con franjas pisadas', () => {
    const existing = block([0], '09:00', '11:00', { title: 'Trabajo' })
    const conflicts = findBlockOverlaps(candidate([0], '10:00', '12:00'), [existing])
    expect(conflicts).toEqual([
      { itemId: existing.id, title: 'Trabajo', days: [0], start: '09:00', end: '11:00' },
    ])
  })

  it('no hay conflicto si las franjas se pisan pero en días distintos', () => {
    const existing = block([1, 3], '09:00', '11:00')
    expect(findBlockOverlaps(candidate([0, 2], '09:00', '11:00'), [existing])).toEqual([])
  })

  it('tocarse en el borde (end == start) no es solape', () => {
    const existing = block([0], '09:00', '10:00')
    expect(findBlockOverlaps(candidate([0], '10:00', '11:00'), [existing])).toEqual([])
    expect(findBlockOverlaps(candidate([0], '08:00', '09:00'), [existing])).toEqual([])
  })

  it('una franja contenida dentro de otra es solape', () => {
    const existing = block([0], '09:00', '17:00')
    expect(findBlockOverlaps(candidate([0], '12:00', '13:00'), [existing])).toHaveLength(1)
  })

  it('franjas idénticas son solape', () => {
    const existing = block([0], '09:00', '10:00')
    expect(findBlockOverlaps(candidate([0], '09:00', '10:00'), [existing])).toHaveLength(1)
  })

  it('con ítems multi-día solo se reportan los días compartidos', () => {
    const existing = block([2, 4, 6], '09:00', '11:00')
    const conflicts = findBlockOverlaps(candidate([0, 2, 4], '10:00', '12:00'), [existing])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].days).toEqual([2, 4])
  })

  it('un candidato reminder nunca genera conflicto', () => {
    const existing = block([0], '09:00', '17:00')
    const cand: BlockCandidate = { kind: 'reminder', days: [0], start: '10:00', end: null }
    expect(findBlockOverlaps(cand, [existing])).toEqual([])
  })

  it('los reminders existentes se ignoran aunque caigan dentro del bloque', () => {
    const existing = reminder([0], '10:00')
    expect(findBlockOverlaps(candidate([0], '09:00', '17:00'), [existing])).toEqual([])
  })

  it('excludeId omite el propio ítem (caso de mover un bloque)', () => {
    const self = block([0], '09:00', '11:00')
    const other = block([0], '11:00', '12:00')
    expect(findBlockOverlaps(candidate([0], '09:30', '11:00'), [self, other], self.id)).toEqual([])
  })

  it('devuelve todos los bloques en conflicto, no solo el primero', () => {
    const a = block([0], '09:00', '10:30')
    const b = block([0], '10:00', '11:30')
    const conflicts = findBlockOverlaps(candidate([0], '10:00', '10:30'), [a, b])
    expect(conflicts.map((c) => c.itemId)).toEqual([a.id, b.id])
  })

  it('las franjas no cruzan la medianoche: un rango invertido no reporta conflictos', () => {
    // findBlockOverlaps es pública y no valida: fija la semántica real. Un
    // candidato con end < start (22:00-02:00) no tiene lectura wrap-around.
    const existing = block([0], '23:00', '23:30')
    expect(findBlockOverlaps(candidate([0], '22:00', '02:00'), [existing])).toEqual([])
  })

  it('un bloque hasta 23:59 no toca la madrugada del día siguiente', () => {
    const existing = block([0], '23:00', '23:59')
    expect(findBlockOverlaps(candidate([1], '00:00', '01:00'), [existing])).toEqual([])
  })

  it("la hora de fin '24:00' (medianoche exacta) participa del solape", () => {
    const existing = block([0], '23:30', '24:00')
    expect(findBlockOverlaps(candidate([0], '23:00', '24:00'), [existing])).toHaveLength(1)
  })

  it('un candidato block sin end no reporta conflictos (guard de entrada)', () => {
    const existing = block([0], '09:00', '17:00')
    const malformed: BlockCandidate = { kind: 'block', days: [0], start: '10:00', end: null }
    expect(findBlockOverlaps(malformed, [existing])).toEqual([])
  })

  it('el candidato que CONTIENE al bloque existente también es solape', () => {
    const existing = block([0], '12:00', '13:00')
    expect(findBlockOverlaps(candidate([0], '09:00', '17:00'), [existing])).toHaveLength(1)
  })
})

describe('RoutineService con repo en memoria', () => {
  function mkRepo(existing: RoutineItem[]) {
    const calls = { insert: 0, update: 0 }
    const repo: ItemsRepo = {
      async listByUser() {
        return existing
      },
      async getById(_userId, id) {
        return existing.find((item) => item.id === id) ?? null
      },
      async insert(_userId, item) {
        calls.insert += 1
        return mkItem({ ...item, end: item.end ?? null })
      },
      async update(_userId, id, item) {
        calls.update += 1
        return mkItem({ ...item, id, end: item.end ?? null })
      },
      async deleteMany(_userId, ids) {
        return existing.filter((item) => ids.includes(item.id)).length
      },
    }
    return { repo, calls }
  }

  const USER = 'user-1'

  it('createItem crea un bloque válido que no choca (camino feliz)', async () => {
    const { repo, calls } = mkRepo([block([0], '19:00', '20:30')])
    const service = createRoutineService(deps(repo))

    const result = await service.createItem(USER, {
      title: 'Estudio',
      kind: 'block',
      days: [0],
      start: '09:00',
      end: '10:00',
    })

    expect(result.ok).toBe(true)
    expect(calls.insert).toBe(1)
  })

  it("createItem acepta un bloque que termina a medianoche exacta ('24:00')", async () => {
    const { repo, calls } = mkRepo([])
    const service = createRoutineService(deps(repo))

    const result = await service.createItem(USER, {
      title: 'Lectura',
      kind: 'block',
      days: [5],
      start: '23:00',
      end: '24:00',
    })

    expect(result.ok).toBe(true)
    expect(calls.insert).toBe(1)
  })

  it('createItem devuelve el conflicto y NO escribe', async () => {
    const existing = block([0], '19:00', '20:30', { title: 'Gimnasio' })
    const { repo, calls } = mkRepo([existing])
    const service = createRoutineService(deps(repo))

    const result = await service.createItem(USER, {
      title: 'Inglés',
      kind: 'block',
      days: [0],
      start: '20:00',
      end: '21:00',
    })

    expect(result).toMatchObject({ ok: false, reason: 'conflict' })
    if (!result.ok && result.reason === 'conflict') {
      expect(result.conflicts[0].title).toBe('Gimnasio')
    }
    expect(calls.insert).toBe(0)
  })

  it('createItem crea un reminder aunque caiga dentro de un bloque', async () => {
    const { repo, calls } = mkRepo([block([0], '09:00', '17:00')])
    const service = createRoutineService(deps(repo))

    const result = await service.createItem(USER, {
      title: 'Medicación',
      kind: 'reminder',
      days: [0, 1, 2, 3, 4, 5, 6],
      start: '09:00',
      detail: 'Enalapril 10 mg',
    })

    expect(result.ok).toBe(true)
    expect(calls.insert).toBe(1)
  })

  it('createItem rechaza un bloque sin hora de fin sin tocar el repo', async () => {
    const { repo, calls } = mkRepo([])
    const service = createRoutineService(deps(repo))

    const result = await service.createItem(USER, {
      title: 'Trabajo',
      kind: 'block',
      days: [0],
      start: '09:00',
    })

    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(calls.insert).toBe(0)
  })

  it('updateItem detecta el conflicto al mover un bloque, excluyéndose a sí mismo', async () => {
    const self = block([3], '10:00', '11:00', { title: 'Inglés' })
    const other = block([3], '19:00', '20:30', { title: 'Gimnasio' })
    const { repo, calls } = mkRepo([self, other])
    const service = createRoutineService(deps(repo))

    const noConflict = await service.updateItem(USER, self.id, { start: '10:30', end: '11:30' })
    expect(noConflict.ok).toBe(true)

    const conflict = await service.updateItem(USER, self.id, { start: '19:00', end: '20:00' })
    expect(conflict).toMatchObject({ ok: false, reason: 'conflict' })
    expect(calls.update).toBe(1)
  })

  it('updateItem a reminder anula la hora de fin automáticamente', async () => {
    const self = block([0], '09:00', '10:00')
    const { repo } = mkRepo([self])
    const service = createRoutineService(deps(repo))

    const result = await service.updateItem(USER, self.id, { kind: 'reminder' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.item.end).toBeNull()
    }
  })

  it('updateItem devuelve not_found para un id inexistente sin escribir', async () => {
    const { repo, calls } = mkRepo([block([0], '09:00', '10:00')])
    const service = createRoutineService(deps(repo))

    const result = await service.updateItem(USER, '00000000-0000-4000-8000-999999999999', {
      title: 'Nada',
    })

    expect(result).toMatchObject({ ok: false, reason: 'not_found' })
    expect(calls.update).toBe(0)
  })

  it('la violación de la FK de categoría (23503) se traduce a invalid', async () => {
    const { repo } = mkRepo([])
    repo.insert = async () => {
      throw new RepoError(
        'insert or update on table "routine_items" violates foreign key constraint "routine_items_category_same_user"',
        '23503',
      )
    }
    const service = createRoutineService(deps(repo))

    const result = await service.createItem(USER, {
      title: 'Con categoría ajena',
      kind: 'reminder',
      days: [0],
      start: '09:00',
      categoryId: '00000000-0000-4000-8000-000000000abc',
    })

    expect(result).toEqual({
      ok: false,
      reason: 'invalid',
      message: 'La categoría indicada no existe.',
    })
  })

  it('los errores de repo que no son la FK de categoría se relanzan', async () => {
    const { repo } = mkRepo([])
    repo.insert = async () => {
      throw new RepoError('connection lost', '08006')
    }
    const service = createRoutineService(deps(repo))

    await expect(
      service.createItem(USER, { title: 'X', kind: 'reminder', days: [0], start: '09:00' }),
    ).rejects.toThrow('connection lost')
  })

  it('un 23503 de OTRA FK (user_id) no se disfraza de error de categoría', async () => {
    const { repo } = mkRepo([])
    repo.insert = async () => {
      throw new RepoError(
        'insert or update on table "routine_items" violates foreign key constraint "routine_items_user_id_fkey"',
        '23503',
      )
    }
    const service = createRoutineService(deps(repo))

    await expect(
      service.createItem(USER, { title: 'X', kind: 'reminder', days: [0], start: '09:00' }),
    ).rejects.toThrow('routine_items_user_id_fkey')
  })

  it('updateItem devuelve not_found si la fila desaparece entre lectura y escritura', async () => {
    const self = block([0], '09:00', '10:00')
    const { repo } = mkRepo([self])
    repo.update = async () => null
    const service = createRoutineService(deps(repo))

    const result = await service.updateItem(USER, self.id, { title: 'Renombrado' })
    expect(result).toMatchObject({ ok: false, reason: 'not_found' })
  })

  it('updateItem rechaza un parche vacío sin escribir', async () => {
    const self = block([0], '09:00', '10:00')
    const { repo, calls } = mkRepo([self])
    const service = createRoutineService(deps(repo))

    const result = await service.updateItem(USER, self.id, {})
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(calls.update).toBe(0)
  })

  it('deleteItems rechaza ids que no son UUID sin tocar el repo', async () => {
    const { repo } = mkRepo([block([0], '09:00', '10:00')])
    let deleteCalls = 0
    repo.deleteMany = async () => {
      deleteCalls += 1
      return 0
    }
    const service = createRoutineService(deps(repo))

    expect(await service.deleteItems(USER, ['no-es-uuid'])).toMatchObject({
      ok: false,
      reason: 'invalid',
    })
    expect(await service.deleteItems(USER, [])).toMatchObject({ ok: false, reason: 'invalid' })
    expect(deleteCalls).toBe(0)
  })

  it('deleteItems borra los existentes e informa del conteo real', async () => {
    const a = block([0], '09:00', '10:00')
    const { repo } = mkRepo([a])
    const service = createRoutineService(deps(repo))

    const result = await service.deleteItems(USER, [
      a.id,
      '00000000-0000-4000-8000-999999999999',
    ])
    expect(result).toEqual({ ok: true, deleted: 1 })
  })

  it('el NUL (U+0000) en title se rechaza en la frontera Zod', async () => {
    const { repo, calls } = mkRepo([])
    const service = createRoutineService(deps(repo))

    const result = await service.createItem(USER, {
      title: `a${String.fromCharCode(0)}b`,
      kind: 'reminder',
      days: [0],
      start: '09:00',
    })

    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(calls.insert).toBe(0)
  })
})
