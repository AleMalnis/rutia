import { describe, expect, it } from 'vitest'
import { parseItemForm } from '@/lib/item-form'
import { createRoutineItemSchema } from '@/lib/schemas'

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData()
  for (const [key, value] of entries) data.append(key, value)
  return data
}

describe('parseItemForm', () => {
  it('convierte un bloque completo del formulario', () => {
    const parsed = parseItemForm(
      form([
        ['title', 'Gimnasio'],
        ['kind', 'block'],
        ['days', '0'],
        ['days', '2'],
        ['start', '19:00'],
        ['end', '20:30'],
        ['categoryId', '00000000-0000-4000-8000-000000000001'],
        ['detail', ''],
      ]),
    )

    expect(parsed).toEqual({
      title: 'Gimnasio',
      kind: 'block',
      days: [0, 2],
      start: '19:00',
      end: '20:30',
      categoryId: '00000000-0000-4000-8000-000000000001',
      detail: null,
    })
    expect(createRoutineItemSchema.safeParse(parsed).success).toBe(true)
  })

  it('un recordatorio no arrastra la hora de fin aunque el formulario la envíe', () => {
    const parsed = parseItemForm(
      form([
        ['title', 'Medicación'],
        ['kind', 'reminder'],
        ['days', '0'],
        ['start', '09:00'],
        ['end', '10:00'],
        ['detail', 'Enalapril 10 mg'],
      ]),
    )

    expect(parsed.end).toBeNull()
    expect(parsed.detail).toBe('Enalapril 10 mg')
    expect(createRoutineItemSchema.safeParse(parsed).success).toBe(true)
  })

  it('los campos opcionales vacíos se convierten en null, no en cadena vacía', () => {
    const parsed = parseItemForm(
      form([
        ['title', 'Estudio'],
        ['kind', 'reminder'],
        ['days', '3'],
        ['start', '18:00'],
        ['categoryId', ''],
        ['detail', '   '],
      ]),
    )

    expect(parsed.categoryId).toBeNull()
    expect(parsed.detail).toBeNull()
  })

  it('sin días marcados devuelve un array vacío que Zod rechaza', () => {
    const parsed = parseItemForm(
      form([
        ['title', 'Sin días'],
        ['kind', 'reminder'],
        ['start', '09:00'],
      ]),
    )

    expect(parsed.days).toEqual([])
    const result = createRoutineItemSchema.safeParse(parsed)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('al menos un día')
    }
  })

  it('recorta los espacios del título', () => {
    const parsed = parseItemForm(
      form([
        ['title', '  Cena  '],
        ['kind', 'reminder'],
        ['days', '1'],
        ['start', '21:30'],
      ]),
    )

    expect(parsed.title).toBe('Cena')
  })

  it('un bloque sin hora de fin la deja en null para que Zod dé el error claro', () => {
    const parsed = parseItemForm(
      form([
        ['title', 'Trabajo'],
        ['kind', 'block'],
        ['days', '0'],
        ['start', '09:00'],
        ['end', ''],
      ]),
    )

    expect(parsed.end).toBeNull()
    const result = createRoutineItemSchema.safeParse(parsed)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('hora de fin')
    }
  })
})
