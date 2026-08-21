'use client'

import { useEffect, useState, useTransition } from 'react'
import { sendTestPush, subscribePush, unsubscribePush } from '@/app/app/actions'

// Avisos push, opt-in por dispositivo (spec §4 «Avisos push»). Vive al pie
// del panel «Hoy» porque los avisos son sobre lo de hoy. Cada navegador es
// una suscripción: activar pide el permiso y la guarda, desactivar la borra,
// y «Probar» envía un aviso real — la única forma honesta de saber que
// funciona antes de necesitarlo.

type PushState =
  | { kind: 'checking' }
  | { kind: 'unsupported' }
  | { kind: 'off' }
  | { kind: 'denied' }
  | { kind: 'on'; endpoint: string }

// La clave pública VAPID llega en base64url y el navegador la quiere en bytes.
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [state, setState] = useState<PushState>({ kind: 'checking' })
  const [notice, setNotice] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Detección y estado inicial: en iOS sin instalar no hay PushManager y el
  // control no se ofrece (InstallHint ya empuja a instalar); si el permiso
  // está bloqueado se explica en vez de fingir un botón que no puede hacer nada.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const supported =
        'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
      if (!supported) {
        if (!cancelled) setState({ kind: 'unsupported' })
        return
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration('/sw.js')
        const subscription = await registration?.pushManager.getSubscription()
        if (cancelled) return
        if (subscription) setState({ kind: 'on', endpoint: subscription.endpoint })
        else if (Notification.permission === 'denied') setState({ kind: 'denied' })
        else setState({ kind: 'off' })
      } catch {
        if (!cancelled) setState({ kind: 'unsupported' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function activate() {
    if (isPending) return
    setNotice(null)
    startTransition(async () => {
      try {
        // el permiso se pide ANTES de cualquier await: Safari exige que la
        // petición ocurra dentro de la activación del gesto del usuario, y
        // esperar al registro del SW puede agotarla
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
          setState({ kind: 'denied' })
          return
        }
        // el registro es idempotente y el SW no cachea nada (spec §4)
        await navigator.serviceWorker.register('/sw.js')
        const registration = await navigator.serviceWorker.ready
        let subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
        })
        let result = await subscribePush(subscription.toJSON())
        if (result.status === 'conflict') {
          // el endpoint era de otra cuenta (dispositivo compartido): estrenar
          // uno nuevo y reintentar una vez; la fila huérfana la limpia el
          // barrido de la etapa B
          await subscription.unsubscribe()
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
          })
          result = await subscribePush(subscription.toJSON())
        }
        if (result.status === 'ok') {
          setState({ kind: 'on', endpoint: subscription.endpoint })
          setNotice('Avisos activados en este dispositivo.')
        } else {
          setNotice(result.message)
        }
      } catch {
        setNotice('No se pudieron activar los avisos. Inténtalo de nuevo.')
      }
    })
  }

  function deactivate(endpoint: string) {
    if (isPending) return
    setNotice(null)
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration('/sw.js')
        const subscription = await registration?.pushManager.getSubscription()
        if (subscription) await subscription.unsubscribe()
        const result = await unsubscribePush(endpoint)
        if (result.status === 'ok') {
          setState({ kind: 'off' })
          setNotice('Avisos desactivados.')
        } else {
          setNotice(result.message)
        }
      } catch {
        setNotice('No se pudieron desactivar los avisos. Inténtalo de nuevo.')
      }
    })
  }

  function test(endpoint: string) {
    if (isPending) return
    setNotice(null)
    startTransition(async () => {
      try {
        const result = await sendTestPush(endpoint)
        setNotice(
          result.status === 'ok'
            ? 'Aviso de prueba enviado: debería sonar ahora mismo.'
            : result.message,
        )
      } catch {
        setNotice('No se pudo enviar la prueba. Inténtalo de nuevo.')
      }
    })
  }

  if (state.kind === 'checking' || state.kind === 'unsupported') return null

  return (
    <div className="mt-1 border-t border-edge/60 pt-2">
      {state.kind === 'denied' ? (
        <p className="text-xs text-ink-3">
          Los avisos están bloqueados en este navegador. Para usarlos, permite las notificaciones
          de RutIA en los ajustes del navegador.
        </p>
      ) : state.kind === 'off' ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-3">Recordatorios con aviso en este dispositivo</span>
          <button
            type="button"
            onClick={activate}
            disabled={isPending}
            className="shrink-0 rounded-md border border-edge px-2 py-0.5 text-xs font-medium text-ink-2 hover:bg-edge/40 disabled:opacity-50"
          >
            {isPending ? 'Activando…' : 'Activar avisos'}
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-3">Avisos activos en este dispositivo</span>
          <span className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => test(state.endpoint)}
              disabled={isPending}
              className="rounded-md border border-edge px-2 py-0.5 text-xs font-medium text-ink-2 hover:bg-edge/40 disabled:opacity-50"
            >
              Probar
            </button>
            <button
              type="button"
              onClick={() => deactivate(state.endpoint)}
              disabled={isPending}
              className="rounded-md px-2 py-0.5 text-xs font-medium text-ink-3 hover:bg-edge/40 hover:text-ink-2 disabled:opacity-50"
            >
              Desactivar
            </button>
          </span>
        </div>
      )}
      {notice && (
        <p role="status" className="mt-1 text-xs text-ink-3">
          {notice}
        </p>
      )}
    </div>
  )
}
