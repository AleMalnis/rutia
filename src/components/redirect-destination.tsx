'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

// Destino de vuelta tras autenticarse (spec §6.5): el flujo OAuth del modo MCP
// manda al usuario a /login y tiene que volver a la pantalla de autorización.
//
// Está aislado en su propio componente porque leer la URL con useSearchParams
// obliga a un límite de Suspense en una página prerenderizada: así el
// formulario visible se sigue prerenderizando y no parpadea.
//
// El valor viaja en el formulario (la server action no ve la URL) y SIEMPRE se
// valida en el servidor con safeRedirect, que rechaza destinos externos.

/** Campo oculto con el destino, si la URL lo trae. */
export function RedirectDestination() {
  const destino = useSearchParams().get('redirect')
  if (!destino) return null
  return <input type="hidden" name="redirect" value={destino} />
}

/** Enlace a /registro conservando el destino, para no dejar tirado a quien no tiene cuenta. */
export function RegisterLink({ className }: { className?: string }) {
  const destino = useSearchParams().get('redirect')
  return (
    <Link
      href={destino ? `/registro?redirect=${encodeURIComponent(destino)}` : '/registro'}
      className={className}
    >
      Regístrate
    </Link>
  )
}

/** Enlace a /login conservando el destino. */
export function LoginLink({ className }: { className?: string }) {
  const destino = useSearchParams().get('redirect')
  return (
    <Link
      href={destino ? `/login?redirect=${encodeURIComponent(destino)}` : '/login'}
      className={className}
    >
      Inicia sesión
    </Link>
  )
}
