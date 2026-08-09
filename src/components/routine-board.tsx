'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { AppearanceDialog } from '@/components/appearance-dialog'
import { CategoryLegend } from '@/components/category-legend'
import { CategoryManagerDialog } from '@/components/category-manager-dialog'
import { ChatPanel, type ChatUiMessage } from '@/components/chat-panel'
import { ItemFormDialog } from '@/components/item-form-dialog'
import { LlmSettingsDialog } from '@/components/llm-settings-dialog'
import { TodayPanel, type TodayEntry } from '@/components/today-panel'
import { WeekCalendar } from '@/components/week-calendar'
import type { Appearance } from '@/lib/appearance'
import type { LlmKeyStatusView } from '@/lib/llm-providers'
import type { Category, RoutineItem } from '@/lib/schemas'

// Dueño del estado de los diálogos: el calendario y la leyenda son
// presentación pura y las escrituras van por server actions.
type Dialog =
  | { type: 'item'; item: RoutineItem | null }
  | { type: 'categories' }
  | { type: 'appearance' }
  | { type: 'ia' }
  | null

export function RoutineBoard({
  items,
  categories,
  todayEntries,
  todayWeekday,
  todayDate,
  appearance,
  chatMessages,
  llmStatus: initialLlmStatus,
  children,
}: {
  items: RoutineItem[]
  categories: Category[]
  todayEntries: TodayEntry[]
  todayWeekday: number
  todayDate: string
  appearance: Appearance
  chatMessages: ChatUiMessage[]
  llmStatus: LlmKeyStatusView | null
  // la cabecera de la página se recibe como slot para que quede DENTRO del
  // contenedor inert: si no, con el diálogo abierto se puede tabular hasta
  // «Cerrar sesión» y cerrar sesión perdiendo lo que se estaba editando
  children?: React.ReactNode
}) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const router = useRouter()

  // Sin rutina, el chat delante: es la puerta de entrada del onboarding
  // (Must #8); con rutina, el panel «Hoy» sigue siendo la vista principal.
  const [tab, setTab] = useState<'today' | 'chat'>(items.length === 0 ? 'chat' : 'today')

  // Estado de la clave BYOK (spec §6.4): el diálogo lo actualiza al guardar o
  // borrar, sin recargar la página.
  const [llmStatus, setLlmStatus] = useState<LlmKeyStatusView | null>(initialLlmStatus)

  // Ítems recién tocados por el agente (Must #6): se resaltan ~2 s en el
  // calendario tras refrescar los datos.
  const [highlightIds, setHighlightIds] = useState<ReadonlySet<string>>(new Set())

  function handleAgentMutation(affectedItemIds: string[]) {
    router.refresh()
    setHighlightIds(new Set(affectedItemIds))
  }

  // La cuenta atrás se reinicia cuando llegan los ítems refrescados, no al
  // pedir el refresco: `router.refresh()` es asíncrono y no devuelve promesa,
  // así que con una conexión lenta el resaltado se apagaría antes de que el
  // ítem nuevo llegue siquiera a pintarse.
  useEffect(() => {
    if (highlightIds.size === 0) return
    const timer = window.setTimeout(() => setHighlightIds(new Set()), 2500)
    return () => window.clearTimeout(timer)
  }, [items, highlightIds])

  // El disparador se captura AQUÍ, en el clic: cuando el diálogo monta, el
  // fondo ya es inert y el navegador ha movido el foco a body, así que un
  // efecto dentro del diálogo solo podría guardar body y la restauración no
  // devolvería al usuario a su sitio.
  const trigger = useRef<HTMLElement | null>(null)
  const restorePending = useRef(false)

  function open(next: NonNullable<Dialog>) {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setDialog(next)
  }

  function close() {
    // Solo se marca: enfocar aquí no serviría de nada porque React todavía no
    // ha quitado el `inert` del fondo y un elemento inerte no acepta el foco.
    restorePending.current = true
    setDialog(null)
  }

  // Ya con el DOM actualizado (y el `inert` retirado), el foco vuelve al
  // control que abrió el diálogo.
  useEffect(() => {
    if (dialog == null && restorePending.current) {
      restorePending.current = false
      trigger.current?.focus()
    }
  }, [dialog])

  const openItem = (item: RoutineItem | null) => open({ type: 'item', item })

  return (
    <>
      {/* inert mientras hay un diálogo abierto: sin esto se puede tabular
          hasta las tarjetas del calendario que quedan detrás del velo y
          abrir otro ítem, perdiendo lo que se estaba editando */}
      <div className="flex flex-1 flex-col gap-4" inert={dialog != null}>
        {children}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* «Categorías» abre el gestor y va junto a la leyenda que gobierna */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={() => open({ type: 'categories' })}
              className="rounded-md border border-edge bg-card px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-edge/40"
            >
              Categorías
            </button>
            <CategoryLegend categories={categories} />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => open({ type: 'ia' })}
              className="rounded-md border border-edge bg-card px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-edge/40"
            >
              IA
            </button>
            <button
              type="button"
              onClick={() => open({ type: 'appearance' })}
              className="rounded-md border border-edge bg-card px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-edge/40"
            >
              Apariencia
            </button>
            <button
              type="button"
              onClick={() => openItem(null)}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:opacity-85"
            >
              Nuevo ítem
            </button>
          </div>
        </div>

        {/* «Hoy» va primero en el DOM porque en móvil es la vista principal
            (spec §4): así el orden de lectura y de tabulación coincide con lo
            que se ve. Solo en escritorio pasa a la columna derecha. */}
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_20rem] lg:items-start">
          <div className="flex flex-col gap-2 lg:order-2">
            {/* Ambos paneles quedan montados y se alternan con hidden: así el
                chat no pierde la conversación al mirar «Hoy», y el panel
                «Hoy» sigue reportando la zona horaria del navegador. */}
            <div className="flex gap-1 rounded-lg border border-edge bg-card p-1">
              <PanelTab active={tab === 'chat'} onClick={() => setTab('chat')}>
                Chat
              </PanelTab>
              <PanelTab active={tab === 'today'} onClick={() => setTab('today')}>
                Hoy
              </PanelTab>
            </div>

            <div hidden={tab !== 'chat'}>
              <ChatPanel
                initialMessages={chatMessages}
                routineEmpty={items.length === 0}
                llmConfigured={llmStatus != null}
                onOpenSettings={() => open({ type: 'ia' })}
                onMutated={handleAgentMutation}
              />
            </div>
            <div hidden={tab !== 'today'}>
              <TodayPanel
                entries={todayEntries}
                weekday={todayWeekday}
                date={todayDate}
                categories={categories}
                onItemClick={openItem}
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-edge bg-card lg:order-1">
            <WeekCalendar
              items={items}
              categories={categories}
              highlightIds={highlightIds}
              onItemClick={openItem}
            />
          </div>
        </div>

        {items.length === 0 && (
          <p className="text-sm text-ink-3">
            Tu rutina está vacía. Pulsa «Nuevo ítem» para empezar.
          </p>
        )}
      </div>

      {dialog?.type === 'item' && (
        <ItemFormDialog
          // remonta el formulario al cambiar de ítem: los defaultValue de los
          // campos no controlados no se refrescan solos
          key={dialog.item?.id ?? 'nuevo'}
          item={dialog.item}
          categories={categories}
          onClose={close}
        />
      )}

      {dialog?.type === 'categories' && (
        <CategoryManagerDialog categories={categories} onClose={close} />
      )}

      {dialog?.type === 'appearance' && (
        <AppearanceDialog appearance={appearance} onClose={close} />
      )}

      {dialog?.type === 'ia' && (
        <LlmSettingsDialog status={llmStatus} onStatusChange={setLlmStatus} onClose={close} />
      )}
    </>
  )
}

// Alternador simple con aria-pressed: dos vistas del mismo panel lateral. No
// se usa el patrón ARIA de tabs porque exige navegación con flechas que aquí
// no aporta nada con solo dos opciones.
function PanelTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex-1 rounded-md px-3 py-1 text-sm font-medium transition-colors ${
        active ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:bg-edge/40'
      }`}
    >
      {children}
    </button>
  )
}
