'use client'

import { useRef, useState } from 'react'
import { CategoryLegend } from '@/components/category-legend'
import { CategoryManagerDialog } from '@/components/category-manager-dialog'
import { ItemFormDialog } from '@/components/item-form-dialog'
import { TodayPanel, type TodayEntry } from '@/components/today-panel'
import { WeekCalendar } from '@/components/week-calendar'
import type { Category, RoutineItem } from '@/lib/schemas'

// Dueño del estado de los diálogos: el calendario y la leyenda son
// presentación pura y las escrituras van por server actions.
type Dialog =
  | { type: 'item'; item: RoutineItem | null }
  | { type: 'categories' }
  | null

export function RoutineBoard({
  items,
  categories,
  todayEntries,
  todayWeekday,
  todayDate,
  children,
}: {
  items: RoutineItem[]
  categories: Category[]
  todayEntries: TodayEntry[]
  todayWeekday: number
  todayDate: string
  // la cabecera de la página se recibe como slot para que quede DENTRO del
  // contenedor inert: si no, con el diálogo abierto se puede tabular hasta
  // «Cerrar sesión» y cerrar sesión perdiendo lo que se estaba editando
  children?: React.ReactNode
}) {
  const [dialog, setDialog] = useState<Dialog>(null)

  // El disparador se captura AQUÍ, en el clic: cuando el diálogo monta, el
  // fondo ya es inert y el navegador ha movido el foco a body, así que un
  // efecto dentro del diálogo solo podría guardar body y la restauración no
  // devolvería al usuario a su sitio.
  const trigger = useRef<HTMLElement | null>(null)

  function open(next: NonNullable<Dialog>) {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setDialog(next)
  }

  function close() {
    setDialog(null)
    trigger.current?.focus()
  }

  const openItem = (item: RoutineItem | null) => open({ type: 'item', item })

  return (
    <>
      {/* inert mientras hay un diálogo abierto: sin esto se puede tabular
          hasta las tarjetas del calendario que quedan detrás del velo y
          abrir otro ítem, perdiendo lo que se estaba editando */}
      <div className="flex flex-1 flex-col gap-4" inert={dialog != null}>
        {children}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* «Categorías» abre el gestor y va junto a la leyenda que gobierna */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={() => open({ type: 'categories' })}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
            >
              Categorías
            </button>
            <CategoryLegend categories={categories} />
          </div>
          <button
            type="button"
            onClick={() => openItem(null)}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Nuevo ítem
          </button>
        </div>

        {/* «Hoy» va primero en el DOM porque en móvil es la vista principal
            (spec §4): así el orden de lectura y de tabulación coincide con lo
            que se ve. Solo en escritorio pasa a la columna derecha. */}
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_18rem] lg:items-start">
          <div className="lg:order-2">
            <TodayPanel
              entries={todayEntries}
              weekday={todayWeekday}
              date={todayDate}
              categories={categories}
              onItemClick={openItem}
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white lg:order-1 dark:border-zinc-800 dark:bg-zinc-950">
            <WeekCalendar items={items} categories={categories} onItemClick={openItem} />
          </div>
        </div>

        {items.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Tu rutina está vacía. Pulsa «Nuevo ítem» para empezar.
          </p>
        )}
      </div>

      {dialog?.type === 'item' && (
        <ItemFormDialog
          // remonta el formulario al cambiar de ítem: los defaultValue de los
          // campos no controlados no se refrescan solos
          key={dialog.item?.id ?? 'nuevo'}
          item={dialog.item}
          categories={categories}
          onClose={close}
        />
      )}

      {dialog?.type === 'categories' && (
        <CategoryManagerDialog categories={categories} onClose={close} />
      )}
    </>
  )
}
