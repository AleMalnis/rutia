import type { Category, RoutineItem } from '@/lib/schemas'
import {
  blockGeometry,
  GRID_HEIGHT_PX,
  HOUR_PX,
  reminderCenters,
} from '@/lib/calendar'

// Calendario semanal (spec §4): columnas L-D, filas de 06:00 a 24:00. Los
// bloques son tarjetas con altura proporcional a su duración; los
// recordatorios, chips anclados a su hora. Un ítem multi-día se pinta en cada
// día de su array. Server component puro: sin estado ni interacción todavía.

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6)
const FALLBACK_COLOR = '#71717a'
const GRID_COLS = 'grid grid-cols-[3.25rem_repeat(7,minmax(6rem,1fr))]'

type Props = {
  items: RoutineItem[]
  categories: Category[]
}

export function WeekCalendar({ items, categories }: Props) {
  const colorByCategory = new Map(categories.map((c) => [c.id, c.color]))
  const colorOf = (item: RoutineItem) =>
    (item.categoryId && colorByCategory.get(item.categoryId)) || FALLBACK_COLOR

  return (
    // En móvil el calendario se desplaza en horizontal (spec §4, responsive).
    <div className="overflow-x-auto">
      <div className="min-w-max">
        <div className={GRID_COLS}>
          <div />
          {DAY_NAMES.map((name) => (
            <div
              key={name}
              className="border-b border-l border-zinc-200 px-2 py-2 text-center text-sm font-medium text-zinc-700 dark:border-zinc-800 dark:text-zinc-300"
            >
              {name}
            </div>
          ))}
        </div>

        <div className={GRID_COLS}>
          {/* columna de horas: fija durante el scroll horizontal en móvil */}
          <div
            className="sticky left-0 z-20 bg-white dark:bg-zinc-950"
            style={{ height: GRID_HEIGHT_PX }}
          >
            {HOURS.map((hour, index) => (
              <span
                key={hour}
                className="absolute right-1.5 -translate-y-1/2 text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500"
                style={{ top: index * HOUR_PX }}
              >
                {String(hour).padStart(2, '0')}:00
              </span>
            ))}
          </div>

          {DAY_NAMES.map((name, day) => {
            const reminders = items
              .filter((item) => item.kind === 'reminder' && item.days.includes(day))
              .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
            const centers = reminderCenters(reminders.map((item) => item.start))

            return (
              <div
                key={name}
                className="relative border-l border-zinc-200 dark:border-zinc-800"
                style={{ height: GRID_HEIGHT_PX }}
              >
                {/* líneas de hora */}
                {HOURS.map((hour, index) =>
                  index === 0 ? null : (
                    <div
                      key={hour}
                      aria-hidden
                      className="absolute inset-x-0 border-t border-zinc-100 dark:border-zinc-800/60"
                      style={{ top: index * HOUR_PX }}
                    />
                  ),
                )}

                {items
                  .filter((item) => item.kind === 'block' && item.days.includes(day))
                  .map((item) => (
                    <BlockCard key={item.id} item={item} color={colorOf(item)} />
                  ))}

                {reminders.map((item, index) => (
                  <ReminderChip
                    key={item.id}
                    item={item}
                    color={colorOf(item)}
                    center={centers[index]}
                  />
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function BlockCard({ item, color }: { item: RoutineItem; color: string }) {
  if (item.end == null) return null
  const geometry = blockGeometry(item.start, item.end)
  if (geometry == null) return null

  return (
    <div
      className="absolute inset-x-1 overflow-hidden rounded-md border-l-4 px-1.5 py-0.5"
      style={{
        top: geometry.top,
        height: geometry.height,
        borderLeftColor: color,
        // color de la categoría con ~15 % de opacidad como fondo
        backgroundColor: `${color}26`,
      }}
      title={`${item.title} · ${item.start}–${item.end}${item.detail ? ` · ${item.detail}` : ''}`}
    >
      <p className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
        {item.title}
      </p>
      {/* el detalle como subtítulo (spec §4): «Cena · Pasta» */}
      {item.detail && (
        <p className="truncate text-[11px] text-zinc-600 dark:text-zinc-400">{item.detail}</p>
      )}
      <p className="truncate text-[11px] tabular-nums text-zinc-500 dark:text-zinc-500">
        {item.start}–{item.end}
      </p>
    </div>
  )
}

function ReminderChip({
  item,
  color,
  center,
}: {
  item: RoutineItem
  color: string
  center: number
}) {
  // Anclado a la derecha sin ocupar todo el ancho: si coincide en hora con el
  // inicio de un bloque, el título del bloque sigue leyéndose a la izquierda.
  return (
    <div
      className="absolute right-1 z-10 flex h-5 max-w-[calc(100%-0.5rem)] -translate-y-1/2 items-center gap-1 rounded-full border bg-white px-1.5 shadow-sm dark:bg-zinc-900"
      style={{ top: center, borderColor: color }}
      title={`${item.title} · ${item.start}${item.detail ? ` · ${item.detail}` : ''}`}
    >
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {/* el detalle como subtítulo también en el chip (spec §4):
          «Medicación · Enalapril 10 mg» */}
      <span className="truncate text-[11px] text-zinc-800 dark:text-zinc-200">
        {item.title}
        {item.detail ? ` · ${item.detail}` : ''}
      </span>
    </div>
  )
}
