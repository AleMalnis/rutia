import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createRetryFetch } from './fetch-retry'

/**
 * Cliente de Supabase para el servidor: Server Components, Server Actions y
 * Route Handlers.
 *
 * Hay que crear uno nuevo en cada render o petición; nunca compartirlo entre
 * peticiones. La sesión se carga de forma perezosa, así que llama a
 * `getClaims()` o `getUser()` al principio del handler: si el refresco del token
 * termina después de enviar la respuesta, las cookies nuevas se pierden.
 */
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY. Copia .env.example a .env.local y rellénalas.',
    )
  }

  const cookieStore = await cookies()

  return createServerClient(url, anonKey, {
    // absorbe el desfase de reloj de Supabase (PGRST303, spec §7.2)
    global: { fetch: createRetryFetch() },
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      // `setAll` recibe un segundo argumento `headers` con las cabeceras
      // anti-caché que deben acompañar a las cookies de sesión. Con `cookies()`
      // no hay objeto response donde ponerlas, así que se pierden: cada ruta
      // que autentique debe fijar `Cache-Control: private, no-store` por su
      // cuenta, o un CDN podría cachear el Set-Cookie de un usuario y servirlo
      // a otro.
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // En un Server Component el store es de solo lectura y `set` lanza.
          // Se ignora a propósito.
        }
      },
    },
  })
}
