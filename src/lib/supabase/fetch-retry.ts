// Supabase reparte GoTrue y PostgREST en máquinas distintas y sus relojes no
// siempre están sincronizados: un JWT recién emitido (justo tras el login o
// un refresco de sesión) puede llegar a PostgREST con su `iat` aún «en el
// futuro» y rechazarse con PGRST303, tumbando la primera carga de /app en la
// pantalla de reintentar (spec §7.2). No podemos sincronizar sus relojes; sí
// esperar a que el desfase pase de largo: se reintenta SOLO esa respuesta,
// con pausa creciente. Es seguro para cualquier método, también escrituras:
// PGRST303 se rechaza antes de ejecutar nada. Cualquier otro error (un
// PGRST301 caducado, un fallo de RLS) pasa tal cual y sin espera.

const RETRY_DELAYS_MS = [1000, 2000]

async function isFreshJwtRejection(response: Response): Promise<boolean> {
  if (response.status !== 401) return false
  try {
    // clone(): el body solo puede leerse una vez y, si no hay reintento, el
    // original debe llegar intacto a quien lo pidió
    const body: unknown = await response.clone().json()
    return typeof body === 'object' && body != null && 'code' in body && body.code === 'PGRST303'
  } catch {
    // un 401 sin JSON no es de PostgREST: no se reintenta
    return false
  }
}

export function createRetryFetch(): typeof fetch {
  return async (input, init) => {
    let response = await fetch(input, init)
    for (const delayMs of RETRY_DELAYS_MS) {
      if (!(await isFreshJwtRejection(response))) break
      // visible en los logs del despliegue: si esto aparece a menudo, el
      // desfase de Supabase está activo (solo el código, nunca el token)
      console.warn(`supabase: JWT recién emitido rechazado (PGRST303), reintento en ${delayMs} ms`)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      response = await fetch(input, init)
    }
    return response
  }
}
