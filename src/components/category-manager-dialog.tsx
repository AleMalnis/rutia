'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { deleteCategory, saveCategory } from '@/app/app/actions'
import { CATEGORY_COLORS, categoryColorStyle } from '@/lib/category-colors'
import type { Category } from '@/lib/schemas'

// Gestor de categorías propias (spec §4): crear, renombrar, recolorear y
// borrar. El color se elige de un muestrario validado: cualquier elección se
// lee bien en claro y en oscuro.

type Props = {
  categories: Category[]
  onClose: () => void
}

type Draft = {
  /** null = creando una nueva */
  id: string | null
  name: string
  color: string
}

export function CategoryManagerDialog({ categories, onClose }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const backdropMouseDown = useRef(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  // El fondo pasa a inert en el mismo commit, así que el navegador ya ha
  // sacado el foco del botón que abrió esto: hay que llevarlo al diálogo a
  // mano, o el lector de pantalla no anuncia nada. La devolución al cerrar la
  // hace RoutineBoard, que sí conoce el disparador.
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  // Al pasar a «¿Borrar?» desaparece el botón que tenía el foco y este caería
  // a body; se lleva al «Sí», que es la acción que el usuario venía a hacer.
  useEffect(() => {
    if (confirmingDelete != null) confirmRef.current?.focus()
  }, [confirmingDelete])

  // El color heredado de la paleta antigua se ofrece como novena muestra: sin
  // esto, renombrar una categoría obligaría a cambiarle también el color.
  const legacyColor =
    draft?.id != null && !CATEGORY_COLORS.some((c) => c.light === draft.color)
      ? draft.color
      : null

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPending) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, isPending])

  function submitDraft() {
    if (draft == null) return
    setError(null)
    startTransition(async () => {
      try {
        const result = await saveCategory(draft.id, { name: draft.name, color: draft.color })
        if (result?.status === 'error') {
          setError(result.message)
          return
        }
        setDraft(null)
      } catch {
        setError('No se pudo guardar la categoría. Inténtalo de nuevo.')
      }
    })
  }

  function removeCategory(id: string) {
    setError(null)
    startTransition(async () => {
      try {
        const result = await deleteCategory(id)
        if (result?.status === 'error') {
          setError(result.message)
          return
        }
        setConfirmingDelete(null)
      } catch {
        setError('No se pudo borrar la categoría. Inténtalo de nuevo.')
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
        aria-labelledby="titulo-categorias"
        className="max-h-full w-full max-w-md overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 shadow-lg outline-none dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2
            id="titulo-categorias"
            className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
          >
            Categorías
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Cerrar
          </button>
        </div>

        {error && (
          <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <ul role="list" className="flex flex-col gap-1">
          {categories.map((category) => (
            <li key={category.id} className="flex items-center gap-2 py-0.5">
              <span
                aria-hidden
                className="cat-mark h-3.5 w-3.5 shrink-0 rounded-full"
                style={{ ...categoryColorStyle(category.color), backgroundColor: 'var(--cat)' }}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-200">
                {category.name}
              </span>

              {confirmingDelete === category.id ? (
                <span className="flex items-center gap-1.5 text-sm">
                  <span className="text-zinc-600 dark:text-zinc-400">¿Borrar?</span>
                  <button
                    ref={confirmRef}
                    type="button"
                    onClick={() => removeCategory(category.id)}
                    disabled={isPending}
                    className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Sí
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(null)}
                    disabled={isPending}
                    className="rounded-md px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    No
                  </button>
                </span>
              ) : (
                <>
                  {/* deshabilitados con un borrador abierto: pulsarlos lo
                      descartaría en silencio */}
                  <button
                    type="button"
                    onClick={() => {
                      setDraft({ id: category.id, name: category.name, color: category.color })
                      setConfirmingDelete(null)
                    }}
                    disabled={isPending || draft != null}
                    className="rounded-md px-2 py-0.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(category.id)}
                    disabled={isPending || draft != null}
                    className="rounded-md px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950"
                  >
                    Borrar
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>

        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Al borrar una categoría, sus ítems quedan «sin categoría».
        </p>

        {draft == null ? (
          <button
            type="button"
            onClick={() => setDraft({ id: null, name: '', color: CATEGORY_COLORS[0].light })}
            disabled={isPending}
            className="mt-3 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Nueva categoría
          </button>
        ) : (
          <form
            className="mt-3 space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
            onSubmit={(event) => {
              event.preventDefault()
              submitDraft()
            }}
          >
            <label className="block space-y-1">
              <span className="text-sm text-zinc-700 dark:text-zinc-300">Nombre</span>
              <input
                type="text"
                required
                maxLength={40}
                autoFocus
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </label>

            <fieldset className="space-y-1">
              <legend className="text-sm text-zinc-700 dark:text-zinc-300">
                Color <span className="text-zinc-500 dark:text-zinc-400">(muestrario validado)</span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {[
                  ...CATEGORY_COLORS,
                  ...(legacyColor
                    ? [{ name: 'Color actual (heredado)', light: legacyColor, dark: legacyColor }]
                    : []),
                ].map((color) => (
                  <label
                    key={color.light}
                    title={color.name}
                    className="cat-mark relative h-7 w-7 cursor-pointer rounded-full has-checked:ring-2 has-checked:ring-zinc-900 has-checked:ring-offset-2 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-zinc-900 dark:has-checked:ring-zinc-100 dark:ring-offset-zinc-950 dark:has-focus-visible:outline-zinc-100"
                    style={{ ...categoryColorStyle(color.light), backgroundColor: 'var(--cat)' }}
                  >
                    <input
                      type="radio"
                      name="color"
                      value={color.light}
                      aria-label={color.name}
                      checked={draft.color === color.light}
                      onChange={() => setDraft({ ...draft, color: color.light })}
                      className="sr-only"
                    />
                  </label>
                ))}
              </div>
              {legacyColor && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  El color actual es anterior al muestrario validado. Puedes conservarlo o elegir
                  uno nuevo.
                </p>
              )}
            </fieldset>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDraft(null)}
                disabled={isPending}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {isPending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
