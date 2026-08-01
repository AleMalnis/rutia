'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { parseItemForm } from '@/lib/item-form'
import { createClient } from '@/lib/supabase/server'
import { createItemsRepo } from '@/repositories/items.repo'
import { createRoutineService, type OverlapConflict } from '@/services/routine.service'

// Server actions de la gestión manual de ítems (spec §7.2: la UI llama aquí,
// nunca a Supabase). El user_id sale siempre de la sesión del servidor.

export type ItemFormState =
  | null
  | { status: 'ok' }
  | { status: 'error'; message: string }
  | { status: 'conflict'; conflicts: OverlapConflict[] }

async function getContext() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (data == null || typeof data.claims.sub !== 'string') {
    redirect('/login')
  }
  return {
    userId: data.claims.sub,
    service: createRoutineService(createItemsRepo(supabase)),
  }
}

// Un fallo del repositorio (Supabase caído, timeout) no debe propagarse: sin
// captura, el rechazo de la acción tumba toda la pantalla /app al error
// boundary y el usuario pierde el formulario. Se registra y se devuelve un
// mensaje genérico, sin filtrar detalles internos.
function unexpectedFailure(scope: string, error: unknown): ItemFormState {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  console.error(`${scope}: ${detail}`)
  return { status: 'error', message: 'No se pudo guardar. Inténtalo de nuevo.' }
}

export async function saveItem(
  _prevState: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  const { userId, service } = await getContext()

  const itemId = formData.get('itemId')
  const input = parseItemForm(formData)

  try {
    const result =
      typeof itemId === 'string' && itemId !== ''
        ? await service.updateItem(userId, itemId, input)
        : await service.createItem(userId, input)

    if (!result.ok) {
      if (result.reason === 'conflict') {
        return { status: 'conflict', conflicts: result.conflicts }
      }
      if (result.reason === 'not_found') {
        // el ítem se borró desde otra pestaña o desde el chat: refrescamos
        // para que el calendario deje de mostrarlo
        revalidatePath('/app')
        return { status: 'error', message: 'Este ítem ya no existe; el calendario se ha actualizado.' }
      }
      return { status: 'error', message: result.message }
    }

    revalidatePath('/app')
    return { status: 'ok' }
  } catch (error) {
    return unexpectedFailure('saveItem', error)
  }
}

export async function deleteItem(itemId: string): Promise<ItemFormState> {
  const { userId, service } = await getContext()

  try {
    const result = await service.deleteItems(userId, [itemId])

    if (!result.ok) {
      return {
        status: 'error',
        message: result.reason === 'conflict' ? 'No se pudo borrar el ítem.' : result.message,
      }
    }

    // deleted === 0 significa que ya no estaba: refrescar igualmente deja el
    // calendario coherente, y para el usuario el resultado es el mismo.
    revalidatePath('/app')
    return { status: 'ok' }
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    console.error(`deleteItem: ${detail}`)
    return { status: 'error', message: 'No se pudo borrar el ítem. Inténtalo de nuevo.' }
  }
}

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
