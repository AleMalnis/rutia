import { describe, expect, it } from 'vitest'
import { DEFAULT_TIMEZONE, itemsForDay, todayInTimezone } from '@/lib/today'
import type { RoutineItem } from '@/lib/schemas'
import { createRoutineService } from '@/services/routine.service'
import type { CompletionsRepo } from '@/repositories/completions.repo'
import type { ItemsRepo } from '@/repositories/items.repo'
import type { ProfilesRepo } from '@/repositories/profiles.repo'

let seq = 0
function mkItem(partial: Partial<RoutineItem>): RoutineItem {
  seq += 1
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    title: `Ítem ${seq}`,
    kind: 'reminder',
    days: [0],
    start: '09:00',
    end: null,
    categoryId: null,
    detail: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

describe('todayInTimezone', () => {
  it('usa la zona del usuario, no la del servidor', () => {
    // 23:30 del 1 de agosto en Madrid = 21:30 UTC del mismo día
    const now = new Date('2026-08-01T21:30:00Z')
    expect(todayInTimezone(now, 'Europe/Madrid')).toEqual({ date: '2026-08-01', weekday: 5 })
  })

  it('el mismo instante puede ser otro día en otra zona', () => {
    // 23:30 del 1 de agosto en Madrid ya es día 2 en Tokio
    const now = new Date('2026-08-01T21:30:00Z')
    expect(todayInTimezone(now, 'Asia/Tokyo').date).toBe('2026-08-02')
    expect(todayInTimezone(now, 'America/Argentina/Buenos_Aires').date).toBe('2026-08-01')
  })

  it('la semana empieza en lunes (0) y acaba en domingo (6)', () => {
    const lunes = new Date('2026-08-03T10:00:00Z')
    const domingo = new Date('2026-08-02T10:00:00Z')
    expect(todayInTimezone(lunes, 'Europe/Madrid').weekday).toBe(0)
    expect(todayInTimezone(domingo, 'Europe/Madrid').weekday).toBe(6)
  })

  it('cruza el cambio de día correctamente en UTC-3', () => {
    // 02:00 UTC del día 2 son las 23:00 del día 1 en Buenos Aires
    const now = new Date('2026-08-02T02:00:00Z')
    expect(todayInTimezone(now, 'America/Argentina/Buenos_Aires')).toEqual({
      date: '2026-08-01',
      weekday: 5,
    })
  })

  it('una zona horaria corrupta cae al valor por defecto en vez de romper', () => {
    const now = new Date('2026-08-01T10:00:00Z')
    expect(todayInTimezone(now, 'No/Existe')).toEqual(
      todayInTimezone(now, DEFAULT_TIMEZONE),
    )
  })
})

describe('itemsForDay', () => {
  it('incluye los ítems multi-día que caen en ese día', () => {
    const trabajo = mkItem({ title: 'Trabajo', days: [0, 1, 2, 3, 4] })
    const finde = mkItem({ title: 'Excursión', days: [5, 6] })
    expect(itemsForDay([trabajo, finde], 2).map((i) => i.title)).toEqual(['Trabajo'])
    expect(itemsForDay([trabajo, finde], 6).map((i) => i.title)).toEqual(['Excursión'])
  })

  it('ordena por hora de inicio', () => {
    const noche = mkItem({ title: 'Cena', start: '21:30', days: [0] })
    const manana = mkItem({ title: 'Medicación', start: '09:00', days: [0] })
    const tarde = mkItem({ title: 'Gimnasio', start: '19:00', days: [0] })
    expect(itemsForDay([noche, manana, tarde], 0).map((i) => i.title)).toEqual([
      'Medicación',
      'Gimnasio',
      'Cena',
    ])
  })

  it('a la misma hora, desempata por título de forma estable', () => {
    const b = mkItem({ title: 'Vitamina D', start: '09:00', days: [0] })
    const a = mkItem({ title: 'Enalapril', start: '09:00', days: [0] })
    expect(itemsForDay([b, a], 0).map((i) => i.title)).toEqual(['Enalapril', 'Vitamina D'])
  })

  it('un día sin nada devuelve lista vacía', () => {
    expect(itemsForDay([mkItem({ days: [0] })], 3)).toEqual([])
  })
})

describe('RoutineService: hoy y completado', () => {
  const USER = 'user-1'
  const NOW = new Date('2026-08-01T10:00:00Z') // sábado en Madrid → weekday 5

  function mkDeps(items: RoutineItem[], doneIds: string[] = [], timeZone = 'Europe/Madrid') {
    const marked = new Set(doneIds)
    const calls = { markDone: 0, markUndone: 0, setTimezone: 0 }
    let zone = timeZone
    const itemsRepo: ItemsRepo = {
      async listByUser() {
        return items
      },
      async getById(_u, id) {
        return items.find((i) => i.id === id) ?? null
      },
      async insert() {
        throw new Error('no usado')
      },
      async update() {
        throw new Error('no usado')
      },
      async deleteMany() {
        return 0
      },
    }
    const completions: CompletionsRepo = {
      async listItemIdsByDate() {
        return [...marked]
      },
      async markDone(_u, itemId) {
        calls.markDone += 1
        marked.add(itemId)
      },
      async markUndone(_u, itemId) {
        calls.markUndone += 1
        marked.delete(itemId)
      },
    }
    const profiles: ProfilesRepo = {
      async getTimezone() {
        return zone
      },
      async setTimezone(_u, tz) {
        calls.setTimezone += 1
        zone = tz
      },
    }
    return { deps: { items: itemsRepo, completions, profiles }, calls, marked, zone: () => zone }
  }

  it('listToday devuelve solo lo de hoy, en orden y con su check', async () => {
    const sabado = mkItem({ title: 'Pilates', days: [5], start: '11:00' })
    const diario = mkItem({ title: 'Medicación', days: [0, 1, 2, 3, 4, 5, 6], start: '09:00' })
    const lunes = mkItem({ title: 'Trabajo', days: [0], start: '09:00' })
    const { deps } = mkDeps([sabado, diario, lunes], [diario.id])

    const result = await createRoutineService(deps).listToday(USER, NOW)

    expect(result.date).toBe('2026-08-01')
    expect(result.weekday).toBe(5)
    expect(result.entries.map((e) => e.item.title)).toEqual(['Medicación', 'Pilates'])
    expect(result.entries.map((e) => e.done)).toEqual([true, false])
  })

  it('setCompleted marca con la fecha del servidor', async () => {
    const item = mkItem({ days: [5] })
    const { deps, calls, marked } = mkDeps([item])

    const result = await createRoutineService(deps).setCompleted(
      USER,
      item.id,
      true,
      NOW,
    )

    expect(result).toEqual({ ok: true, done: true })
    expect(calls.markDone).toBe(1)
    expect(marked.has(item.id)).toBe(true)
  })

  it('marcar dos veces es idempotente', async () => {
    const item = mkItem({ days: [5] })
    const { deps, marked } = mkDeps([item])
    const service = createRoutineService(deps)

    await service.setCompleted(USER, item.id, true, NOW)
    await service.setCompleted(USER, item.id, true, NOW)

    expect(marked.size).toBe(1)
  })

  it('la zona del perfil manda: el mismo instante puede ser otro día', async () => {
    const item = mkItem({ days: [0, 1, 2, 3, 4, 5, 6] })
    // 22:00 UTC del sábado ya es domingo en Tokio
    const nocheDelSabado = new Date('2026-08-01T22:00:00Z')
    const { deps } = mkDeps([item], [], 'Asia/Tokyo')

    const result = await createRoutineService(deps).listToday(USER, nocheDelSabado)

    expect(result.date).toBe('2026-08-02')
    expect(result.weekday).toBe(6)
  })

  it('no escribe si el panel del usuario es de otro día', async () => {
    const item = mkItem({ days: [0, 1, 2, 3, 4, 5, 6] })
    const { deps, calls } = mkDeps([item])

    const result = await createRoutineService(deps).setCompleted(
      USER,
      item.id,
      true,
      NOW,
      '2026-07-31', // el panel se pintó ayer y la pestaña quedó abierta
    )

    expect(result).toMatchObject({ ok: false, reason: 'stale' })
    expect(calls.markDone).toBe(0)
  })

  it('no deja marcar un ítem que hoy no toca', async () => {
    // NOW es sábado (weekday 5) y el ítem es solo de lunes
    const item = mkItem({ days: [0] })
    const { deps, calls } = mkDeps([item])

    const result = await createRoutineService(deps).setCompleted(USER, item.id, true, NOW)

    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(calls.markDone).toBe(0)
  })

  it('updateTimezone guarda solo si la zona es válida y ha cambiado', async () => {
    const { deps, calls, zone } = mkDeps([])
    const service = createRoutineService(deps)

    expect(await service.updateTimezone(USER, 'No/Existe')).toEqual({ ok: false })
    expect(calls.setTimezone).toBe(0)

    expect(await service.updateTimezone(USER, 'Europe/Madrid')).toEqual({ ok: true })
    expect(calls.setTimezone).toBe(0) // ya era esa

    expect(await service.updateTimezone(USER, 'America/Mexico_City')).toEqual({ ok: true })
    expect(calls.setTimezone).toBe(1)
    expect(zone()).toBe('America/Mexico_City')
  })

  it('desmarcar algo que no estaba marcado no falla', async () => {
    const item = mkItem({ days: [5] })
    const { deps, marked } = mkDeps([item])

    const result = await createRoutineService(deps).setCompleted(
      USER,
      item.id,
      false,
      NOW,
    )

    expect(result).toEqual({ ok: true, done: false })
    expect(marked.size).toBe(0)
  })

  it('no se puede marcar un ítem de otro usuario aunque se conozca su id', async () => {
    // el repo filtra por user_id: getById devuelve null y no se escribe nada
    const { deps, calls } = mkDeps([])

    const result = await createRoutineService(deps).setCompleted(
      USER,
      '00000000-0000-4000-8000-999999999999',
      true,
      NOW,
    )

    expect(result).toMatchObject({ ok: false, reason: 'not_found' })
    expect(calls.markDone).toBe(0)
  })

  it('rechaza un id que no es UUID sin tocar el repo', async () => {
    const { deps, calls } = mkDeps([])

    const result = await createRoutineService(deps).setCompleted(
      USER,
      'no-es-uuid',
      true,
      NOW,
    )

    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(calls.markDone).toBe(0)
  })
})
