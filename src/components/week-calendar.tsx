'use client'

import type { Category, RoutineItem } from '@/lib/schemas'
import {
  blockGeometry,
  DAY_NAMES,
  GRID_HEIGHT_PX,
  HOUR_PX,
  reminderBottoms,
} from '@/lib/calendar'
import { categoryColorStyle } from '@/lib/category-colors'

// Calendario semanal (spec §4): columnas L-D, filas de 06:00 a 24:00. Los
// bloques son tarjetas con altura proporcional a su duración; los
// recordatorios, chips anclados a su hora. Un ítem multi-día se pinta en cada
// día de su array. Presentación pura: el estado del diálogo vive en el padre.

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6)
const GRID_COLS = 'grid grid-cols-[3.25rem_repeat(7,minmax(6rem,1fr))]'

type Props = {
  items: RoutineItem[]
  categories: Category[]
  /** Ítems recién tocados por el agente: se resaltan unos segundos (Must #6). */
  highlightIds?: ReadonlySet<string>
  onItemClick: (item: RoutineItem) => void
}

export function WeekCalendar({ items, categories, highlightIds, onItemClick }: Props) {
  const colorByCategory = new Map(categories.map((c) => [c.id, c.color]))
  const colorOf = (item: RoutineItem) =>
    (item.categoryId && colorByCategory.get(item.categoryId)) || null

  return (
    // En móvil el calendario se desplaza en horizontal (spec §4, responsive).
    <div className="overflow-x-auto">
      <div className="min-w-max">
        <div className={GRID_COLS}>
          <div />
          {DAY_NAMES.map((name) => (
            <div
              key={name}
              className="border-b border-l border-edge px-2 py-2 text-center text-sm font-medium text-ink-2"
            >
              {name}
            </div>
          ))}
        </div>

        <div className={GRID_COLS}>
          {/* columna de horas: fija durante el scroll horizontal en móvil */}
          <div
            className="sticky left-0 z-20 bg-card"
            style={{ height: GRID_HEIGHT_PX }}
          >
            {HOURS.map((hour, index) => (
              <span
                key={hour}
                className="absolute right-1.5 -translate-y-1/2 text-[11px] tabular-nums text-ink-3"
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
            const bottoms = reminderBottoms(reminders.map((item) => item.start))

            return (
              <div
                key={name}
                className="relative border-l border-edge"
                style={{ height: GRID_HEIGHT_PX }}
              >
                {/* líneas de hora */}
                {HOURS.map((hour, index) =>
                  index === 0 ? null : (
                    <div
                      key={hour}
                      aria-hidden
                      className="absolute inset-x-0 border-t border-edge/50"
                      style={{ top: index * HOUR_PX }}
                    />
                  ),
                )}

                {items
                  .filter((item) => item.kind === 'block' && item.days.includes(day))
                  .map((item) => (
                    <BlockCard
                      key={item.id}
                      item={item}
                      color={colorOf(item)}
                      highlighted={highlightIds?.has(item.id) ?? false}
                      onClick={() => onItemClick(item)}
                    />
                  ))}

                {reminders.map((item, index) => (
                  <ReminderChip
                    key={item.id}
                    item={item}
                    color={colorOf(item)}
                    bottom={bottoms[index]}
                    highlighted={highlightIds?.has(item.id) ?? false}
                    onClick={() => onItemClick(item)}
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

function BlockCard({
  item,
  color,
  highlighted,
  onClick,
}: {
  item: RoutineItem
  color: string | null
  highlighted: boolean
  onClick: () => void
}) {
  if (item.end == null) return null
  const geometry = blockGeometry(item.start, item.end)
  if (geometry == null) return null

  return (
    <button
      type="button"
      onClick={onClick}
      className={`cat-mark absolute inset-x-1 cursor-pointer overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left transition-[opacity,box-shadow] hover:opacity-80 ${
        highlighted ? 'ring-2 ring-accent' : ''
      }`}
      style={{
        ...categoryColorStyle(color),
        top: geometry.top,
        height: geometry.height,
        borderLeftColor: 'var(--cat)',
        // color de la categoría con ~15 % de opacidad como fondo
        backgroundColor: 'color-mix(in srgb, var(--cat) 15%, transparent)',
      }}
      title={`${item.title} · ${item.start}–${item.end}${item.detail ? ` · ${item.detail}` : ''}`}
    >
      <p className="truncate text-xs font-medium text-ink">
        {item.title}
      </p>
      {/* el detalle como subtítulo (spec §4): «Cena · Pasta» */}
      {item.detail && (
        <p className="truncate text-[11px] text-ink-2">{item.detail}</p>
      )}
      <p className="truncate text-[11px] tabular-nums text-ink-3">
        {item.start}–{item.end}
      </p>
    </button>
  )
}

function ReminderChip({
  item,
  color,
  bottom,
  highlighted,
  onClick,
}: {
  item: RoutineItem
  color: string | null
  bottom: number
  highlighted: boolean
  onClick: () => void
}) {
  // Cuelga ENCIMA de su línea de hora (translate-y-full) y anclado a la
  // derecha con ancho capado: así nunca pisa el título de un bloque que
  // empiece a esa misma hora, ni siquiera con un detalle largo.
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cat-mark absolute right-1 z-10 flex h-5 max-w-[75%] -translate-y-full cursor-pointer items-center gap-1 rounded-full border bg-card px-1.5 shadow-sm transition-[opacity,box-shadow] hover:opacity-80 ${
        highlighted ? 'ring-2 ring-accent' : ''
      }`}
      style={{ ...categoryColorStyle(color), top: bottom, borderColor: 'var(--cat)' }}
      title={`${item.title} · ${item.start}${item.detail ? ` · ${item.detail}` : ''}`}
    >
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: 'var(--cat)' }}
      />
      {/* el detalle como subtítulo también en el chip (spec §4):
          «Medicación · Enalapril 10 mg» */}
      <span className="truncate text-[11px] text-ink">
        {item.title}
        {item.detail ? ` · ${item.detail}` : ''}
      </span>
    </button>
  )
}
