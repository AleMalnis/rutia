'use client'

import { useState } from 'react'
import { CategoryLegend } from '@/components/category-legend'
import { ItemFormDialog } from '@/components/item-form-dialog'
import { WeekCalendar } from '@/components/week-calendar'
import type { Category, RoutineItem } from '@/lib/schemas'

// Dueño del estado del diálogo: el calendario y la leyenda son presentación
// pura y las escrituras van por server actions.
type Editing = { item: RoutineItem | null } | null

export function RoutineBoard({
  items,
  categories,
}: {
  items: RoutineItem[]
  categories: Category[]
}) {
  const [editing, setEditing] = useState<Editing>(null)

  return (
    <>
      {/* inert mientras el diálogo está abierto: sin esto se puede tabular
          hasta las tarjetas del calendario que quedan detrás del velo y
          abrir otro ítem, perdiendo lo que se estaba editando */}
      <div className="flex flex-1 flex-col gap-4" inert={editing != null}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CategoryLegend categories={categories} />
          <button
            type="button"
            onClick={() => setEditing({ item: null })}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Nuevo ítem
          </button>
        </div>

        <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <WeekCalendar
            items={items}
            categories={categories}
            onItemClick={(item) => setEditing({ item })}
          />
        </section>

        {items.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Tu rutina está vacía. Pulsa «Nuevo ítem» para empezar.
          </p>
        )}
      </div>

      {editing && (
        <ItemFormDialog
          // remonta el formulario al cambiar de ítem: los defaultValue de los
          // campos no controlados no se refrescan solos
          key={editing.item?.id ?? 'nuevo'}
          item={editing.item}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
