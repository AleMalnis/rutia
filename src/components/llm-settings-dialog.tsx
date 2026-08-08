'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { deleteLlmKey, saveLlmKey } from '@/app/app/actions'
import {
  LLM_PROVIDERS,
  providerLabel,
  type LlmKeyStatusView,
  type LlmProviderId,
} from '@/lib/llm-providers'

// Ajustes → IA (BYOK, spec §6.4): el usuario elige proveedor y pega su clave
// de API. La clave viaja UNA vez al servidor, se cifra y no vuelve jamás:
// aquí solo se pinta el proveedor y los últimos 4 caracteres.

const OPTION_CLASS =
  'flex cursor-pointer items-center gap-1.5 rounded-md border border-edge px-2.5 py-1.5 text-sm text-ink has-checked:border-accent has-checked:bg-accent has-checked:text-accent-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent has-disabled:cursor-default has-disabled:opacity-60'

export function LlmSettingsDialog({
  status,
  onStatusChange,
  onClose,
}: {
  status: LlmKeyStatusView | null
  onStatusChange: (status: LlmKeyStatusView | null) => void
  onClose: () => void
}) {
  const [provider, setProvider] = useState<LlmProviderId>(status?.provider ?? 'anthropic')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isPending, startTransition] = useTransition()
  const backdropMouseDown = useRef(false)
  const dialogRef = useRef<HTMLDivElement>(null)

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

  const selected = LLM_PROVIDERS.find((entry) => entry.id === provider)

  function save() {
    const key = apiKey.trim()
    if (key.length === 0 || isPending) return
    setError(null)
    setInfo(null)
    setConfirmDelete(false)
    startTransition(async () => {
      try {
        const result = await saveLlmKey({ provider, apiKey: key })
        if (result?.status === 'ok') {
          onStatusChange(result.key)
          setApiKey('')
          setInfo('Clave guardada. El chat ya puede usar tu cuenta.')
        } else if (result?.status === 'error') {
          setError(result.message)
        }
      } catch {
        setError('No se pudo guardar la clave. Inténtalo de nuevo.')
      }
    })
  }

  function remove() {
    if (isPending) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setError(null)
    setInfo(null)
    startTransition(async () => {
      try {
        const result = await deleteLlmKey()
        if (result?.status === 'error') {
          setError(result.message)
          return
        }
        onStatusChange(null)
        setConfirmDelete(false)
        setInfo('Clave borrada.')
      } catch {
        setError('No se pudo borrar la clave. Inténtalo de nuevo.')
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
        aria-labelledby="titulo-ia"
        className="max-h-full w-full max-w-md overflow-y-auto rounded-xl border border-edge bg-card p-4 shadow-lg outline-none"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="titulo-ia" className="text-base font-semibold text-ink">
            IA · tu clave de API
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

        <p className="mb-3 text-sm text-ink-2">
          El chat funciona con tu propia clave de API (pago por uso contra tu cuenta del
          proveedor, no tu suscripción de ChatGPT Plus o Claude Pro). Se guarda cifrada y no se
          vuelve a mostrar.
        </p>

        {status && (
          <p className="mb-3 rounded-md border border-edge bg-page px-2.5 py-1.5 text-sm text-ink">
            Configurada: <strong>{providerLabel(status.provider)}</strong>
            <span className="tabular-nums text-ink-2"> · ····{status.last4}</span>
          </p>
        )}

        {error && (
          <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {info && (
          <p role="status" className="mb-2 text-sm text-ink-2">
            {info}
          </p>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
          className="space-y-4"
        >
          <fieldset className="space-y-1.5">
            <legend className="text-sm text-ink-2">Proveedor</legend>
            <div className="flex flex-wrap gap-2">
              {LLM_PROVIDERS.map((entry) => (
                <label key={entry.id} className={OPTION_CLASS}>
                  <input
                    type="radio"
                    name="provider"
                    value={entry.id}
                    checked={provider === entry.id}
                    onChange={() => setProvider(entry.id)}
                    disabled={isPending}
                    className="sr-only"
                  />
                  {entry.label}
                </label>
              ))}
            </div>
            {selected && <p className="text-xs text-ink-3">{selected.keyHint}</p>}
          </fieldset>

          <div className="space-y-1.5">
            <label htmlFor="llm-api-key" className="block text-sm text-ink-2">
              Clave de API
            </label>
            {/* type=password: la clave no debe quedar a la vista al pegarla */}
            <input
              id="llm-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={status ? 'Pega una clave nueva para reemplazarla' : 'sk-…'}
              autoComplete="off"
              disabled={isPending}
              className="w-full rounded-md border border-edge bg-page px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:outline-2 focus:outline-accent disabled:opacity-50"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="submit"
              disabled={isPending || apiKey.trim().length === 0}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:opacity-85 disabled:opacity-50"
            >
              {status ? 'Reemplazar clave' : 'Guardar clave'}
            </button>

            {status && (
              <button
                type="button"
                onClick={remove}
                disabled={isPending}
                className="rounded-md border border-edge px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-edge/40 disabled:opacity-50 dark:text-red-400"
              >
                {confirmDelete ? '¿Seguro? Borrar' : 'Borrar clave'}
              </button>
            )}
          </div>

          {isPending && <p className="text-xs text-ink-3">Guardando…</p>}
        </form>
      </div>
    </div>
  )
}
