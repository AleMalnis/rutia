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

// Los ítems que tocan un día concreto, en orden de reloj. Un ítem multi-día
// aparece en cada uno de sus días (spec §5).
export function itemsForDay(items: RoutineItem[], weekday: number): RoutineItem[] {
  return items
    .filter((item) => item.days.includes(weekday))
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, 'es'))
}
