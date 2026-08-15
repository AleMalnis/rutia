import type { MetadataRoute } from 'next'

// Manifest de la PWA (spec §4, «Instalación en el móvil»). Convención nativa
// de Next: esta ruta genera /manifest.webmanifest y lo enlaza sola en el head.
//
// theme_color es único y estático por espec del manifest, así que va el zinc
// neutro de login/registro; el que sí distingue claro/oscuro es el themeColor
// del viewport (layout.tsx), que admite media queries.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RutIA',
    short_name: 'RutIA',
    description: 'Tu semana, organizada conversando.',
    // sin sesión, el proxy redirige a /login; con ella, directo al calendario
    start_url: '/app',
    display: 'standalone',
    background_color: '#fafafa',
    theme_color: '#fafafa',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      // Android recorta el icono a la forma del launcher (círculo, squircle…):
      // sin la variante maskable lo encajaría sobre un disco blanco.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
