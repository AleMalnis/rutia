import { describe, expect, it } from 'vitest'
import {
  blockGeometry,
  DAY_START_MIN,
  GRID_HEIGHT_PX,
  HOUR_PX,
  reminderCenters,
  timeToMinutes,
} from '@/lib/calendar'

describe('timeToMinutes', () => {
  it('convierte HH:MM a minutos', () => {
    expect(timeToMinutes('06:00')).toBe(360)
    expect(timeToMinutes('09:30')).toBe(570)
    expect(timeToMinutes('24:00')).toBe(1440)
  })
})

describe('blockGeometry', () => {
  it('un bloque de una hora mide exactamente HOUR_PX', () => {
    expect(blockGeometry('09:00', '10:00')).toEqual({ top: 3 * HOUR_PX, height: HOUR_PX })
  })

  it('la altura es proporcional a la duración', () => {
    expect(blockGeometry('09:00', '17:00')?.height).toBe(8 * HOUR_PX)
    expect(blockGeometry('19:00', '20:30')?.height).toBe(1.5 * HOUR_PX)
  })

  it('la rejilla empieza a las 06:00: ese es el top cero', () => {
    expect(blockGeometry('06:00', '07:00')?.top).toBe(0)
  })

  it("un bloque hasta '24:00' termina justo en el borde inferior", () => {
    const g = blockGeometry('23:00', '24:00')
    expect(g).not.toBeNull()
    expect(g!.top + g!.height).toBe(GRID_HEIGHT_PX)
  })

  it('un bloque que asoma antes de las 06:00 se recorta al borde', () => {
    const g = blockGeometry('05:00', '07:00')
    expect(g).toEqual({ top: 0, height: HOUR_PX })
  })

  it('un bloque completamente fuera de la rejilla no se pinta', () => {
    expect(blockGeometry('01:00', '05:00')).toBeNull()
    expect(blockGeometry('01:00', '06:00')).toBeNull()
  })

  it('un bloque muy corto conserva la altura mínima legible', () => {
    const g = blockGeometry('09:00', '09:05')
    expect(g!.height).toBeGreaterThanOrEqual(20)
  })

  it('un bloque corto pegado a medianoche no desborda la rejilla', () => {
    const g = blockGeometry('23:50', '24:00')
    expect(g!.top + g!.height).toBeLessThanOrEqual(GRID_HEIGHT_PX)
  })
})

describe('reminderCenters', () => {
  it('ancla cada chip al centro de su hora', () => {
    expect(reminderCenters(['09:00', '21:00'])).toEqual([3 * HOUR_PX, 15 * HOUR_PX])
  })

  it('un recordatorio antes de las 06:00 se fija al borde, no se oculta', () => {
    expect(reminderCenters(['05:00'])).toEqual([10])
  })

  it('dos chips a la misma hora se apilan en vez de taparse', () => {
    const [first, second] = reminderCenters(['09:00', '09:00'])
    expect(first).toBe(3 * HOUR_PX)
    expect(second - first).toBeGreaterThanOrEqual(20)
  })

  it('chips a horas cercanas (menos de un chip de separación) también se apilan', () => {
    const [first, second] = reminderCenters(['09:00', '09:15'])
    expect(second - first).toBeGreaterThanOrEqual(20)
  })

  it('chips a horas distantes no se tocan entre sí', () => {
    expect(reminderCenters(['09:00', '10:00'])).toEqual([3 * HOUR_PX, 4 * HOUR_PX])
  })

  it('un chip pegado a medianoche no desborda la rejilla', () => {
    const [center] = reminderCenters(['23:55'])
    expect(center + 10).toBeLessThanOrEqual(GRID_HEIGHT_PX)
  })

  it('la constante DAY_START_MIN es 06:00', () => {
    expect(DAY_START_MIN).toBe(360)
  })
})
