// Detección de plataforma SOLO de cliente (user agent, display-mode): llamar
// a esto en el servidor lanzaría. Nació en el aviso de instalación de iOS y
// lo comparte el pie del tablero, que necesita saber si la descarga de datos
// funciona en este contexto.

export function isIos(): boolean {
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

export function isStandalone(): boolean {
  // `navigator.standalone` es la señal histórica de Safari; la media query es
  // la estándar. Cualquiera de las dos vale.
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
  )
}
