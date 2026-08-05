'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { saveAppearance } from '@/app/app/actions'
import { FONTS, MODES, THEMES, type Appearance } from '@/lib/appearance'

// Selector de apariencia (spec §4): modo, tema de superficie y fuente. Los
// cambios se aplican al momento (la página se revalida y el wrapper cambia de
// atributos), así que el diálogo funciona como una previsualización en vivo.

const MODE_LABELS: Record<string, string> = {
  light: 'Claro',
  dark: 'Oscuro',
  auto: 'Automático',
}

const FONT_LABELS: Record<string, string> = {
  system: 'Sistema',
  serif: 'Serif',
  rounded: 'Redondeada',
}

const OPTION_CLASS =
  'flex cursor-pointer items-center gap-1.5 rounded-md border border-edge px-2.5 py-1.5 text-sm text-ink has-checked:border-accent has-checked:bg-accent has-checked:text-accent-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent has-disabled:cursor-default has-disabled:opacity-60'

// El radio de tema NO usa fondo de acento al marcarse: el swatch de tres
// franjas se fundiría con él (la franja central ES el acento). Se marca con
// anillo, como el muestrario de colores de categoría.
const THEME_OPTION_CLASS =
  'flex cursor-pointer items-center gap-1.5 rounded-md border border-edge px-2.5 py-1.5 text-sm text-ink ring-offset-card has-checked:border-accent has-checked:ring-2 has-checked:ring-accent has-checked:ring-offset-2 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent has-disabled:cursor-default has-disabled:opacity-60'

export function AppearanceDialog({
  appearance,
  onClose,
}: {
  appearance: Appearance
  onClose: () => void
}) {
  const [current, setCurrent] = useState<Appearance>(appearance)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const backdropMouseDown = useRef(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  // Última apariencia CONFIRMADA por el servidor: el rollback vuelve aquí, no
  // al valor optimista anterior, para no divergir del estado real.
  const confirmed = useRef<Appearance>(appearance)

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // no descartar con un guardado en vuelo: su error se perdería sin verse
      if (event.key === 'Escape' && !isPending) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, isPending])

  function apply(next: Appearance) {
    setCurrent(next)
    setError(null)
    startTransition(async () => {
      try {
        const result = await saveAppearance(next)
        if (result?.status === 'error') {
          setCurrent(confirmed.current)
          setError(result.message)
          return
        }
        confirmed.current = next
      } catch {
        setCurrent(confirmed.current)
        setError('No se pudo guardar la apariencia. Inténtalo de nuevo.')
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        backdropMouseDown.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && backdropMouseDown.current && !isPending) {
          onClose()
        }
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-apariencia"
        className="max-h-full w-full max-w-md overflow-y-auto rounded-xl border border-edge bg-card p-4 shadow-lg outline-none"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="titulo-apariencia" className="text-base font-semibold text-ink">
            Apariencia
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-md border border-edge px-3 py-1.5 text-sm font-medium text-ink hover:bg-edge/40 disabled:opacity-50"
          >
            Cerrar
          </button>
        </div>

        {error && (
          <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="text-sm text-ink-2">Modo</legend>
            <div className="flex flex-wrap gap-2">
              {MODES.map((mode) => (
                <label key={mode} className={OPTION_CLASS}>
                  <input
                    type="radio"
                    name="mode"
                    value={mode}
                    checked={current.mode === mode}
                    onChange={() => apply({ ...current, mode })}
                    disabled={isPending}
                    className="sr-only"
                  />
                  {MODE_LABELS[mode]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-sm text-ink-2">Tema</legend>
            <div className="flex flex-wrap gap-2">
              {THEMES.map((theme) => (
                <label key={theme.id} className={THEME_OPTION_CLASS} title={theme.label}>
                  <input
                    type="radio"
                    name="theme"
                    value={theme.id}
                    checked={current.theme === theme.id}
                    onChange={() => apply({ ...current, theme: theme.id })}
                    disabled={isPending}
                    className="sr-only"
                  />
                  {/* muestra del tema: página clara, acento, página oscura */}
                  <span aria-hidden className="flex overflow-hidden rounded-full border border-edge">
                    {theme.swatch.map((hex) => (
                      <span key={hex} className="h-3.5 w-3.5" style={{ backgroundColor: hex }} />
                    ))}
                  </span>
                  {theme.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-sm text-ink-2">Fuente</legend>
            <div className="flex flex-wrap gap-2">
              {FONTS.map((font) => (
                <label key={font} className={OPTION_CLASS}>
                  <input
                    type="radio"
                    name="font"
                    value={font}
                    checked={current.font === font}
                    onChange={() => apply({ ...current, font })}
                    disabled={isPending}
                    className="sr-only"
                  />
                  {FONT_LABELS[font]}
                </label>
              ))}
            </div>
          </fieldset>

          {isPending && <p className="text-xs text-ink-3">Aplicando…</p>}
        </div>
      </div>
    </div>
  )
}
