// Geometría del calendario semanal (spec §4): rejilla L-D de 06:00 a 24:00,
// con la altura de cada bloque proporcional a su duración. Funciones puras,
// cubiertas por tests unitarios.

export const DAY_START_MIN = 6 * 60
export const DAY_END_MIN = 24 * 60
export const HOUR_PX = 48
export const GRID_HEIGHT_PX = ((DAY_END_MIN - DAY_START_MIN) / 60) * HOUR_PX

// Altura mínima para que un bloque corto siga siendo legible y clicable.
const MIN_BLOCK_PX = 20

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export type BlockGeometry = { top: number; height: number }

// Posición y altura de un bloque dentro de la rejilla. Un bloque que asoma
// parcialmente (p. ej. empieza a las 05:30) se recorta al borde visible; si
// queda fuera por completo devuelve null y no se pinta.
export function blockGeometry(start: string, end: string): BlockGeometry | null {
  const startMin = timeToMinutes(start)
  const endMin = timeToMinutes(end)
  if (endMin <= DAY_START_MIN || startMin >= DAY_END_MIN) return null

  const visibleStart = Math.max(startMin, DAY_START_MIN)
  const visibleEnd = Math.min(endMin, DAY_END_MIN)
  const height = Math.max(((visibleEnd - visibleStart) / 60) * HOUR_PX, MIN_BLOCK_PX)
  // El mínimo puede empujar un bloque corto más allá del borde inferior
  // (23:50-24:00): se reancla para que nunca desborde la rejilla. Que un
  // bloque corto inflado pise unos px al siguiente es aceptable: los fondos
  // son translúcidos y ambos siguen legibles.
  const top = Math.min(
    ((visibleStart - DAY_START_MIN) / 60) * HOUR_PX,
    GRID_HEIGHT_PX - height,
  )
  return { top, height }
}

// Los chips miden h-5 (20 px) y se centran en su hora con translate-y-1/2.
const CHIP_HEIGHT_PX = 20
const CHIP_GAP_PX = 2

// Centros verticales de los chips de un día, a partir de sus horas ORDENADAS
// ascendentemente. Reglas: un recordatorio fuera de la rejilla se fija al
// borde (ocultar una toma de medicación sería peor); los chips que caerían
// encima de otro se apilan hacia abajo para que ninguno quede tapado.
export function reminderCenters(starts: string[]): number[] {
  const half = CHIP_HEIGHT_PX / 2
  const centers: number[] = []
  let previous = Number.NEGATIVE_INFINITY

  for (const start of starts) {
    const minutes = Math.min(Math.max(timeToMinutes(start), DAY_START_MIN), DAY_END_MIN)
    let center = ((minutes - DAY_START_MIN) / 60) * HOUR_PX
    center = Math.min(Math.max(center, half), GRID_HEIGHT_PX - half)
    if (center - previous < CHIP_HEIGHT_PX + CHIP_GAP_PX) {
      center = previous + CHIP_HEIGHT_PX + CHIP_GAP_PX
    }
    // techo absoluto: en el caso extremo de varios chips apilados contra la
    // medianoche se admite solape antes que desbordar la rejilla
    center = Math.min(center, GRID_HEIGHT_PX - half)
    centers.push(center)
    previous = center
  }
  return centers
}
