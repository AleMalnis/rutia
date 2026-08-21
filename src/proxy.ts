import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

// proxy.ts es el nombre que Next 16 da al middleware; exige export nombrado
// `proxy` (o default), corre siempre en Node.js y no admite `runtime`.
export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  // Todas las rutas salvo estáticos e imágenes. Las rutas /api quedan
  // incluidas a propósito: también necesitan la sesión fresca.
  //
  // Excepciones (spec §6.5): el servidor MCP y sus metadatos de
  // descubrimiento no usan cookies de sesión, sino un token OAuth en la
  // cabecera. Dejarlos pasar por aquí solo gastaría una verificación de
  // sesión inútil en cada petición y podría colgarle un Set-Cookie ajeno a
  // la respuesta de un cliente externo. Los metadatos, además, son públicos
  // por definición: un cliente los pide ANTES de tener cualquier token.
  //
  // manifest.webmanifest (spec §4): público por definición, como los iconos
  // que ya excluye la regla de extensiones; el navegador lo pide fuera de la
  // sesión y verificarla ahí solo gasta. sw.js (spec §4 «Avisos push»), por
  // lo mismo: es un estático que el navegador refresca por su cuenta.
  matcher: [
    '/((?!api/mcp|\\.well-known/oauth-protected-resource|manifest\\.webmanifest|sw\\.js|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
