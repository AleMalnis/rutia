'use client'

import { useEffect, useOptimistic, useState, useTransition } from 'react'
import { reportTimezone, toggleCompleted } from '@/app/app/actions'
import { DAY_NAMES } from '@/lib/calendar'
import { categoryColorStyle } from '@/lib/category-colors'
import type { Category, RoutineItem } from '@/lib/schemas'

// Panel «Hoy» (spec §4 y Must #9): lo que toca hoy en orden, con casilla de
// completado. Imprescindible para la medicación, así que el estado se pinta
// de forma optimista y el error se muestra si el servidor lo rechaza.

export type TodayEntry = { item: RoutineItem; done: boolean }

export function TodayPanel({
  entries,
  weekday,
  date,
  categories,
  onItemClick,
}: {
  entries: TodayEntry[]
  weekday: number
  date: string
  categories: Category[]
  onItemClick: (item: RoutineItem) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const [optimistic, setOptimistic] = useOptimistic(
    entries,
    (current: TodayEntry[], update: { id: string; done: boolean }) =>
      current.map((entry) =>
        entry.item.id === update.id ? { ...entry, done: update.done } : entry,
      ),
  )

  // El perfil nace con una zona por defecto; sin esto, «hoy» se calcularía en
  // el huso equivocado para todo el que no viva en él.
  useEffect(() => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (browserZone) void reportTimezone(browserZone)
  }, [])

  const colorByCategory = new Map(categories.map((c) => [c.id, c.color]))
  const hechos = optimistic.filter((entry) => entry.done).length

  function toggle(entry: TodayEntry) {
    const next = !entry.done
    setError(null)
    startTransition(async () => {
      setOptimistic({ id: entry.item.id, done: next })
      try {
        const result = await toggleCompleted(entry.item.id, next, date)
        if (result.status === 'error') setError(result.message)
      } catch {
        setError('No se pudo marcar el ítem. Inténtalo de nuevo.')
      }
    })
  }

  return (
    <section
      aria-labelledby="titulo-hoy"
      className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="titulo-hoy" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Hoy · {DAY_NAMES[weekday]}
        </h2>
        {optimistic.length > 0 && (
          <>
            <span aria-hidden className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              {hechos}/{optimistic.length}
            </span>
            {/* el «3/8» se lee mal en voz alta y su cambio no se anunciaría */}
            <span role="status" className="sr-only">
              {hechos} de {optimistic.length} hechos hoy
            </span>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {optimistic.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Hoy no tienes nada planificado.</p>
      ) : (
        // role="list" explícito: Tailwind quita los bullets y Safari/VoiceOver
        // deja de anunciar la lista cuando list-style es none
        <ul role="list" className="flex flex-col">
          {optimistic.map((entry) => {
            const color =
              (entry.item.categoryId && colorByCategory.get(entry.item.categoryId)) || null
            const texto = `${entry.item.title}${entry.item.detail ? ` · ${entry.item.detail}` : ''}`
            return (
              <li key={entry.item.id} className="flex items-center gap-2">
                {/* el label amplía el área táctil de la casilla, que sola
                    mediría 16 px y con dos tomas seguidas se pulsa la de al lado */}
                <label className="-m-1 flex cursor-pointer items-center p-1">
                  <input
                    type="checkbox"
                    checked={entry.done}
                    onChange={() => toggle(entry)}
                    aria-label={`Marcar «${entry.item.title}» de las ${entry.item.start} como hecho`}
                    className="size-4 accent-zinc-900 dark:accent-zinc-100"
                  />
                </label>
                <span
                  aria-hidden
                  className="cat-mark h-3 w-1 shrink-0 rounded-full"
                  style={{ ...categoryColorStyle(color), backgroundColor: 'var(--cat)' }}
                />
                <span
                  aria-hidden
                  className="w-11 shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400"
                >
                  {entry.item.start}
                </span>
                <button
                  type="button"
                  onClick={() => onItemClick(entry.item)}
                  title={texto}
                  className={`min-w-0 flex-1 truncate py-1.5 text-left text-sm transition-opacity hover:opacity-70 ${
                    entry.done
                      ? 'text-zinc-400 line-through dark:text-zinc-600'
                      : 'text-zinc-800 dark:text-zinc-200'
                  }`}
                >
                  {texto}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
