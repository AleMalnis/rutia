// Service worker de RutIA (spec §4 «Avisos push»): SOLO avisos. Sin caché y
// sin offline, descartados a propósito — la app es contenido autenticado y
// dinámico, y un caché mal hecho enseña datos rancios.

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload
  try {
    payload = event.data.json()
  } catch {
    return // un push que no es nuestro JSON no pinta nada
  }
  if (typeof payload.title !== 'string' || payload.title.length === 0) return

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      // solo el título y la hora, nunca el detalle (decisión de producto:
      // la pantalla de bloqueo la mira cualquiera y el detalle puede llevar
      // datos de salud)
      body: typeof payload.body === 'string' ? payload.body : '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // mismo ítem y día = mismo tag: un reintento no apila duplicados
      tag: typeof payload.tag === 'string' ? payload.tag : 'rutia',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const open = clients.find((client) => client.url.includes('/app'))
      if (open) return open.focus()
      return self.clients.openWindow('/app')
    }),
  )
})
