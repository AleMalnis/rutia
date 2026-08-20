'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import {
  deleteLlmKey,
  listMcpGrants,
  revokeMcpGrant,
  saveLlmKey,
  type McpGrant,
} from '@/app/app/actions'
import { PanelTab } from '@/components/panel-tab'
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

// Solo se pinta tras cargar los grants en cliente: sin SSR no hay desajuste
// de hidratación por el huso o el idioma del navegador.
function formatGrantDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}

const OPTION_CLASS =
  'flex cursor-pointer items-center gap-1.5 rounded-md border border-edge px-2.5 py-1.5 text-sm text-ink has-checked:border-accent has-checked:bg-accent has-checked:text-accent-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent has-disabled:cursor-default has-disabled:opacity-60'

export function LlmSettingsDialog({
  status,
  mcpUrl,
  initialTab,
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
  /** Pestaña de apertura: el aviso del chat abre directo en «Conectores». */
  initialTab?: 'key' | 'connectors'
  onStatusChange: (status: LlmKeyStatusView | null) => void
  onClose: () => void
}) {
  const [provider, setProvider] = useState<LlmProviderId>(status?.provider ?? 'anthropic')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')
  // Las dos formas de usar el asistente, al mismo nivel: la clave propia o un
  // conector externo. Sin modo MCP desplegado no hay pestañas, solo la clave —
  // y por eso 'connectors' como apertura solo se honra si mcpUrl existe: sin
  // esa guarda, un initialTab imposible dejaría el diálogo en blanco.
  const [tab, setTab] = useState<'key' | 'connectors'>(
    initialTab === 'connectors' && mcpUrl != null ? 'connectors' : 'key',
  )
  const [isPending, startTransition] = useTransition()
  // Accesos concedidos del modo MCP (spec §12.9). null = aún sin pedir; la
  // carga es perezosa (al entrar en «Conectores») porque la mayoría abre este
  // diálogo solo para la clave y consultar grants es un viaje a GoTrue.
  const [grants, setGrants] = useState<McpGrant[] | null>(null)
  const [grantsError, setGrantsError] = useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)
  const [isRevokePending, startRevokeTransition] = useTransition()
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

  // Pide los accesos la primera vez que la pestaña «Conectores» está a la
  // vista (también cuando es la de apertura). «Reintentar» limpia el error y
  // este mismo efecto vuelve a disparar la consulta.
  useEffect(() => {
    if (tab !== 'connectors' || mcpUrl == null || grants !== null || grantsError !== null) return
    let cancelled = false
    ;(async () => {
      try {
        const result = await listMcpGrants()
        if (cancelled) return
        if (result.status === 'ok') setGrants(result.grants)
        else setGrantsError(result.message)
      } catch {
        if (!cancelled) setGrantsError('No se pudieron consultar los accesos. Vuelve a intentarlo.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tab, mcpUrl, grants, grantsError])

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

  function selectTab(next: 'key' | 'connectors') {
    setTab(next)
    // cambiar de vista rompe el contexto de la confirmación en dos pasos:
    // volver minutos después y encontrar «¿Seguro? Borrar» armado convertiría
    // el segundo clic consciente en uno accidental
    setConfirmDelete(false)
    setConfirmRevoke(null)
  }

  function revoke(clientId: string) {
    if (isRevokePending) return
    if (confirmRevoke !== clientId) {
      // dos pasos, como «Borrar clave»: el primer clic arma, el segundo revoca
      setConfirmRevoke(clientId)
      return
    }
    setGrantsError(null)
    startRevokeTransition(async () => {
      try {
        const result = await revokeMcpGrant(clientId)
        if (result.status === 'ok') {
          setGrants(result.grants)
          setConfirmRevoke(null)
        } else if (result.status === 'stale') {
          // revocado de verdad, pero la recarga falló: invalidar la lista
          // (dejar el grant pintado invitaría a re-revocar lo ya revocado) y
          // ofrecer el «Reintentar», que solo repite la consulta
          setGrants(null)
          setConfirmRevoke(null)
          setGrantsError(result.message)
        } else {
          setGrantsError(result.message)
        }
      } catch {
        setGrantsError('No se pudo revocar el acceso. Vuelve a intentarlo.')
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

        {/* sin MCP_RESOURCE_URL no hay pestañas: contarle a un usuario final
            que existe algo que su despliegue no ofrece solo estorba */}
        {mcpUrl != null && (
          <div className="mb-4 flex gap-1 rounded-lg bg-edge/40 p-1">
            {/* bloqueadas durante el guardado, como Escape y «Cerrar»: cambiar
                de vista desmontaría el aviso de error y se perdería sin verse */}
            <PanelTab active={tab === 'key'} disabled={isPending} onClick={() => selectTab('key')}>
              Clave de API
            </PanelTab>
            <PanelTab
              active={tab === 'connectors'}
              disabled={isPending}
              onClick={() => selectTab('connectors')}
            >
              Conectores
            </PanelTab>
          </div>
        )}

        {(mcpUrl == null || tab === 'key') && (
          <>
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
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_85%,var(--accent-ink))] disabled:opacity-50"
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
          </>
        )}

        {/* La guía de activación del modo MCP va en el README, que es para
            quien despliega; aquí solo se enseña lo que este despliegue ofrece. */}
        {mcpUrl != null && tab === 'connectors' && (
          <section>
            <h3 className="text-sm font-semibold text-ink">Conectar otra aplicación (MCP)</h3>
            <p className="mt-1 text-sm text-ink-2">
              La otra forma de usar el asistente, sin pegar ninguna clave aquí: conectas RutIA a
              tu aplicación de IA y gestionas la rutina desde ahí, con la suscripción que ya
              pagas. Cada una lo activa a su manera.
            </p>

            {/* Un bloque por cliente y no una URL genérica: lo que cada uno
                necesita es distinto de verdad (spec §6.5), y prometer paridad
                era la parte que no se entendía. */}
            <div className="mt-4 border-t border-edge/60 pt-3">
              <h4 className="text-sm font-medium text-ink">Claude</h4>
              <a
                href={claudeConnectUrl(mcpUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-block rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_85%,var(--accent-ink))] active:translate-y-px"
              >
                Conectar con Claude
              </a>
              <p className="mt-1 text-xs text-ink-3">
                Abre el diálogo de Claude con la URL ya puesta. Confirmar y autorizar sigue
                siendo cosa tuya.
              </p>
            </div>

            <div className="mt-4 border-t border-edge/60 pt-3">
              <h4 className="text-sm font-medium text-ink">ChatGPT</h4>
              <p className="mt-1 text-xs leading-5 text-ink-3">
                Hace falta activar el modo desarrollador, y solo funciona en{' '}
                <strong className="font-semibold text-ink-2">ChatGPT web</strong> (no en la app
                del móvil), con plan Plus, Pro, Business, Enterprise o Edu. En cuentas de empresa
                puede que un administrador tenga que permitirlo antes.
              </p>
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-xs leading-5 text-ink-3">
                <li>Ajustes → Apps → Ajustes avanzados → activa «Modo desarrollador».</li>
                <li>En Apps, añade un conector nuevo y pega la URL de abajo.</li>
                <li>Autoriza en la pantalla de consentimiento de RutIA.</li>
              </ol>
            </div>

            <div className="mt-4 border-t border-edge/60 pt-3">
              <h4 className="text-sm font-medium text-ink">Gemini</h4>
              <p className="mt-1 text-xs leading-5 text-ink-3">
                La app de Gemini <strong className="font-semibold text-ink-2">no admite</strong>{' '}
                conectores MCP propios en su chat normal: hoy solo los acepta dentro de tareas de
                Spark, o en Gemini Enterprise. Si usas <strong className="font-semibold text-ink-2">Gemini
                CLI</strong>, sí puedes añadir RutIA con la URL de abajo en su fichero de
                configuración. Para el chat de Gemini a secas, usa el chat de esta pantalla con tu
                clave de API de Google.
              </p>
            </div>

            <div className="mt-4 space-y-1.5 border-t border-edge/60 pt-3">
              <label htmlFor="mcp-url" className="block text-sm text-ink-2">
                La URL de tu servidor MCP
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

            {/* Accesos concedidos (spec §12.9): la otra mitad del control —
                autorizar sin poder revocar no es control */}
            <div className="mt-4 border-t border-edge/60 pt-3">
              <h4 className="text-sm font-medium text-ink">Accesos concedidos</h4>
              {grants === null && grantsError === null && (
                <p className="mt-1 text-xs text-ink-3">Consultando accesos…</p>
              )}
              {grantsError !== null && (
                <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {grantsError}{' '}
                  {grants === null && (
                    <button type="button" onClick={() => setGrantsError(null)} className="underline">
                      Reintentar
                    </button>
                  )}
                </p>
              )}
              {grants !== null && grants.length === 0 && (
                <p className="mt-1 text-xs text-ink-3">
                  Ninguna aplicación tiene acceso ahora mismo.
                </p>
              )}
              {grants !== null && grants.length > 0 && (
                <>
                  <ul className="mt-1.5 space-y-1.5">
                    {grants.map((grant) => (
                      <li key={grant.clientId} className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-ink">{grant.clientName}</p>
                          <p className="text-xs text-ink-3">
                            desde el {formatGrantDate(grant.grantedAt)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => revoke(grant.clientId)}
                          disabled={isRevokePending}
                          className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950"
                        >
                          {isRevokePending && confirmRevoke === grant.clientId
                            ? 'Revocando…'
                            : confirmRevoke === grant.clientId
                              ? '¿Seguro? Revocar'
                              : 'Revocar'}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-xs text-ink-3">
                    Al revocar se invalidan las sesiones de la aplicación y sus tokens de
                    renovación: no puede volver a entrar. Un token de acceso ya emitido puede
                    seguir valiendo hasta una hora, hasta que caduque.
                  </p>
                </>
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
