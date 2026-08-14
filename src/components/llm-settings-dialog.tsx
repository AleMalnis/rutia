'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { deleteLlmKey, saveLlmKey } from '@/app/app/actions'
import {
  LLM_PROVIDERS,
  providerLabel,
  type LlmKeyStatusView,
  type LlmProviderId,
} from '@/lib/llm-providers'
import { claudeConnectUrl } from '@/lib/mcp/connect'

// Ajustes → IA (BYOK, spec §6.4): el usuario elige proveedor y pega su clave
// de API. La clave viaja UNA vez al servidor, se cifra y no vuelve jamás:
// aquí solo se pinta el proveedor y los últimos 4 caracteres.
//
// El modo MCP (§6.5) vive en este mismo diálogo y no en un botón aparte porque
// es la ALTERNATIVA a pegar la clave: quien llega aquí sin clave —el chat le
// manda— tiene que ver las dos formas de usar el asistente, no solo una.

const OPTION_CLASS =
  'flex cursor-pointer items-center gap-1.5 rounded-md border border-edge px-2.5 py-1.5 text-sm text-ink has-checked:border-accent has-checked:bg-accent has-checked:text-accent-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent has-disabled:cursor-default has-disabled:opacity-60'

export function LlmSettingsDialog({
  status,
  mcpUrl,
  onStatusChange,
  onClose,
}: {
  status: LlmKeyStatusView | null
  /**
   * URL del servidor MCP de este despliegue, o null si no está configurado.
   * Se recibe como prop porque `MCP_RESOURCE_URL` es solo de servidor: leerla
   * aquí daría null siempre.
   */
  mcpUrl: string | null
  onStatusChange: (status: LlmKeyStatusView | null) => void
  onClose: () => void
}) {
  const [provider, setProvider] = useState<LlmProviderId>(status?.provider ?? 'anthropic')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')
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

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopyState('ok')
    } catch {
      // sin portapapeles (contexto no seguro o permiso denegado) queda el
      // camino manual: el campo es seleccionable y se autoselecciona al foco
      setCopyState('fail')
    }
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
            IA · clave y conectores
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

        <h3 className="mb-1 text-sm font-semibold text-ink">Tu clave de API</h3>
        <p className="mb-3 text-sm text-ink-2">
          El chat de esta pantalla funciona con tu propia clave de API (pago por uso contra tu
          cuenta del proveedor, no tu suscripción de ChatGPT Plus o Claude Pro). Se guarda cifrada
          y no se vuelve a mostrar.
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

        {/* Sin MCP_RESOURCE_URL el modo MCP no está desplegado, así que la
            sección no se pinta: contarle a un usuario final que existe algo
            que no puede usar solo estorba. La guía de activación va en el
            README, que es para quien despliega. */}
        {mcpUrl != null && (
          <section className="mt-5 border-t border-edge pt-4">
            <h3 className="text-sm font-semibold text-ink">Conectar otra aplicación (MCP)</h3>
            <p className="mt-1 text-sm text-ink-2">
              La otra forma de usar el asistente, sin pegar ninguna clave aquí: conectas RutIA a
              Claude, ChatGPT o tu editor de código y gestionas la rutina desde ahí, con la
              suscripción que ya pagas en esa aplicación.
            </p>

            <a
              href={claudeConnectUrl(mcpUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:opacity-85"
            >
              Conectar con Claude
            </a>
            <p className="mt-1 text-xs text-ink-3">
              Abre el diálogo de Claude con la URL ya puesta. Confirmar y autorizar sigue siendo
              cosa tuya.
            </p>

            <div className="mt-3 space-y-1.5">
              <label htmlFor="mcp-url" className="block text-sm text-ink-2">
                Para ChatGPT o tu editor, pega esta URL
              </label>
              <div className="flex gap-2">
                {/* readOnly y no disabled: un campo deshabilitado no se puede
                    seleccionar, y seleccionar a mano es el respaldo cuando el
                    portapapeles no está disponible */}
                <input
                  id="mcp-url"
                  type="text"
                  value={mcpUrl}
                  readOnly
                  onFocus={(event) => event.target.select()}
                  className="w-full rounded-md border border-edge bg-page px-2.5 py-1.5 text-sm text-ink focus:outline-2 focus:outline-accent"
                />
                <button
                  type="button"
                  onClick={() => copyUrl(mcpUrl)}
                  className="shrink-0 rounded-md border border-edge px-3 py-1.5 text-sm font-medium text-ink hover:bg-edge/40"
                >
                  Copiar
                </button>
              </div>
              {copyState !== 'idle' && (
                <p role="status" className="text-xs text-ink-3">
                  {copyState === 'ok'
                    ? 'URL copiada.'
                    : 'No se pudo copiar. Selecciona la URL y cópiala a mano.'}
                </p>
              )}
            </div>

            <p className="mt-3 text-xs text-ink-3">
              Autoriza solo aplicaciones en las que confíes: el acceso que concedes llega hasta
              donde llega tu propia sesión, no solo a tu rutina.{' '}
              <a
                href="/legal/privacidad"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Qué implica exactamente
              </a>
              .
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
