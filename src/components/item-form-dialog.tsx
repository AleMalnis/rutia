'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { deleteItem, saveItem, type ItemFormState } from '@/app/app/actions'
import { DAY_NAMES, DAY_SHORT } from '@/lib/calendar'
import type { Category, RoutineItem } from '@/lib/schemas'

type Props = {
  item: RoutineItem | null
  categories: Category[]
  onClose: () => void
}

const INPUT_CLASS =
  'w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50'

const DAY_CLASS =
  'flex cursor-pointer items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-800 has-checked:border-zinc-900 has-checked:bg-zinc-900 has-checked:text-white has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-zinc-900 dark:border-zinc-700 dark:text-zinc-200 dark:has-checked:border-zinc-100 dark:has-checked:bg-zinc-100 dark:has-checked:text-zinc-900 dark:has-focus-visible:outline-zinc-100'

export function ItemFormDialog({ item, categories, onClose }: Props) {
  const [state, formAction] = useActionState<ItemFormState, FormData>(saveItem, null)
  const [isSubmitting, startSubmit] = useTransition()
  const [kind, setKind] = useState<'block' | 'reminder'>(item?.kind ?? 'block')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const backdropMouseDown = useRef(false)

  const busy = isSubmitting || isDeleting

  // La acción no puede cerrar el diálogo por sí misma: el estado vive aquí.
  useEffect(() => {
    if (state?.status === 'ok') onClose()
  }, [state, onClose])

  // Devuelve el foco a donde estaba (la tarjeta del calendario o el botón).
  useEffect(() => {
    const previous = document.activeElement
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // no descartar mientras hay una escritura en vuelo: perderíamos el
      // resultado (un conflicto, por ejemplo) sin llegar a mostrarlo
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, busy])

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    // Invocamos la acción en una transición propia en vez de pasarla a
    // <form action>: esa vía pide un reset del formulario, y al volver un
    // conflicto o un error el usuario perdería todo lo que había escrito.
    startSubmit(() => formAction(formData))
  }

  async function handleDelete() {
    if (item == null) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      const result = await deleteItem(item.id)
      if (result?.status === 'error') {
        setDeleteError(result.message)
        return
      }
      onClose()
    } catch {
      // los error boundaries no capturan fallos de handlers: si no lo
      // hacemos aquí, el botón se queda en «Borrando…» para siempre
      setDeleteError('No se pudo borrar el ítem. Inténtalo de nuevo.')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        backdropMouseDown.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        // solo si el gesto empezó y terminó en el fondo: si no, arrastrar
        // para seleccionar texto y soltar fuera cerraría el formulario
        if (event.target === event.currentTarget && backdropMouseDown.current && !busy) {
          onClose()
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-dialogo"
        className="max-h-full w-full max-w-md overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
      >
        <h2
          id="titulo-dialogo"
          className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-50"
        >
          {item ? 'Editar ítem' : 'Nuevo ítem'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          {item && <input type="hidden" name="itemId" value={item.id} />}

          <label className="block space-y-1">
            <span className="text-sm text-zinc-700 dark:text-zinc-300">Título</span>
            <input
              name="title"
              type="text"
              required
              maxLength={80}
              autoFocus
              defaultValue={item?.title ?? ''}
              className={INPUT_CLASS}
            />
          </label>

          <fieldset className="space-y-1">
            <legend className="text-sm text-zinc-700 dark:text-zinc-300">Tipo</legend>
            <div className="flex gap-4 text-sm text-zinc-800 dark:text-zinc-200">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="kind"
                  value="block"
                  checked={kind === 'block'}
                  onChange={() => setKind('block')}
                />
                Bloque
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="kind"
                  value="reminder"
                  checked={kind === 'reminder'}
                  onChange={() => setKind('reminder')}
                />
                Recordatorio
              </label>
            </div>
          </fieldset>

          <fieldset className="space-y-1">
            <legend className="text-sm text-zinc-700 dark:text-zinc-300">Días</legend>
            <div className="flex flex-wrap gap-1.5">
              {DAY_SHORT.map((short, day) => (
                <label key={day} className={DAY_CLASS}>
                  <input
                    type="checkbox"
                    name="days"
                    value={day}
                    aria-label={DAY_NAMES[day]}
                    defaultChecked={item?.days.includes(day) ?? false}
                    className="sr-only"
                  />
                  {short}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex gap-3">
            <label className="block flex-1 space-y-1">
              <span className="text-sm text-zinc-700 dark:text-zinc-300">Inicio</span>
              <input
                name="start"
                type="time"
                required
                defaultValue={item?.start ?? '09:00'}
                className={INPUT_CLASS}
              />
            </label>
            {/* oculto, no desmontado: al alternar el tipo se perdería lo
                tecleado. `required` solo cuando es visible, o el navegador
                bloquearía el envío sobre un campo que no puede enfocar. */}
            <label className={`block flex-1 space-y-1 ${kind === 'block' ? '' : 'hidden'}`}>
              <span className="text-sm text-zinc-700 dark:text-zinc-300">Fin</span>
              <input
                name="end"
                type="time"
                required={kind === 'block'}
                defaultValue={item?.end ?? '10:00'}
                className={INPUT_CLASS}
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-sm text-zinc-700 dark:text-zinc-300">Categoría</span>
            <select name="categoryId" defaultValue={item?.categoryId ?? ''} className={INPUT_CLASS}>
              <option value="">Sin categoría</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              Detalle <span className="text-zinc-400">(opcional)</span>
            </span>
            <input
              name="detail"
              type="text"
              maxLength={120}
              placeholder="Pasta · Enalapril 10 mg…"
              defaultValue={item?.detail ?? ''}
              className={INPUT_CLASS}
            />
          </label>

          {state?.status === 'error' && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {state.message}
            </p>
          )}

          {state?.status === 'conflict' && (
            <div
              role="alert"
              className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
            >
              <p className="font-medium">Este bloque choca con lo que ya tienes:</p>
              <ul className="list-inside list-disc">
                {state.conflicts.map((conflict) => (
                  <li key={conflict.itemId}>
                    «{conflict.title}» {conflict.days.map((d) => DAY_SHORT[d]).join(', ')} de{' '}
                    {conflict.start} a {conflict.end}
                  </li>
                ))}
              </ul>
              <p>Cambia la hora o los días para que no se pisen.</p>
            </div>
          )}

          {deleteError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {deleteError}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            {item && !confirmingDelete && (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
                className="rounded-md px-2 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950"
              >
                Borrar
              </button>
            )}
            {item && confirmingDelete && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-zinc-700 dark:text-zinc-300">¿Seguro?</span>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={busy}
                  className="rounded-md bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {isDeleting ? 'Borrando…' : 'Sí, borrar'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={busy}
                  className="rounded-md px-2 py-1 text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  No
                </button>
              </div>
            )}

            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {isSubmitting ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
