'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { parseItemForm } from '@/lib/item-form'
import { createClient } from '@/lib/supabase/server'
import { createCompletionsRepo } from '@/repositories/completions.repo'
import { createItemsRepo } from '@/repositories/items.repo'
import { createProfilesRepo } from '@/repositories/profiles.repo'
import { createRoutineService, type OverlapConflict } from '@/services/routine.service'

// Server actions de la gestión manual de ítems (spec §7.2: la UI llama aquí,
// nunca a Supabase). El user_id sale siempre de la sesión del servidor.

export type ItemFormState =
  | null
  | { status: 'ok' }
  | { status: 'error'; message: string }
  | { status: 'conflict'; conflicts: OverlapConflict[] }

// Devuelve null si la comprobación de sesión FALLÓ, que no es lo mismo que no
// tener sesión: getClaims consulta el endpoint JWKS y relanza lo que no sea un
// AuthError, así que un fallo de red no debe cerrarle la sesión al usuario ni
// tumbar la pantalla. La ausencia real de sesión sí redirige.
// El redirect vive fuera del try a propósito: lanza NEXT_REDIRECT y capturarlo
// lo dejaría sin efecto.
async function getContext() {
  const supabase = await createClient()

  let claims: { sub?: unknown } | null = null
  try {
    const { data } = await supabase.auth.getClaims()
    claims = data?.claims ?? null
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    console.error(`getContext: ${detail}`)
    return null
  }

  if (typeof claims?.sub !== 'string') {
    redirect('/login')
  }

  return {
    userId: claims.sub,
    supabase,
    service: createRoutineService({
      items: createItemsRepo(supabase),
      completions: createCompletionsRepo(supabase),
      profiles: createProfilesRepo(supabase),
    }),
  }
}

const SESSION_CHECK_FAILED = {
  status: 'error',
  message: 'No se pudo verificar tu sesión. Inténtalo de nuevo.',
} as const

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
  const context = await getContext()
  if (context == null) return SESSION_CHECK_FAILED
  const { userId, service } = context

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
  const context = await getContext()
  if (context == null) return SESSION_CHECK_FAILED
  const { userId, service } = context

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

export type ToggleState = { status: 'ok'; done: boolean } | { status: 'error'; message: string }

/**
 * Marca o desmarca un ítem del panel «Hoy». La fecha la pone el servidor;
 * `panelDate` es solo la fecha que el panel tenía pintada, para detectar que
 * el día ha cambiado con la pestaña abierta.
 */
export async function toggleCompleted(
  itemId: string,
  done: boolean,
  panelDate: string,
): Promise<ToggleState> {
  const context = await getContext()
  if (context == null) return SESSION_CHECK_FAILED

  try {
    const result = await context.service.setCompleted(
      context.userId,
      itemId,
      done,
      new Date(),
      panelDate,
    )

    if (!result.ok) {
      if (result.reason === 'not_found' || result.reason === 'stale') {
        revalidatePath('/app')
        return {
          status: 'error',
          message: result.reason === 'stale' ? result.message : 'Este ítem ya no existe.',
        }
      }
      return {
        status: 'error',
        message: result.reason === 'conflict' ? 'No se pudo marcar el ítem.' : result.message,
      }
    }

    revalidatePath('/app')
    return { status: 'ok', done: result.done }
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    console.error(`toggleCompleted: ${detail}`)
    return { status: 'error', message: 'No se pudo marcar el ítem. Inténtalo de nuevo.' }
  }
}

/**
 * Guarda la zona horaria real del navegador. Sin esto todo el mundo corría con
 * el valor por defecto del perfil y «hoy» se calculaba en el huso equivocado.
 */
export async function reportTimezone(timezone: string): Promise<void> {
  const context = await getContext()
  if (context == null) return

  try {
    const { ok } = await context.service.updateTimezone(context.userId, timezone)
    if (ok) revalidatePath('/app')
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    console.error(`reportTimezone: ${detail}`)
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
