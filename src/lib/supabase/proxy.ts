import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Refresca la sesión de Supabase en la frontera de la respuesta (proxy).
 *
 * Es la única pieza que puede persistir un token renovado: los Server
 * Components no pueden escribir cookies, así que sin este paso la sesión
 * caduca y aparecen logouts aleatorios. Aquí sí hay objeto response, por lo
 * que también se aplican las cabeceras anti-caché (`Cache-Control`, `Expires`,
 * `Pragma`) que `@supabase/ssr` pasa junto a las cookies de sesión.
 */
export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY. Copia .env.example a .env.local y rellénalas.',
    )
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        // El contrato de @supabase/ssr exige escribir cada cookie en la
        // request (para que getAll vea el cambio dentro de esta misma
        // petición) y en la response (para que llegue al navegador).
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        supabaseResponse = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options)
        }
        // Sin estas cabeceras, un CDN o proxy inverso podría cachear el
        // Set-Cookie de un usuario y servir su sesión a otro.
        for (const [key, value] of Object.entries(headers)) {
          supabaseResponse.headers.set(key, value)
        }
      },
    },
  })

  // La sesión se carga de forma perezosa: esta llamada dispara el refresco
  // del token si toca, y debe ocurrir antes de generar la respuesta o las
  // cookies nuevas se perderían. getClaims relanza los errores que no son
  // AuthError (p. ej. una cookie forjada con un alg inválido): sin el catch,
  // ese throw sería un 500 en todas las rutas para ese navegador; con él, el
  // cliente queda como no autenticado y la petición sigue.
  let isAuthenticated = false
  try {
    const { data } = await supabase.auth.getClaims()
    isAuthenticated = data?.claims != null
  } catch (error) {
    // Solo la CLASE del error: también el mensaje puede arrastrar fragmentos
    // del token (un error de parseo incrusta trozos de la cookie que lo
    // provocó), no solo el stack.
    const name = error instanceof Error ? error.name : 'UnknownError'
    console.warn(`proxy: fallo al refrescar la sesión — ${name}`)
  }

  // Protección de /app (spec §4): sin sesión, a /login. Es la comprobación
  // optimista del proxy; la verificación real sigue siendo la RLS y la
  // sesión que valida cada server action.
  const { pathname } = request.nextUrl
  if (!isAuthenticated && (pathname === '/app' || pathname.startsWith('/app/'))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    const redirectResponse = NextResponse.redirect(url)
    // conserva lo que el refresco hubiera escrito en la respuesta original
    for (const cookie of supabaseResponse.cookies.getAll()) {
      redirectResponse.cookies.set(cookie)
    }
    for (const header of ['cache-control', 'expires', 'pragma']) {
      const value = supabaseResponse.headers.get(header)
      if (value) redirectResponse.headers.set(header, value)
    }
    return redirectResponse
  }

  return supabaseResponse
}
