import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logout } from './actions'

// Página provisional de /app: saluda al usuario autenticado. El calendario,
// el panel «Hoy» y el chat llegarán en las siguientes tareas.
export default async function AppPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  // El proxy ya protege /app; esto cubre la carrera de una sesión caducada
  // entre el proxy y este render.
  if (!data) {
    redirect('/login')
  }

  const email = typeof data.claims.email === 'string' ? data.claims.email : 'usuario'

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 px-4 dark:bg-black">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Hola, {email}
      </h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Tu rutina semanal aparecerá aquí muy pronto.
      </p>
      <form action={logout}>
        <button
          type="submit"
          className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
        >
          Cerrar sesión
        </button>
      </form>
    </main>
  )
}
