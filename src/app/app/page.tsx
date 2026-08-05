import { redirect } from 'next/navigation'
import { RoutineBoard } from '@/components/routine-board'
import { createClient } from '@/lib/supabase/server'
import { createCategoriesRepo } from '@/repositories/categories.repo'
import { createCompletionsRepo } from '@/repositories/completions.repo'
import { createItemsRepo } from '@/repositories/items.repo'
import { createProfilesRepo } from '@/repositories/profiles.repo'
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

  const routineService = createRoutineService({
    items: createItemsRepo(supabase),
    completions: createCompletionsRepo(supabase),
    profiles: createProfilesRepo(supabase),
    categories: createCategoriesRepo(supabase),
  })
  const [{ items }, categories, today, appearance] = await Promise.all([
    routineService.listItems(userId),
    routineService.listCategories(userId),
    routineService.listToday(userId, new Date()),
    routineService.getAppearance(userId),
  ])

  return (
    // Los data-attrs activan el tema, el modo y la fuente elegidos (spec §4):
    // el CSS de globals.css resuelve los tokens a partir de ellos, sin JS.
    <main
      data-theme={appearance.theme}
      data-mode={appearance.mode}
      data-font={appearance.font}
      className="flex flex-1 flex-col gap-4 bg-page p-4 text-ink"
    >
      {/* la cabecera va dentro del tablero para quedar cubierta por su
          `inert` mientras el diálogo de edición está abierto */}
      <RoutineBoard
        items={items}
        categories={categories}
        todayEntries={today.entries}
        todayWeekday={today.weekday}
        todayDate={today.date}
        appearance={appearance}
      >
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-ink">RutIA</h1>
            <p className="text-sm text-ink-3">{email}</p>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-md border border-edge bg-card px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-edge/40"
            >
              Cerrar sesión
            </button>
          </form>
        </header>
      </RoutineBoard>
    </main>
  )
}
