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
  onMutated,
}: {
  initialMessages: ChatUiMessage[]
  routineEmpty: boolean
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

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      const payload = (await response.json().catch(() => null)) as ChatApiPayload | null

      if (!response.ok || typeof payload?.reply !== 'string') {
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
          placeholder="Escribe a RutIA…"
          aria-label="Mensaje para RutIA"
          className="min-h-9 flex-1 resize-y rounded-md border border-edge bg-page px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:outline-2 focus:outline-accent"
        />
        <button
          type="submit"
          disabled={pending || draft.trim().length === 0}
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
