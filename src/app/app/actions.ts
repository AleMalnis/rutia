'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function logout(): Promise<void> {
  const supabase = await createClient()
  // scope local: cierra la sesión de este dispositivo, no la de todos.
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) {
    // Si la revocación falla, las cookies siguen vivas: redirigir a /login
    // fingiría un cierre de sesión que no ocurrió. El usuario permanece en
    // /app (su estado real) y puede reintentar.
    console.warn(`logout: ${error.name}: ${error.message}`)
    return
  }
  redirect('/login')
}
