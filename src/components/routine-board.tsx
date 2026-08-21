'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AppearanceDialog } from '@/components/appearance-dialog'
import { CategoryLegend } from '@/components/category-legend'
import { CategoryManagerDialog } from '@/components/category-manager-dialog'
import { ChatPanel, type ChatUiMessage } from '@/components/chat-panel'
import { DeleteAccountDialog } from '@/components/delete-account-dialog'
import { ExportButton } from '@/components/export-button'
import { ItemFormDialog } from '@/components/item-form-dialog'
import { LlmSettingsDialog } from '@/components/llm-settings-dialog'
import { PanelTab } from '@/components/panel-tab'
import { TodayPanel, type TodayEntry } from '@/components/today-panel'
import { WeekCalendar } from '@/components/week-calendar'
import type { Appearance } from '@/lib/appearance'
import { isIos, isStandalone } from '@/lib/platform'
import type { LlmKeyStatusView } from '@/lib/llm-providers'
import type { Category, RoutineItem } from '@/lib/schemas'

// Callbacks estables para useSyncExternalStore (como en install-hint): un
// subscribe nuevo por render forzaría re-suscripciones inútiles.
const subscribeToNothing = () => () => {}
const isIosStandalone = () => isIos() && isStandalone()
const serverSaysNo = () => false

// Dueño del estado de los diálogos: el calendario y la leyenda son
// presentación pura y las escrituras van por server actions.
type Dialog =
  | { type: 'item'; item: RoutineItem | null }
  | { type: 'categories' }
  | { type: 'appearance' }
  | { type: 'ia'; tab?: 'key' | 'connectors' }
  | { type: 'delete-account' }
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
  mcpUrl,
  vapidPublicKey,
  identity,
  sessionAction,
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
  /** URL del servidor MCP, o null si este despliegue no lo tiene activado. */
  mcpUrl: string | null
  /** Clave pública VAPID, o null si los avisos push no están configurados. */
  vapidPublicKey: string | null
  /**
   * Identidad de la cabecera (marca + fecha). Viene de la página porque ahí
   * están el correo y la fecha del servidor; el tablero la compone con el
   * cúmulo de utilidades, que necesita su estado de diálogos (spec §4).
   */
  identity: React.ReactNode
  /** El formulario de cerrar sesión: es una server action de la página. */
  sessionAction: React.ReactNode
  // contenido previo a la cabecera (el aviso de instalación). Todo dentro del
  // contenedor inert: si no, con el diálogo abierto se puede tabular hasta
  // «Cerrar sesión» y cerrar sesión perdiendo lo que se estaba editando
  children?: React.ReactNode
}) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const router = useRouter()

  // Dato solo-cliente con el patrón de siempre (hidrata sin desajuste): en la
  // web app instalada de iOS la descarga con Content-Disposition no funciona
  // y el pie debe ofrecer instrucciones en vez del enlace.
  const iosStandalone = useSyncExternalStore(subscribeToNothing, isIosStandalone, serverSaysNo)

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
  // Respaldo del foco: el «Nuevo ítem» del estado vacío se DESMONTA al guardar
  // el primer ítem (la capa desaparece con items.length), así que devolver el
  // foco a su disparador enfocaría un nodo desconectado y caería a <body>. El
  // botón de la barra siempre está, y es el equivalente más cercano.
  const newItemButton = useRef<HTMLButtonElement>(null)

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
      const target = trigger.current?.isConnected ? trigger.current : newItemButton.current
      target?.focus()
    }
  }, [dialog])

  const openItem = (item: RoutineItem | null) => open({ type: 'item', item })

  // El CTA del estado vacío tiene que LLEVAR al chat, no solo seleccionarlo:
  // con la rutina vacía `tab` ya vale 'chat' (línea de arriba), así que un
  // setTab suelto no cambiaría nada y el botón parecería roto. Y en móvil el
  // panel queda por encima de los 864 px de rejilla, fuera de pantalla.
  // No se enfoca el campo del chat a propósito: sin clave BYOK está
  // deshabilitado —justo el caso del usuario nuevo— y enfocarlo sería otro
  // no-op silencioso.
  const chatColumn = useRef<HTMLDivElement>(null)

  function goToChat() {
    setTab('chat')
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    chatColumn.current?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    })
  }

  return (
    <>
      {/* inert mientras hay un diálogo abierto: sin esto se puede tabular
          hasta las tarjetas del calendario que quedan detrás del velo y
          abrir otro ítem, perdiendo lo que se estaba editando */}
      <div className="flex flex-1 flex-col gap-5 md:gap-6" inert={dialog != null}>
        {/* App bar (spec §4, tanda 3): pegajosa con desenfoque para que el
            contenido se deslice POR DEBAJO al hacer scroll — la oclusión en
            movimiento es la señal de profundidad más fuerte. Los márgenes
            negativos la llevan a sangre sobre el padding del main, y por eso
            va PRIMERA: con algo delante, el -mt se comería ese hueco en vez
            del padding. z-40: sobre el estado vacío (30) y la franja de horas
            (20), bajo los diálogos (50).
            Pegajosa solo desde sm: en un móvil envuelve en dos filas y son
            ~105 px (16 % de la pantalla) confiscados durante todo el scroll;
            ahí se desplaza con el contenido y el calendario recupera el alto. */}
        <header className="-mx-4 -mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-edge/60 bg-page/80 px-4 py-3 backdrop-blur sm:sticky sm:top-0 sm:z-40 md:-mx-6 md:-mt-6 md:px-6 print:static print:border-0 print:bg-transparent print:backdrop-blur-none">
          {identity}
          {/* Cúmulo de utilidades, arriba a la derecha como toda app: ajustes
              de app (IA, Apariencia) y, tras el separador, la sesión. Son
              terciarias: fantasma, sin competir con el contenido.
              `ml-auto` porque `justify-between` se resuelve POR LÍNEA: al
              envolver, una línea con un solo elemento lo alinea a la
              izquierda y los ajustes acababan bajo la fecha, leyéndose como
              parte de ella. */}
          <div className="ml-auto flex items-center gap-1 print:hidden">
            <button
              type="button"
              onClick={() => open({ type: 'ia' })}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:bg-edge/40 hover:text-ink active:translate-y-px"
            >
              IA
            </button>
            <button
              type="button"
              onClick={() => open({ type: 'appearance' })}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:bg-edge/40 hover:text-ink active:translate-y-px"
            >
              Apariencia
            </button>
            <span aria-hidden className="mx-1 h-4 w-px bg-edge" />
            {sessionAction}
          </div>
        </header>

        {children}

        {/* Barra de contenido (spec §4, tanda 3): las acciones que tocan la
            rutina viven JUNTAS y junto a lo que gobiernan — antes «Nuevo
            ítem» convivía con los ajustes y «Categorías» estaba en la otra
            punta, agrupación por azar que la ley de proximidad castiga.
            Al imprimir, los botones sobran y la leyenda se queda: es parte de
            la lámina de papel (título + leyenda + semana, spec §4). */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-2 print:hidden">
            <button
              ref={newItemButton}
              type="button"
              onClick={() => openItem(null)}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink shadow-[var(--shadow-card)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_85%,var(--accent-ink))] active:translate-y-px"
            >
              Nuevo ítem
            </button>
            <button
              type="button"
              onClick={() => open({ type: 'categories' })}
              className="rounded-md border border-edge bg-card px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-edge/40 active:translate-y-px"
            >
              Categorías
            </button>
            <ExportButton
              items={items}
              categories={categories}
              date={todayDate}
              weekday={todayWeekday}
              theme={appearance.theme}
            />
          </div>
          <CategoryLegend categories={categories} />
        </div>

        {/* «Hoy» va primero en el DOM porque en móvil es la vista principal
            (spec §4): así el orden de lectura y de tabulación coincide con lo
            que se ve. Solo en escritorio pasa a la columna derecha. */}
        <div className="flex flex-col gap-5 md:gap-6 lg:grid lg:grid-cols-[1fr_20rem] lg:items-start">
          {/* scroll-mt donde la app bar es pegajosa: sin él, `scrollIntoView`
              alinea el borde de la columna con el borde del scrollport, que es
              exactamente donde vive la barra — el conmutador Chat/Hoy quedaba
              tapado del todo y sus clics los capturaba la barra. */}
          <div ref={chatColumn} className="flex flex-col gap-2 sm:scroll-mt-20 lg:order-2 print:hidden">
            {/* Ambos paneles quedan montados y se alternan con hidden: así el
                chat no pierde la conversación al mirar «Hoy», y el panel
                «Hoy» sigue reportando la zona horaria del navegador. */}
            {/* control segmentado hundido, no otra tarjeta: el chrome se
                diferencia del contenido (spec §4) */}
            <div className="flex gap-1 rounded-lg bg-edge/40 p-1">
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
                mcpAvailable={mcpUrl != null}
                onOpenSettings={(tab) => open({ type: 'ia', tab })}
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
                vapidPublicKey={vapidPublicKey}
              />
            </div>
          </div>

          {/* sombra en vez de borde pleno (spec §4): la superficie grande se
              separa por elevación; el borde queda rebajado como refuerzo */}
          <div className="relative overflow-hidden rounded-xl border border-edge/60 bg-card shadow-[var(--shadow-card)] lg:order-1 print:border-0 print:shadow-none">
            <WeekCalendar
              items={items}
              categories={categories}
              todayWeekday={todayWeekday}
              highlightIds={highlightIds}
              onItemClick={openItem}
            />

            {/* Estado vacío SOBRE la rejilla (spec §4): antes era una línea
                gris debajo de 864 px de cuadrícula desierta, la pantalla que
                más se juzga. `pointer-events-none` en la capa para no capturar
                el desplazamiento horizontal del calendario en móvil; los
                botones lo recuperan. */}
            {items.length === 0 && (
              <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-card/80 p-4 print:hidden">
                <div className="flex max-w-xs flex-col items-center gap-3 text-center">
                  <p className="text-base font-semibold text-ink">Tu semana está en blanco</p>
                  <p className="text-sm text-ink-3">
                    Cuéntale tu rutina al asistente y la coloca por ti, o añade el primer ítem a
                    mano.
                  </p>
                  <div className="pointer-events-auto flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={goToChat}
                      className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_85%,var(--accent-ink))]"
                    >
                      Contárselo al chat
                    </button>
                    <button
                      type="button"
                      onClick={() => openItem(null)}
                      className="rounded-md border border-edge bg-card px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-edge/40"
                    >
                      Nuevo ítem
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* los legales al pie (spec §4): la cabecera es la posición de máxima
            jerarquía y esto es lo de menor uso. Dentro del contenedor inert,
            como el resto, para quedar cubiertos cuando hay un diálogo. */}
        <footer className="flex flex-wrap gap-4 text-xs text-ink-3 print:hidden">
          <Link href="/legal/privacidad" className="underline hover:text-ink-2">
            Privacidad
          </Link>
          <Link href="/legal/terminos" className="underline hover:text-ink-2">
            Términos
          </Link>
          {/* portabilidad RGPD (spec §12.13): un <a> normal — el servidor pone
              el Content-Disposition y el navegador gestiona la descarga. En la
              web app instalada de iOS no hay gestor de descargas y el toque
              acaba en una pantalla trampa, así que ahí se dan instrucciones
              en vez de un enlace que parece roto. */}
          {iosStandalone ? (
            <span>Para descargar tus datos, abre RutIA en Safari: la app instalada no puede guardar ficheros</span>
          ) : (
            <a href="/api/export" className="underline hover:text-ink-2">
              Descargar mis datos
            </a>
          )}
          {/* borrado total (spec §12.13, art. 17): discreto aquí — el peso lo
              lleva el diálogo, que es donde se decide de verdad */}
          <button
            type="button"
            onClick={() => open({ type: 'delete-account' })}
            className="underline hover:text-red-600 dark:hover:text-red-400"
          >
            Borrar mi cuenta
          </button>
        </footer>
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
        <LlmSettingsDialog
          status={llmStatus}
          mcpUrl={mcpUrl}
          initialTab={dialog.tab}
          onStatusChange={setLlmStatus}
          onClose={close}
        />
      )}

      {dialog?.type === 'delete-account' && (
        <DeleteAccountDialog iosStandalone={iosStandalone} onClose={close} />
      )}
    </>
  )
}

// El alternador PanelTab vive ahora en panel-tab.tsx: lo comparte este panel
// (Chat/Hoy) con el diálogo de IA (Clave de API/Conectores).
