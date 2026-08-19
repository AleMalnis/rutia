import {
  blockGeometry,
  DAY_NAMES,
  GRID_HEIGHT_PX,
  HOUR_PX,
  reminderBottoms,
} from '@/lib/calendar'
import { categoryColorStyle } from '@/lib/category-colors'
import { formatTodayLabel } from '@/lib/today'
import type { Category, RoutineItem } from '@/lib/schemas'

// La lámina de exportación (spec §4, Must #13): la semana completa a 1920×1080
// para imprimir o de fondo de pantalla. Presentacional pura y con LOS COLORES
// DEL USUARIO (decisión suya, sustituye a la paleta fija inicial): el tema de
// superficie elegido en Apariencia, en el modo claro u oscuro que se escoja
// al exportar.
//
// Reutiliza la geometría real del calendario (blockGeometry, reminderBottoms):
// lo exportado es lo que el usuario ve, no una segunda implementación que
// envejecería aparte.

const POSTER = { width: 1920, height: 1080, padding: 48 } as const

// Colores vía las variables del sistema de temas (spec §4): la raíz fuerza
// data-theme/data-mode y las superficies resuelven como en la app; el par
// claro/oscuro de cada categoría se resuelve localmente con la prop mode (ver
// catVars). html-to-image copia estilos COMPUTADOS al clonar, así que las
// variables llegan ya resueltas al PNG.
const INK = 'var(--ink)'
const INK2 = 'var(--ink-2)'
const INK3 = 'var(--ink-3)'
const EDGE = 'var(--edge)'
const CARD = 'var(--card)'
const PAGE = 'var(--page)'

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6)

type Props = {
  items: RoutineItem[]
  categories: Category[]
  /** Fecha ISO del día de la exportación: sale en el subtítulo. */
  date: string
  /** Día actual (0=lunes), para el rótulo de la fecha. */
  weekday: number
  /** Tema de superficie del usuario (spec §4): tu póster, tus colores. */
  theme: string
  /** Elegido al exportar: clara u oscura, pensando en el fondo de pantalla. */
  mode: 'light' | 'dark'
}

export function WeekPoster({ items, categories, date, weekday, theme, mode }: Props) {
  const colorById = new Map(categories.map((c) => [c.id, c.color]))
  const colorOf = (item: RoutineItem) =>
    (item.categoryId && colorById.get(item.categoryId)) || null
  // El par claro/oscuro se resuelve AQUI con la prop mode, no con la clase
  // cat-mark: esa clase mira ancestros [data-mode], y la lamina vive anidada
  // dentro del main de la app — exportar lamina clara con la app en oscuro
  // heredaria el modo equivocado. Var inline que referencia vars inline del
  // mismo elemento: resuelve por elemento, inmune al arbol de fuera.
  const catVars = (light: string | null) => ({
    ...categoryColorStyle(light),
    '--cat': mode === 'dark' ? 'var(--cat-dark)' : 'var(--cat-light)',
  })
  // solo las categorías en uso: la leyenda de la lámina describe lo que se ve,
  // no el catálogo entero
  const usedCategoryIds = new Set(items.map((item) => item.categoryId).filter(Boolean))
  const legend = categories.filter((category) => usedCategoryIds.has(category.id))

  return (
    <div
      data-theme={theme}
      data-mode={mode}
      style={{
        width: POSTER.width,
        height: POSTER.height,
        padding: POSTER.padding,
        backgroundColor: PAGE,
        color: INK,
        display: 'flex',
        flexDirection: 'column',
        // Presupuesto vertical CERRADO (los line-height van fijados porque la
        // fuente la elige el usuario y cada una mide distinto): cabecera 72 +
        // hueco 16 + rótulos de día 29 + rejilla 864 = 981 ≤ 1080 − 96 de
        // padding. Con gap 24 y alturas libres se comían el margen inferior.
        gap: 16,
        fontFamily: 'var(--font-app)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 42, lineHeight: 1.1, fontWeight: 600, letterSpacing: '-0.02em' }}>
            Mi semana
          </div>
          <div style={{ marginTop: 4, fontSize: 18, lineHeight: 1.2, color: INK3 }}>
            RutIA · {formatTodayLabel(date, weekday)}
          </div>
        </div>
        {legend.length > 0 && (
          <div style={{ display: 'flex', gap: 20, fontSize: 16, color: INK2 }}>
            {legend.map((category) => (
              <span key={category.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    ...catVars(category.color),
                    width: 12,
                    height: 12,
                    borderRadius: 9999,
                    backgroundColor: 'var(--cat)',
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
                padding: '6px 0 8px',
                textAlign: 'center',
                fontSize: 15,
                lineHeight: 1,
                fontWeight: 500,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: INK3,
                borderBottom: `1px solid ${EDGE}`,
                borderLeft: `1px solid ${EDGE}`,
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
                    fontSize: 15,
                    fontVariantNumeric: 'tabular-nums',
                    color: INK3,
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
                style={{ position: 'relative', borderLeft: `1px solid ${EDGE}` }}
              >
                {HOURS.map((hour, index) =>
                  index === 0 ? null : (
                    <div
                      key={hour}
                      style={{
                        position: 'absolute',
                        insetInline: 0,
                        top: index * HOUR_PX,
                        borderTop: `1px solid color-mix(in srgb, var(--edge) 50%, transparent)`,
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
                    // La lámina es estática: cada título puede dimensionarse
                    // según el espacio real de su bloque, cosa que en pantalla
                    // no se hace. Un bloque de ≥1 h tiene sitio de sobra para
                    // letra de póster; uno de 30 min (24 px) no, y ahí manda
                    // no cortarse.
                    const tall = geometry.height >= HOUR_PX
                    return (
                      <div
                        key={item.id}
                        style={{
                          ...catVars(colorOf(item)),
                          position: 'absolute',
                          insetInline: 4,
                          top: geometry.top,
                          height: geometry.height,
                          overflow: 'hidden',
                          borderRadius: 6,
                          borderLeft: '4px solid var(--cat)',
                          backgroundColor: 'color-mix(in srgb, var(--cat) 15%, transparent)',
                          padding: tall ? '6px 10px' : '2px 6px',
                        }}
                      >
                        <div
                          style={{
                            fontSize: tall ? 19 : 14,
                            fontWeight: 600,
                            lineHeight: 1.25,
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
                              fontSize: tall ? 15 : 13,
                              color: INK2,
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
                      ...catVars(colorOf(item)),
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
                      border: '1px solid var(--cat)',
                      backgroundColor: CARD,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        flexShrink: 0,
                        borderRadius: 9999,
                        backgroundColor: 'var(--cat)',
                      }}
                    />
                    <span
                      style={{
                        fontSize: 14,
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
