import { redirect } from 'next/navigation'
import { RoutineBoard } from '@/components/routine-board'
import { createClient } from '@/lib/supabase/server'
import { createCategoriesRepo } from '@/repositories/categories.repo'
import { createItemsRepo } from '@/repositories/items.repo'
import { createRoutineService } from '@/services/routine.service'
import { logout } from './actions'

// /app: el calendario semanal con la rutina real del usuario, cargada en el
// servidor vía RoutineService (la UI nunca toca Supabase directamente).
export default async function AppPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  // El proxy ya protege /app; esto cubre la carrera de una sesión caducada
  // entre el proxy y este render.
  if (data == null || typeof data.claims.sub !== 'string') {
    redirect('/login')
  }

  const userId = data.claims.sub
  const email = typeof data.claims.email === 'string' ? data.claims.email : 'usuario'

  const routineService = createRoutineService(createItemsRepo(supabase))
  const categoriesRepo = createCategoriesRepo(supabase)
  const [{ items }, categories] = await Promise.all([
    routineService.listItems(userId),
    categoriesRepo.listByUser(userId),
  ])

  return (
    <main className="flex flex-1 flex-col gap-4 bg-zinc-50 p-4 dark:bg-black">
      {/* la cabecera va dentro del tablero para quedar cubierta por su
          `inert` mientras el diálogo de edición está abierto */}
      <RoutineBoard items={items} categories={categories}>
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">RutIA</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{email}</p>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
            >
              Cerrar sesión
            </button>
          </form>
        </header>
      </RoutineBoard>
    </main>
  )
}
