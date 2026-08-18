'use client'

import { useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import { WeekPoster } from '@/components/week-poster'
import type { Category, RoutineItem } from '@/lib/schemas'

// Exportación de la semana (spec §4, Must #13): monta la lámina fuera de
// pantalla SOLO durante la captura —mantenerla siempre en el DOM costaría un
// segundo calendario renderizado para nadie— y la convierte a PNG en el
// navegador. Sin servidor: los datos ya están aquí.
//
// El botón ofrece lámina clara u oscura (spec §4, el Should promovido): la
// lámina lleva el tema del usuario, pero el modo se elige al exportar porque
// el destino manda — un fondo de pantalla oscuro se quiere oscuro aunque la
// app se use en claro.

type Phase = 'idle' | 'busy' | 'error'
type PosterMode = 'light' | 'dark'

export function ExportButton({
  items,
  categories,
  date,
  weekday,
  theme,
}: {
  items: RoutineItem[]
  categories: Category[]
  date: string
  weekday: number
  /** Tema de superficie del usuario: tu póster, tus colores. */
  theme: string
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [menuOpen, setMenuOpen] = useState(false)
  const [mode, setMode] = useState<PosterMode>('light')
  const posterRef = useRef<HTMLDivElement>(null)

  function exportPng(chosen: PosterMode) {
    if (phase === 'busy') return
    setMenuOpen(false)
    setMode(chosen)
    setPhase('busy')
    // la lámina se monta en este mismo render; la captura espera a que las
    // fuentes estén listas o el PNG saldría con la fuente de respaldo
    requestAnimationFrame(async () => {
      try {
        await document.fonts.ready
        const node = posterRef.current
        if (node == null) throw new Error('lámina sin montar')
        const dataUrl = await toPng(node, { width: 1920, height: 1080, pixelRatio: 1 })
        const link = document.createElement('a')
        link.href = dataUrl
        link.download = `rutia-semana-${date}${chosen === 'dark' ? '-oscura' : ''}.png`
        link.click()
        setPhase('idle')
      } catch {
        // el detalle no le sirve al usuario; reintentar sí
        setPhase('error')
      }
    })
  }

  return (
    <div
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape') setMenuOpen(false)
      }}
    >
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        disabled={phase === 'busy'}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="rounded-md border border-edge bg-card px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-edge/40 active:translate-y-px disabled:opacity-50"
      >
        {phase === 'busy' ? 'Exportando…' : phase === 'error' ? 'Reintentar exportar' : 'Exportar'}
      </button>
      {phase === 'error' && (
        <span role="alert" className="sr-only">
          No se pudo exportar la imagen. Vuelve a intentarlo.
        </span>
      )}

      {menuOpen && (
        <>
          {/* velo transparente: cerrar el menú al hacer clic fuera sin
              escuchar en document; va justo por debajo del propio menú */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            aria-label="Elegir lámina"
            className="absolute left-0 top-full z-50 mt-1 w-44 rounded-md border border-edge bg-card p-1 shadow-[var(--shadow-card)]"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => exportPng('light')}
              className="block w-full rounded px-2.5 py-1.5 text-left text-sm text-ink transition-colors hover:bg-edge/40"
            >
              Lámina clara
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => exportPng('dark')}
              className="block w-full rounded px-2.5 py-1.5 text-left text-sm text-ink transition-colors hover:bg-edge/40"
            >
              Lámina oscura
            </button>
          </div>
        </>
      )}

      {/* fuera del viewport, no display:none: html-to-image necesita un nodo
          con layout real para medirlo y clonarlo */}
      {phase === 'busy' && (
        <div aria-hidden inert className="pointer-events-none fixed top-0 -left-[3000px]">
          <div ref={posterRef}>
            <WeekPoster
              items={items}
              categories={categories}
              date={date}
              weekday={weekday}
              theme={theme}
              mode={mode}
            />
          </div>
        </div>
      )}
    </div>
  )
}
