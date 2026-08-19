'use client'

import { useState, useSyncExternalStore } from 'react'

// Aviso de instalación para iPhone/iPad (spec §4): Safari no tiene
// `beforeinstallprompt`, así que la única forma de que el usuario sepa que
// RutIA se instala es decírselo. Solo aparece en iOS y fuera del modo
// standalone (instalada ya no tiene sentido); en Android no se pinta nada
// porque Chrome ofrece su propia instalación.

const DISMISS_KEY = 'rutia-install-hint-dismissed'

function isIos(): boolean {
  // iPadOS se hace pasar por macOS desde hace años: se detecta por el táctil.
  //
  // El token «Safari/» filtra los navegadores in-app (Gmail, Instagram…):
  // son WKWebView cuya hoja de compartir NO tiene «Añadir a pantalla de
  // inicio», así que ahí el aviso daría una instrucción imposible. Safari y
  // los navegadores completos de terceros (CriOS, FxiOS, EdgiOS) sí lo llevan
  // y sí pueden instalar desde iOS 16.4. Falso positivo residual conocido:
  // SFSafariViewController usa el UA exacto de Safari y no es filtrable.
  const ua = navigator.userAgent
  const ios = /iPhone|iPod/.test(ua) || (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  return ios && /Safari\//.test(ua) && !/\b(GSA|FBAN|FBAV|Instagram)\b/.test(ua)
}

function isStandalone(): boolean {
  // `navigator.standalone` es la señal histórica de Safari; la media query es
  // la estándar. Cualquiera de las dos vale.
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
  )
}

// El aviso depende de datos que solo existen en el cliente (user agent,
// display-mode, localStorage). useSyncExternalStore es el patrón para eso:
// el servidor pinta «oculto» (getServerSnapshot), la hidratación coincide, y
// el cliente re-evalúa sin el setState-en-efecto que prohíbe el compilador.
// Nada de esto cambia tras el montaje, así que no hay nada que suscribir.
const subscribeToNothing = () => () => {}

function shouldOffer(): boolean {
  try {
    return isIos() && !isStandalone() && localStorage.getItem(DISMISS_KEY) == null
  } catch {
    // localStorage puede lanzar (modo privado antiguo, políticas): sin él no
    // se podría recordar el descarte, así que mejor no incordiar
    return false
  }
}

export function InstallHint() {
  const eligible = useSyncExternalStore(subscribeToNothing, shouldOffer, () => false)
  const [dismissed, setDismissed] = useState(false)

  if (!eligible || dismissed) return null

  return (
    <aside
      role="note"
      className="flex items-start justify-between gap-3 rounded-xl border border-edge bg-card px-3 py-2.5 text-sm text-ink print:hidden"
    >
      <p>
        <strong className="font-semibold">Instala RutIA en tu iPhone o iPad:</strong> toca
        Compartir{' '}
        {/* el icono de Compartir de iOS (cuadrado con flecha), dibujado aquí:
            el glifo SF Symbols es zona de uso privado y puede salir en blanco */}
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="inline-block h-[1em] w-[1em] -translate-y-[0.1em] align-middle"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 6H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1" />
          <path d="M8 10V1.8M5.5 4 8 1.5 10.5 4" />
        </svg>{' '}
        y elige «Añadir a pantalla de inicio». Tendrás la app con su icono, a pantalla completa.
      </p>
      <button
        type="button"
        onClick={() => {
          setDismissed(true)
          try {
            localStorage.setItem(DISMISS_KEY, '1')
          } catch {
            // sin almacenamiento, el descarte dura lo que dure la página
          }
        }}
        className="shrink-0 rounded-md border border-edge px-2 py-1 text-xs font-medium text-ink-2 hover:bg-edge/40"
      >
        Entendido
      </button>
    </aside>
  )
}
