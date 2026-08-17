import { DAY_NAMES } from '@/lib/calendar'
import type { RoutineItem } from '@/lib/schemas'

// Qué día es «hoy» y qué toca en él. La fecha y el día de la semana se
// calculan SIEMPRE en la zona horaria del usuario, no en la del servidor: a
// las 23:30 en Madrid, un servidor en UTC ya estaría en el día siguiente y el
// panel mostraría la rutina equivocada.

export const DEFAULT_TIMEZONE = 'Europe/Madrid'

// 0=lunes … 6=domingo (spec §5).
const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
}

export type Today = {
  /** Fecha en formato ISO (YYYY-MM-DD), la que se guarda en completions. */
  date: string
  /** Día de la semana, 0=lunes … 6=domingo. */
  weekday: number
}

/** ¿Es un identificador IANA que este runtime entiende? */
export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export function todayInTimezone(now: Date, timeZone: string): Today {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).formatToParts(now)
  } catch {
    // una zona horaria corrupta en el perfil no debe romper el panel
    if (timeZone !== DEFAULT_TIMEZONE) return todayInTimezone(now, DEFAULT_TIMEZONE)
    throw new Error('No se pudo calcular la fecha actual.')
  }

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ''

  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    weekday: WEEKDAY_INDEX[part('weekday')] ?? 0,
  }
}

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

/**
 * La fecha de hoy en palabras: «Domingo, 16 de agosto» (spec §4, la fecha es
 * la protagonista de la cabecera).
 *
 * Se compone de las PARTES de la cadena ISO y del weekday que ya vienen
 * calculados en el huso del usuario. Deliberadamente no se construye un `Date`
 * intermedio: `new Date('2026-08-16')` se interpreta como medianoche UTC y al
 * formatearlo en el huso local puede retroceder al día anterior — el mismo
 * error de huso que este módulo existe para evitar.
 */
export function formatTodayLabel(date: string, weekday: number): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(date)
  const dayName = DAY_NAMES[weekday]
  // sin fecha reconocible o sin día válido, el nombre del día ya informa; una
  // cabecera a medias es mejor que una fecha inventada
  if (match == null || dayName == null) return dayName ?? ''

  const monthName = MONTH_NAMES[Number(match[1]) - 1]
  if (monthName == null) return dayName

  return `${dayName}, ${Number(match[2])} de ${monthName}`
}

// Los ítems que tocan un día concreto, en orden de reloj. Un ítem multi-día
// aparece en cada uno de sus días (spec §5).
export function itemsForDay(items: RoutineItem[], weekday: number): RoutineItem[] {
  return items
    .filter((item) => item.days.includes(weekday))
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, 'es'))
}
