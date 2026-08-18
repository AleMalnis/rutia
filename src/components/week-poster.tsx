import {
  blockGeometry,
  DAY_NAMES,
  GRID_HEIGHT_PX,
  HOUR_PX,
  reminderBottoms,
} from '@/lib/calendar'
import { FALLBACK_CATEGORY_COLOR } from '@/lib/category-colors'
import { formatTodayLabel } from '@/lib/today'
import type { Category, RoutineItem } from '@/lib/schemas'

// La lámina de exportación (spec §4, Must #13): la semana completa a 1920×1080
// para imprimir o de fondo de pantalla. Presentacional pura y con PALETA CLARA
// FIJA, independiente del tema elegido: la lámina debe salir igual para todos,
// así que aquí no hay variables de tema — hexes de zinc claro y el color de
// categoría tal como se persiste (la variante clara del muestrario).
//
// Reutiliza la geometría real del calendario (blockGeometry, reminderBottoms):
// lo exportado es lo que el usuario ve, no una segunda implementación que
// envejecería aparte.

const POSTER = {
  width: 1920,
  height: 1080,
  padding: 48,
  ink: '#18181b',
  ink2: '#3f3f46',
  ink3: '#71717a',
  edge: '#e4e4e7',
  page: '#ffffff',
} as const

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6)

type Props = {
  items: RoutineItem[]
  categories: Category[]
  /** Fecha ISO del día de la exportación: sale en el subtítulo. */
  date: string
  /** Día actual (0=lunes), para el rótulo de la fecha. */
  weekday: number
}

export function WeekPoster({ items, categories, date, weekday }: Props) {
  const colorById = new Map(categories.map((c) => [c.id, c.color]))
  const colorOf = (item: RoutineItem) =>
    (item.categoryId && colorById.get(item.categoryId)) || FALLBACK_CATEGORY_COLOR
  // solo las categorías en uso: la leyenda de la lámina describe lo que se ve,
  // no el catálogo entero
  const usedCategoryIds = new Set(items.map((item) => item.categoryId).filter(Boolean))
  const legend = categories.filter((category) => usedCategoryIds.has(category.id))

  return (
    <div
      style={{
        width: POSTER.width,
        height: POSTER.height,
        padding: POSTER.padding,
        backgroundColor: POSTER.page,
        color: POSTER.ink,
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        fontFamily: 'var(--font-app)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em' }}>Mi semana</div>
          <div style={{ marginTop: 4, fontSize: 15, color: POSTER.ink3 }}>
            RutIA · {formatTodayLabel(date, weekday)}
          </div>
        </div>
        {legend.length > 0 && (
          <div style={{ display: 'flex', gap: 20, fontSize: 14, color: POSTER.ink2 }}>
            {legend.map((category) => (
              <span key={category.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 9999,
                    backgroundColor: category.color,
                  }}
                />
                {category.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* cabecera de días + rejilla, con la misma escala del calendario real */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: `56px repeat(7, 1fr)` }}>
          <div />
          {DAY_NAMES.map((name) => (
            <div
              key={name}
              style={{
                padding: '8px 0 10px',
                textAlign: 'center',
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: POSTER.ink3,
                borderBottom: `1px solid ${POSTER.edge}`,
                borderLeft: `1px solid ${POSTER.edge}`,
              }}
            >
              {name}
            </div>
          ))}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `56px repeat(7, 1fr)`,
            height: GRID_HEIGHT_PX,
          }}
        >
          <div style={{ position: 'relative' }}>
            {HOURS.map((hour, index) =>
              index === 0 ? null : (
                <span
                  key={hour}
                  style={{
                    position: 'absolute',
                    top: index * HOUR_PX,
                    right: 8,
                    transform: 'translateY(-50%)',
                    fontSize: 11,
                    fontVariantNumeric: 'tabular-nums',
                    color: POSTER.ink3,
                  }}
                >
                  {String(hour).padStart(2, '0')}:00
                </span>
              ),
            )}
          </div>

          {DAY_NAMES.map((name, day) => {
            const reminders = items
              .filter((item) => item.kind === 'reminder' && item.days.includes(day))
              .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
            const bottoms = reminderBottoms(reminders.map((item) => item.start))

            return (
              <div
                key={name}
                style={{ position: 'relative', borderLeft: `1px solid ${POSTER.edge}` }}
              >
                {HOURS.map((hour, index) =>
                  index === 0 ? null : (
                    <div
                      key={hour}
                      style={{
                        position: 'absolute',
                        insetInline: 0,
                        top: index * HOUR_PX,
                        borderTop: `1px solid ${POSTER.edge}80`,
                      }}
                    />
                  ),
                )}

                {items
                  .filter((item) => item.kind === 'block' && item.days.includes(day))
                  .map((item) => {
                    if (item.end == null) return null
                    const geometry = blockGeometry(item.start, item.end)
                    if (geometry == null) return null
                    const color = colorOf(item)
                    return (
                      <div
                        key={item.id}
                        style={{
                          position: 'absolute',
                          insetInline: 4,
                          top: geometry.top,
                          height: geometry.height,
                          overflow: 'hidden',
                          borderRadius: 6,
                          borderLeft: `4px solid ${color}`,
                          backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
                          padding: '2px 6px',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {item.title}
                        </div>
                        {item.detail && (
                          <div
                            style={{
                              fontSize: 11,
                              color: POSTER.ink2,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {item.detail}
                          </div>
                        )}
                      </div>
                    )
                  })}

                {reminders.map((item, index) => (
                  <div
                    key={item.id}
                    style={{
                      position: 'absolute',
                      right: 4,
                      top: bottoms[index],
                      transform: 'translateY(-100%)',
                      maxWidth: '75%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      height: 20,
                      padding: '0 7px',
                      borderRadius: 9999,
                      border: `1px solid ${colorOf(item)}`,
                      backgroundColor: POSTER.page,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        flexShrink: 0,
                        borderRadius: 9999,
                        backgroundColor: colorOf(item),
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {item.title}
                      {item.detail ? ` · ${item.detail}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
