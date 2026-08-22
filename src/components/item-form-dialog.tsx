'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { deleteItem, saveItem, type ItemFormState } from '@/app/app/actions'
import { DAY_NAMES, DAY_SHORT } from '@/lib/calendar'
import type { Category, RoutineItem } from '@/lib/schemas'

type Props = {
  item: RoutineItem | null
  categories: Category[]
  /** Si el usuario ya registró el consentimiento de datos de salud (§12.12). */
  hasHealthConsent: boolean
  onClose: () => void
}

const INPUT_CLASS =
  'w-full rounded-md border border-edge bg-card px-2.5 py-1.5 text-sm text-ink focus:outline-2 focus:outline-accent'

const DAY_CLASS =
  'flex cursor-pointer items-center gap-1 rounded-md border border-edge px-2 py-1 text-sm text-ink has-checked:border-accent has-checked:bg-accent has-checked:text-accent-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent'

export function ItemFormDialog({ item, categories, hasHealthConsent, onClose }: Props) {
  const [state, formAction] = useActionState<ItemFormState, FormData>(saveItem, null)
  const [isSubmitting, startSubmit] = useTransition()
  const [kind, setKind] = useState<'block' | 'reminder'>(item?.kind ?? 'block')
  // La casilla del art. 9 (spec §12.12) solo aparece cuando hace falta: hay
  // texto libre (el detalle del formulario, o unas notas que el ítem ya
  // trae del chat) y no consta consentimiento previo.
  const [carriesFreeText, setCarriesFreeText] = useState(
    Boolean(item?.detail?.trim()) || Boolean(item?.notes?.trim()),
  )
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const backdropMouseDown = useRef(false)

  const busy = isSubmitting || isDeleting

  // La acción no puede cerrar el diálogo por sí misma: el estado vive aquí.
  useEffect(() => {
    if (state?.status === 'ok') onClose()
  }, [state, onClose])

  // La devolución del foco al cerrar la gestiona RoutineBoard: captura el
  // disparador en el clic, antes de que el `inert` del fondo mueva el foco.

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
        className="max-h-full w-full max-w-md overflow-y-auto rounded-xl border border-edge bg-card p-4 shadow-lg"
      >
        <h2
          id="titulo-dialogo"
          className="mb-3 text-base font-semibold text-ink"
        >
          {item ? 'Editar ítem' : 'Nuevo ítem'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          {item && <input type="hidden" name="itemId" value={item.id} />}

          <label className="block space-y-1">
            <span className="text-sm text-ink-2">Título</span>
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
            <legend className="text-sm text-ink-2">Tipo</legend>
            <div className="flex gap-4 text-sm text-ink">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="kind"
                  value="block"
                  checked={kind === 'block'}
                  onChange={() => setKind('block')}
                  className="accent-accent"
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
                  className="accent-accent"
                />
                Recordatorio
              </label>
            </div>
          </fieldset>

          <fieldset className="space-y-1">
            <legend className="text-sm text-ink-2">Días</legend>
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
              <span className="text-sm text-ink-2">Inicio</span>
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
              <span className="text-sm text-ink-2">Fin</span>
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
            <span className="text-sm text-ink-2">Categoría</span>
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
            <span className="text-sm text-ink-2">
              Detalle <span className="text-ink-3">(opcional)</span>
            </span>
            <input
              name="detail"
              type="text"
              maxLength={120}
              placeholder="Pasta · Enalapril 10 mg…"
              defaultValue={item?.detail ?? ''}
              onChange={(event) =>
                setCarriesFreeText(
                  event.target.value.trim() !== '' || Boolean(item?.notes?.trim()),
                )
              }
              className={INPUT_CLASS}
            />
          </label>

          {/* consentimiento explícito del art. 9 (spec §12.12): required
              nativo — si la casilla está visible, no se envía sin marcarla;
              el servicio la exige igualmente en el servidor */}
          {!hasHealthConsent && carriesFreeText && (
            <label className="flex items-start gap-2 rounded-md border border-edge bg-page p-2.5 text-sm text-ink-2">
              <input
                type="checkbox"
                name="healthConsent"
                required
                className="mt-0.5 size-4 shrink-0 accent-accent"
              />
              <span>
                El detalle y las notas pueden contener{' '}
                <strong className="text-ink">datos de salud</strong>. Doy mi consentimiento
                explícito para que RutIA guarde y trate ese texto como describe el{' '}
                <a
                  href="/legal/privacidad"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  apartado 3 de la política
                </a>
                . Queda registrado con fecha y versión.
              </span>
            </label>
          )}

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
                <span className="text-ink-2">¿Seguro?</span>
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
                  className="rounded-md px-2 py-1 text-ink-2 hover:bg-edge/40 disabled:opacity-50"
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
                className="rounded-md border border-edge px-3 py-1.5 text-sm font-medium text-ink hover:bg-edge/40 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_85%,var(--accent-ink))] disabled:opacity-50"
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
