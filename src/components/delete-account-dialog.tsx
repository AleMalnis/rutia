'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { deleteAccount } from '@/app/app/actions'

// Borrado de la cuenta (spec §12.13, RGPD art. 17): la única acción
// IRREVERSIBLE de toda la app, así que dos barreras — un diálogo que dice
// exactamente qué se pierde y la palabra BORRAR tecleada (validada también en
// el servidor). Antes de la zona roja, la salida buena: descargar los datos.

export function DeleteAccountDialog({
  iosStandalone,
  onClose,
}: {
  iosStandalone: boolean
  onClose: () => void
}) {
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const backdropMouseDown = useRef(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // no descartar con el borrado en vuelo: su error se perdería sin verse
      if (event.key === 'Escape' && !isPending) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, isPending])

  const ready = confirmation === 'BORRAR'

  function submit() {
    if (!ready || isPending) return
    setError(null)
    startTransition(async () => {
      try {
        // si borra de verdad, la action redirige a la portada y este código
        // no vuelve a ejecutarse; aquí solo llegan los errores
        const result = await deleteAccount(confirmation)
        if (result?.status === 'error') setError(result.message)
      } catch (caught) {
        // el redirect de éxito viaja como excepción: dejarlo pasar
        if (caught instanceof Error && caught.message === 'NEXT_REDIRECT') throw caught
        setError('No se pudo borrar la cuenta. Vuelve a intentarlo.')
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
        aria-labelledby="titulo-borrar-cuenta"
        className="max-h-full w-full max-w-md overflow-y-auto rounded-xl border border-edge bg-card p-4 shadow-lg outline-none"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="titulo-borrar-cuenta" className="text-base font-semibold text-ink">
            Borrar la cuenta
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-md border border-edge px-3 py-1.5 text-sm font-medium text-ink hover:bg-edge/40 disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>

        <p className="text-sm text-ink-2">
          Se borra <strong className="text-ink">todo, para siempre</strong>: tu rutina con sus
          notas, las categorías, el historial de completados, la conversación con el asistente, tu
          clave de API cifrada y los accesos del modo MCP. No hay forma de deshacerlo ni copia que
          recuperar.
        </p>

        {/* misma bifurcación que el pie del calendario: en la web app
            instalada de iOS el enlace de descarga acaba en una pantalla
            trampa, y aquí es la última red de seguridad antes de borrar */}
        {iosStandalone ? (
          <p className="mt-2 text-sm text-ink-2">
            Si quieres conservar algo, abre RutIA en Safari y descarga tus datos antes: la app
            instalada no puede guardar ficheros.
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink-2">
            Si quieres conservar algo,{' '}
            <a href="/api/export" className="font-medium text-ink underline">
              descarga tus datos
            </a>{' '}
            antes.
          </p>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="mt-4 space-y-3"
        >
          <label className="block space-y-1.5">
            <span className="text-sm text-ink-2">
              Escribe <strong className="font-mono text-ink">BORRAR</strong> para confirmar
            </span>
            <input
              type="text"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              disabled={isPending}
              className="w-full rounded-md border border-edge bg-page px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:outline-2 focus:outline-accent disabled:opacity-50"
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!ready || isPending}
            className="w-full rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 active:translate-y-px disabled:opacity-50"
          >
            {isPending ? 'Borrando…' : 'Borrar mi cuenta para siempre'}
          </button>
        </form>
      </div>
    </div>
  )
}
