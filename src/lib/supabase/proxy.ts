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
  try {
    await supabase.auth.getClaims()
  } catch (error) {
    console.warn('proxy: fallo al refrescar la sesión', error)
  }

  return supabaseResponse
}
