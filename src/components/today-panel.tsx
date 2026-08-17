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
  // Ítems con una escritura en vuelo. Sin esto, dos clics rápidos sobre la
  // misma casilla lanzan dos peticiones con `done` opuestos y, si resuelven en
  // orden inverso, lo guardado no es lo último que pidió el usuario. En una
  // app de medicación eso no es cosmético.
  const [pendingIds, setPendingIds] = useState<string[]>([])
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
  // El primer pendiente de la lista (que ya viene en orden de reloj) es lo que
  // el usuario está buscando al abrir el panel, así que se destaca. Se elige
  // por posición y no por la hora del navegador a propósito: un cálculo con
  // reloj de cliente exigiría hidratar sin desajuste, y lo que quedó atrás sin
  // marcar sigue siendo lo primero que hay que atender.
  const firstPendingId = optimistic.find((entry) => !entry.done)?.item.id ?? null

  function toggle(entry: TodayEntry) {
    const next = !entry.done
    const id = entry.item.id
    setError(null)
    setPendingIds((ids) => [...ids, id])
    startTransition(async () => {
      setOptimistic({ id, done: next })
      try {
        const result = await toggleCompleted(id, next, date)
        if (result.status === 'error') setError(result.message)
      } catch {
        setError('No se pudo marcar el ítem. Inténtalo de nuevo.')
      } finally {
        setPendingIds((ids) => ids.filter((pending) => pending !== id))
      }
    })
  }

  return (
    <section
      aria-labelledby="titulo-hoy"
      className="flex flex-col gap-2 rounded-xl border border-edge/60 bg-card p-4 shadow-[var(--shadow-card)]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="titulo-hoy" className="text-sm font-semibold text-ink">
          Hoy · {DAY_NAMES[weekday]}
        </h2>
        {optimistic.length > 0 && (
          <>
            <span aria-hidden className="text-xs tabular-nums text-ink-3">
              {hechos}/{optimistic.length}
            </span>
            {/* el «3/8» se lee mal en voz alta y su cambio no se anunciaría */}
            <span role="status" className="sr-only">
              {hechos} de {optimistic.length} hechos hoy
            </span>
          </>
        )}
      </div>

      {/* El avance en una barra: la proporción se ve de un vistazo, que es lo
          que el número solo no da (spec §4). Decorativa a propósito —
          aria-hidden— porque el status de arriba ya lo anuncia y dos regiones
          diciendo lo mismo se leerían dos veces. */}
      {optimistic.length > 0 && (
        <div aria-hidden className="h-1 overflow-hidden rounded-full bg-edge">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${(hechos / optimistic.length) * 100}%` }}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {optimistic.length === 0 ? (
        <p className="text-sm text-ink-3">Hoy no tienes nada planificado.</p>
      ) : (
        // role="list" explícito: Tailwind quita los bullets y Safari/VoiceOver
        // deja de anunciar la lista cuando list-style es none
        <ul role="list" className="flex flex-col">
          {optimistic.map((entry) => {
            const color =
              (entry.item.categoryId && colorByCategory.get(entry.item.categoryId)) || null
            const texto = `${entry.item.title}${entry.item.detail ? ` · ${entry.item.detail}` : ''}`
            const isFirstPending = entry.item.id === firstPendingId
            return (
              <li
                key={entry.item.id}
                // barra lateral de acento en lo primero que queda por hacer:
                // el borde transparente en el resto evita que la lista salte
                className={`flex items-center gap-2 border-l-2 pl-1.5 ${
                  isFirstPending ? 'border-accent' : 'border-transparent'
                }`}
              >
                {/* el label amplía el área táctil de la casilla, que sola
                    mediría 16 px y con dos tomas seguidas se pulsa la de al lado */}
                <label className="-m-1 flex cursor-pointer items-center p-1">
                  <input
                    type="checkbox"
                    checked={entry.done}
                    onChange={() => toggle(entry)}
                    disabled={pendingIds.includes(entry.item.id)}
                    aria-label={`Marcar «${entry.item.title}» de las ${entry.item.start} como hecho`}
                    className="size-4 accent-accent disabled:opacity-50"
                  />
                </label>
                <span
                  aria-hidden
                  className="cat-mark h-3 w-1 shrink-0 rounded-full"
                  style={{ ...categoryColorStyle(color), backgroundColor: 'var(--cat)' }}
                />
                <span
                  aria-hidden
                  className="w-11 shrink-0 text-xs tabular-nums text-ink-3"
                >
                  {entry.item.start}
                </span>
                <button
                  type="button"
                  onClick={() => onItemClick(entry.item)}
                  title={texto}
                  className={`min-w-0 flex-1 truncate py-1.5 text-left text-sm transition-colors hover:text-ink-2 ${
                    entry.done
                      ? 'text-ink-3 line-through'
                      : isFirstPending
                        ? 'font-medium text-ink'
                        : 'text-ink'
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
