'use client'

import { useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import { WeekPoster } from '@/components/week-poster'
import type { Category, RoutineItem } from '@/lib/schemas'

// Exportación de la semana (spec §4, Must #13): monta la lámina fuera de
// pantalla SOLO durante la captura —mantenerla siempre en el DOM costaría un
// segundo calendario renderizado para nadie— y la convierte a PNG en el
// navegador. Sin servidor: los datos ya están aquí.

type Phase = 'idle' | 'busy' | 'error'

export function ExportButton({
  items,
  categories,
  date,
  weekday,
}: {
  items: RoutineItem[]
  categories: Category[]
  date: string
  weekday: number
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const posterRef = useRef<HTMLDivElement>(null)

  function exportPng() {
    if (phase === 'busy') return
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
        link.download = `rutia-semana-${date}.png`
        link.click()
        setPhase('idle')
      } catch {
        // el detalle no le sirve al usuario; reintentar sí
        setPhase('error')
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={exportPng}
        disabled={phase === 'busy'}
        className="rounded-md border border-edge bg-card px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-edge/40 active:translate-y-px disabled:opacity-50"
      >
        {phase === 'busy' ? 'Exportando…' : phase === 'error' ? 'Reintentar exportar' : 'Exportar'}
      </button>
      {phase === 'error' && (
        <span role="alert" className="sr-only">
          No se pudo exportar la imagen. Vuelve a intentarlo.
        </span>
      )}

      {/* fuera del viewport, no display:none: html-to-image necesita un nodo
          con layout real para medirlo y clonarlo */}
      {phase === 'busy' && (
        <div aria-hidden inert className="pointer-events-none fixed top-0 -left-[3000px]">
          <div ref={posterRef}>
            <WeekPoster items={items} categories={categories} date={date} weekday={weekday} />
          </div>
        </div>
      )}
    </>
  )
}
