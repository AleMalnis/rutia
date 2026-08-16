'use client'

import { useEffect, useRef, useState } from 'react'

// Chat con RutIA (spec §6, Must #5-#8): la UI solo habla con /api/chat; el
// bucle agéntico y las escrituras viven en el servidor. Tras un cambio en la
// rutina, el padre refresca el calendario y resalta los ítems afectados.

export type ChatUiMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

type ChatApiPayload = {
  reply?: unknown
  affectedItemIds?: unknown
  mutated?: unknown
  error?: unknown
}

export function ChatPanel({
  initialMessages,
  routineEmpty,
  llmConfigured,
  mcpAvailable,
  onOpenSettings,
  onMutated,
}: {
  initialMessages: ChatUiMessage[]
  routineEmpty: boolean
  /** BYOK (spec §6.4): sin clave propia configurada el chat no funciona. */
  llmConfigured: boolean
  /** Si este despliegue ofrece el modo MCP: el aviso sin clave lo menciona. */
  mcpAvailable: boolean
  /** Abre Ajustes → IA, opcionalmente directo en una pestaña concreta. */
  onOpenSettings: (tab?: 'key' | 'connectors') => void
  onMutated: (affectedItemIds: string[]) => void
}) {
  const [messages, setMessages] = useState<ChatUiMessage[]>(initialMessages)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  // el último mensaje siempre a la vista, también mientras «escribe»
  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages, pending])

  async function send() {
    const message = draft.trim()
    if (message.length === 0 || pending) return
    setDraft('')
    setError(null)
    setPending(true)
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: message }])

    // Si algo falla, el texto vuelve al cuadro: reescribir hasta 2000
    // caracteres es inaceptable. La burbuja optimista SÍ se queda, porque en
    // los fallos más habituales (clave rechazada, sin crédito, proveedor
    // caído) el servidor ya guardó el mensaje antes de llamar al modelo, y
    // quitarla mentiría en la dirección contraria.
    const restoreDraft = () => setDraft((current) => (current.length === 0 ? message : current))

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      const payload = (await response.json().catch(() => null)) as ChatApiPayload | null

      if (!response.ok || typeof payload?.reply !== 'string') {
        restoreDraft()
        setError(
          typeof payload?.error === 'string'
            ? payload.error
            : 'Algo ha ido mal. Vuelve a intentarlo.',
        )
        return
      }

      const reply = payload.reply
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: reply }])
      if (payload.mutated === true) {
        onMutated(
          Array.isArray(payload.affectedItemIds)
            ? payload.affectedItemIds.filter((id): id is string => typeof id === 'string')
            : [],
        )
      }
    } catch {
      restoreDraft()
      setError('No se ha podido contactar con el servidor. Revisa tu conexión.')
    } finally {
      setPending(false)
    }
  }

  // Onboarding (Must #8): saludo local, no persistido, cuando no hay nada aún
  const greeting =
    messages.length > 0
      ? null
      : routineEmpty
        ? '¡Hola! Soy RutIA. Todavía no tienes rutina: cuéntame cómo es tu semana (trabajo, comidas, medicación, deporte…) y te la monto en un momento.'
        : 'Cuéntame qué quieres cambiar de tu rutina, o pregúntame qué te toca hoy.'

  return (
    <section
      aria-label="Chat con RutIA"
      className="flex flex-col gap-2 rounded-xl border border-edge bg-card p-3"
    >
      {/* role=log: los mensajes nuevos se anuncian sin robar el foco */}
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        className="flex h-80 flex-col gap-2 overflow-y-auto pr-1"
      >
        {greeting && <Bubble role="assistant" content={greeting} />}
        {messages.map((message) => (
          <Bubble key={message.id} role={message.role} content={message.content} />
        ))}
        {pending && (
          <p className="self-start rounded-lg bg-edge/40 px-2.5 py-1.5 text-sm text-ink-3">
            <span aria-hidden>…</span>
            <span className="sr-only">RutIA está escribiendo</span>
          </p>
        )}

        {/* BYOK: sin clave configurada, el chat explica los dos caminos que
            da la spec §6.4 —pegar una clave propia en Ajustes → IA o el modo
            MCP— y lleva a Ajustes. El de MCP solo si el despliegue lo ofrece. */}
        {!llmConfigured && (
          <div className="self-start rounded-lg border border-edge bg-page px-2.5 py-2 text-sm text-ink">
            <p>
              Para chatear aquí necesito tu propia clave de API (Anthropic, OpenAI o Google): la
              inferencia corre por tu cuenta, de pago por uso.
            </p>
            {mcpAvailable && (
              <p className="mt-1.5">
                Si prefieres no pegar ninguna clave, también puedes gestionar tu rutina desde
                Claude o ChatGPT conectando RutIA.
              </p>
            )}
            {/* cada camino lleva a SU pestaña: prometer «Conectores» y abrir
                la de la clave obligaría al usuario a buscarla él */}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onOpenSettings('key')}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:opacity-85"
              >
                Configurar clave
              </button>
              {mcpAvailable && (
                <button
                  type="button"
                  onClick={() => onOpenSettings('connectors')}
                  className="rounded-md border border-edge px-3 py-1.5 text-sm font-medium text-ink hover:bg-edge/40"
                >
                  Ver conectores
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter envía; Shift+Enter hace salto de línea (dictar la dieta
            // de la semana necesita párrafos)
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
          rows={2}
          maxLength={2000}
          placeholder={llmConfigured ? 'Escribe a RutIA…' : 'Configura tu clave de API para chatear'}
          aria-label="Mensaje para RutIA"
          disabled={!llmConfigured}
          className="min-h-9 flex-1 resize-y rounded-md border border-edge bg-page px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:outline-2 focus:outline-accent disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending || !llmConfigured || draft.trim().length === 0}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:opacity-85 disabled:opacity-50"
        >
          Enviar
        </button>
      </form>
    </section>
  )
}

function Bubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  if (role === 'user') {
    return (
      <p className="max-w-[85%] self-end whitespace-pre-wrap rounded-lg bg-accent px-2.5 py-1.5 text-sm text-accent-ink">
        {content}
      </p>
    )
  }
  return (
    <p className="max-w-[85%] self-start whitespace-pre-wrap rounded-lg bg-edge/40 px-2.5 py-1.5 text-sm text-ink">
      {content}
    </p>
  )
}
