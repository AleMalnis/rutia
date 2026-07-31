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
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
