import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WeekPoster } from '@/components/week-poster'
import type { Category, RoutineItem } from '@/lib/schemas'

// La lámina (spec §4, Must #13) es presentación pura sin hooks, así que se
// puede renderizar en Node tal cual. Esto no valida píxeles —eso solo lo da
// mirarla—, pero sí que no revienta y que lo esencial está en el marcado:
// exactamente el tipo de regresión que un refactor introduce sin que el
// build se entere.

function mkItem(partial: Partial<RoutineItem>): RoutineItem {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Ítem',
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

const CATEGORY: Category = {
  id: '00000000-0000-4000-8000-00000000cat1',
  name: 'Deporte',
  color: '#2a78d6',
}

describe('WeekPoster', () => {
  const items = [
    mkItem({ title: 'Gimnasio', detail: 'Pierna', categoryId: CATEGORY.id, days: [0, 2] }),
    mkItem({
      id: '00000000-0000-4000-8000-000000000002',
      title: 'Medicación',
      kind: 'reminder',
      start: '09:00',
      end: null,
      days: [0, 1, 2, 3, 4, 5, 6],
    }),
  ]

  const html = renderToStaticMarkup(
    createElement(WeekPoster, {
      items,
      categories: [CATEGORY],
      date: '2026-08-17',
      weekday: 0,
    }),
  )

  it('lleva título, fecha en palabras y la semana entera', () => {
    expect(html).toContain('Mi semana')
    expect(html).toContain('Lunes, 17 de agosto')
    for (const day of ['Lunes', 'Domingo']) expect(html).toContain(day)
    expect(html).toContain('07:00')
    expect(html).toContain('23:00')
  })

  it('pinta bloques con su color de categoría y chips de recordatorio', () => {
    expect(html).toContain('Gimnasio')
    expect(html).toContain('Pierna')
    expect(html).toContain('#2a78d6')
    expect(html).toContain('Medicación')
  })

  it('la leyenda solo lista categorías en uso', () => {
    expect(html).toContain('Deporte')
    const unused: Category = { ...CATEGORY, id: '00000000-0000-4000-8000-00000000cat2', name: 'Ocio' }
    const withUnused = renderToStaticMarkup(
      createElement(WeekPoster, {
        items,
        categories: [CATEGORY, unused],
        date: '2026-08-17',
        weekday: 0,
      }),
    )
    expect(withUnused).not.toContain('Ocio')
  })

  it('con la rutina vacía sigue siendo una lámina válida, sin leyenda', () => {
    const empty = renderToStaticMarkup(
      createElement(WeekPoster, { items: [], categories: [CATEGORY], date: '2026-08-17', weekday: 0 }),
    )
    expect(empty).toContain('Mi semana')
    expect(empty).not.toContain('Deporte')
  })
})
