import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Cliente de Supabase para el servidor MCP (spec §6.5).
 *
 * No usa cookies —un cliente MCP externo no las tiene— sino el JWT del propio
 * usuario que ya venía validado en la petición. Al reenviarlo a PostgREST,
 * `auth.uid()` devuelve el usuario real y **las políticas RLS aplican igual
 * que en la web**: se cumple la regla del proyecto sin ninguna clave de
 * servicio en esta ruta.
 *
 * Se usa `global.headers` y no la opción `accessToken` a propósito: esa
 * opción inutiliza el namespace `auth` del cliente, y aquí no hace falta
 * porque el token llega ya validado y no hay sesión que refrescar.
 */
export function createMcpClient(accessToken: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY. Copia .env.example a .env.local y rellénalas.',
    )
  }

  return createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: {
      // ruta sin navegador ni cookies: nada que persistir, refrescar ni leer
      // de la URL
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
