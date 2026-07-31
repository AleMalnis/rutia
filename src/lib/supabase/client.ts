'use client'

import { createBrowserClient } from '@supabase/ssr'

/**
 * Cliente de Supabase para componentes de cliente (navegador).
 *
 * Alcance: solo `supabase.auth.*` (registro, login, cierre de sesión,
 * onAuthStateChange) y, cuando llegue, las suscripciones de Realtime. Las
 * consultas y escrituras de datos van por server action → servicio →
 * repositorio: la UI no habla directamente con Supabase (spec §7.2).
 *
 * La directiva 'use client' no es decorativa: sin ella, importar esta función
 * desde código de servidor devuelve un cliente sin sesión que lee cero cookies
 * y consulta como rol anon, con lo que la RLS no devuelve filas y no salta
 * ningún error. Con ella, esa llamada falla de inmediato.
 *
 * `createBrowserClient` devuelve un singleton en el navegador, así que llamarla
 * desde varios componentes no crea clientes distintos.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY. Copia .env.example a .env.local y rellénalas.',
    )
  }

  return createBrowserClient(url, anonKey)
}
