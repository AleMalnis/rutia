// Geometría del calendario semanal (spec §4): rejilla L-D de 06:00 a 24:00,
// con la altura de cada bloque proporcional a su duración. Funciones puras,
// cubiertas por tests unitarios.

// 0=lunes … 6=domingo (spec §5).
export const DAY_NAMES = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
]
export const DAY_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

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

// Los chips miden h-5 (20 px) y CUELGAN justo encima de su línea de hora: el
// título de un bloque que empiece a esa misma hora vive justo debajo de la
// línea, así que chip y título dejan de pisarse.
const CHIP_HEIGHT_PX = 20
const CHIP_GAP_PX = 2

// Borde INFERIOR de cada chip de un día (el componente usa -translate-y-full),
// a partir de sus horas ORDENADAS ascendentemente. Un recordatorio fuera de la
// rejilla se fija al borde (ocultar una toma de medicación sería peor); los
// chips que colisionan se apilan hacia ARRIBA, alejándose de su línea. Se
// procesa en orden inverso para que el último de una misma hora quede pegado
// a la línea y los anteriores suban.
export function reminderBottoms(starts: string[]): number[] {
  const bottoms: number[] = new Array<number>(starts.length)
  let limit = Number.POSITIVE_INFINITY

  for (let i = starts.length - 1; i >= 0; i--) {
    const minutes = Math.min(Math.max(timeToMinutes(starts[i]), DAY_START_MIN), DAY_END_MIN)
    let bottom = ((minutes - DAY_START_MIN) / 60) * HOUR_PX
    bottom = Math.min(bottom, GRID_HEIGHT_PX, limit)
    // el chip entero debe caber: pegado al borde superior (06:00) se admite
    // solape antes que desbordar la rejilla
    bottom = Math.max(bottom, CHIP_HEIGHT_PX)
    bottoms[i] = bottom
    limit = bottom - CHIP_HEIGHT_PX - CHIP_GAP_PX
  }
  return bottoms
}
