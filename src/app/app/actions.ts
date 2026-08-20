'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { SecretConfigError } from '@/lib/crypto'
import { parseItemForm } from '@/lib/item-form'
import { deleteAccountConfirmationSchema, mcpClientIdSchema } from '@/lib/schemas'
import { createClient } from '@/lib/supabase/server'
import { createCategoriesRepo } from '@/repositories/categories.repo'
import { createCompletionsRepo } from '@/repositories/completions.repo'
import { createItemsRepo } from '@/repositories/items.repo'
import { createLlmSettingsRepo } from '@/repositories/llm-settings.repo'
import { createProfilesRepo } from '@/repositories/profiles.repo'
import { createLlmSettingsService, type LlmKeyStatus } from '@/services/llm-settings.service'
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
    // solo la CLASE del error: el mensaje puede incrustar material del token
    // (misma sanitización que el proxy y /api/export)
    const name = error instanceof Error ? error.name : 'UnknownError'
    console.error(`getContext: ${name}`)
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
      categories: createCategoriesRepo(supabase),
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
function unexpectedFailure(
  scope: string,
  error: unknown,
): { status: 'error'; message: string } {
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

export type CategoryFormState = { status: 'ok' } | { status: 'error'; message: string } | null

/** Crea o actualiza una categoría propia (spec §4: categorías editables). */
export async function saveCategory(
  categoryId: string | null,
  input: { name: string; color: string },
): Promise<CategoryFormState> {
  const context = await getContext()
  if (context == null) return SESSION_CHECK_FAILED

  try {
    const result =
      categoryId == null
        ? await context.service.createCategory(context.userId, input)
        : await context.service.updateCategory(context.userId, categoryId, input)

    if (!result.ok) {
      if (result.reason === 'not_found') {
        revalidatePath('/app')
        return { status: 'error', message: 'Esta categoría ya no existe.' }
      }
      return {
        status: 'error',
        message: result.reason === 'conflict' ? 'No se pudo guardar la categoría.' : result.message,
      }
    }

    revalidatePath('/app')
    return { status: 'ok' }
  } catch (error) {
    return unexpectedFailure('saveCategory', error)
  }
}

/** Borra una categoría; sus ítems quedan «sin categoría». */
export async function deleteCategory(categoryId: string): Promise<CategoryFormState> {
  const context = await getContext()
  if (context == null) return SESSION_CHECK_FAILED

  try {
    const result = await context.service.deleteCategory(context.userId, categoryId)
    if (!result.ok) {
      return {
        status: 'error',
        message: result.reason === 'conflict' ? 'No se pudo borrar la categoría.' : result.message,
      }
    }
    revalidatePath('/app')
    return { status: 'ok' }
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    console.error(`deleteCategory: ${detail}`)
    return { status: 'error', message: 'No se pudo borrar la categoría. Inténtalo de nuevo.' }
  }
}

export type AppearanceFormState =
  | { status: 'ok' }
  | { status: 'error'; message: string }
  | null

/** Guarda la apariencia elegida (spec §4: modo, tema y fuente). */
export async function saveAppearance(input: {
  mode: string
  theme: string
  font: string
}): Promise<AppearanceFormState> {
  const context = await getContext()
  if (context == null) return SESSION_CHECK_FAILED

  try {
    const result = await context.service.updateAppearance(context.userId, input)
    if (!result.ok) {
      return {
        status: 'error',
        message: result.reason === 'conflict' ? 'No se pudo guardar.' : result.message,
      }
    }
    revalidatePath('/app')
    return { status: 'ok' }
  } catch (error) {
    return unexpectedFailure('saveAppearance', error)
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
    // solo si de verdad cambió: si no, cada montaje del panel invalidaría la
    // caché de /app sin necesidad
    const { changed } = await context.service.updateTimezone(context.userId, timezone)
    if (changed) revalidatePath('/app')
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    console.error(`reportTimezone: ${detail}`)
  }
}

export type LlmKeyFormState =
  | { status: 'ok'; key: LlmKeyStatus }
  | { status: 'error'; message: string }
  | null

/**
 * Guarda la clave BYOK del usuario (spec §6.4). La clave viaja una sola vez
 * hacia el servidor, se cifra y no vuelve jamás: el estado devuelto trae solo
 * proveedor y últimos 4 caracteres.
 */
export async function saveLlmKey(input: {
  provider: string
  apiKey: string
}): Promise<LlmKeyFormState> {
  const context = await getContext()
  if (context == null) return SESSION_CHECK_FAILED

  try {
    const settings = createLlmSettingsService({ repo: createLlmSettingsRepo(context.supabase) })
    const result = await settings.saveKey(context.userId, input)
    if (!result.ok) return { status: 'error', message: result.message }
    return { status: 'ok', key: result.status }
  } catch (error) {
    if (error instanceof SecretConfigError) {
      console.error(`saveLlmKey: ${error.name}: ${error.message}`)
      return {
        status: 'error',
        message: 'El servidor no tiene configurado el cifrado de claves (LLM_KEY_SECRET).',
      }
    }
    return unexpectedFailure('saveLlmKey', error)
  }
}

/** Borra la clave BYOK guardada; el chat vuelve a pedir configuración. */
export async function deleteLlmKey(): Promise<LlmKeyFormState> {
  const context = await getContext()
  if (context == null) return SESSION_CHECK_FAILED

  try {
    const settings = createLlmSettingsService({ repo: createLlmSettingsRepo(context.supabase) })
    await settings.deleteKey(context.userId)
    return null
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    console.error(`deleteLlmKey: ${detail}`)
    return { status: 'error', message: 'No se pudo borrar la clave. Inténtalo de nuevo.' }
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

export type DeleteAccountState = null | { status: 'error'; message: string }

/**
 * Borra la cuenta ENTERA (spec §12.13, RGPD art. 17): la función SQL de la
 * migración 0005 elimina auth.users → cascada sobre todo lo demás. La
 * confirmación («BORRAR») se valida también aquí, como toda frontera: el
 * diálogo ya la exige, pero una server action es invocable sin la UI.
 */
export async function deleteAccount(confirmation: unknown): Promise<DeleteAccountState> {
  const parsed = deleteAccountConfirmationSchema.safeParse(confirmation)
  if (!parsed.success) {
    return { status: 'error', message: 'Escribe BORRAR (en mayúsculas) para confirmar.' }
  }

  const context = await getContext()
  if (context == null) return SESSION_CHECK_FAILED

  const { error } = await context.supabase.rpc('delete_my_account')
  if (error) {
    // errcode propio de la migración 0006: la cuenta de demostración está
    // blindada (su contraseña es compartida) y merece un mensaje claro
    if (error.code === 'PDEMO') {
      return { status: 'error', message: 'La cuenta de demostración no se puede borrar.' }
    }
    // código y nombre, nunca el mensaje crudo: misma política que el resto
    console.error(`deleteAccount: ${error.code ?? error.name ?? 'error'}`)
    return {
      status: 'error',
      message:
        'No se pudo borrar la cuenta. Vuelve a intentarlo; si persiste, escríbenos y la borramos nosotros.',
    }
  }

  // La cuenta ya NO existe: el signOut es cortesía para limpiar las cookies
  // del navegador, y sus errores no cambian nada (no hay sesión que salvar).
  try {
    await context.supabase.auth.signOut({ scope: 'local' })
  } catch {
    // sin dueño no hay sesión que revocar; las cookies caducan solas
  }

  redirect('/')
}

// ── Accesos del modo MCP (spec §12.9) ───────────────────────────────────────
// Lista y revocación de los grants OAuth del usuario. Son datos de GoTrue, no
// de PostgREST: no hay tabla ni repositorio que envolver — la action ES la
// frontera, como en deleteAccount.

export type McpGrant = { clientId: string; clientName: string; grantedAt: string }
export type McpGrantsState =
  | { status: 'ok'; grants: McpGrant[] }
  | { status: 'error'; message: string }

export async function listMcpGrants(): Promise<McpGrantsState> {
  const context = await getContext()
  if (context == null) return SESSION_CHECK_FAILED

  const { data, error } = await context.supabase.auth.oauth.listGrants()
  if (error) {
    // solo la clase: misma política de logs que el resto de auth
    console.error(`listMcpGrants: ${error.name ?? 'error'}`)
    return { status: 'error', message: 'No se pudieron consultar los accesos. Vuelve a intentarlo.' }
  }

  return {
    status: 'ok',
    grants: (data ?? []).map((grant) => ({
      clientId: grant.client.id,
      // el nombre lo elige quien registró el cliente y puede venir vacío
      clientName: grant.client.name?.trim() || 'Cliente sin nombre',
      grantedAt: grant.granted_at,
    })),
  }
}

export async function revokeMcpGrant(clientId: unknown): Promise<McpGrantsState> {
  const parsed = mcpClientIdSchema.safeParse(clientId)
  if (!parsed.success) {
    return { status: 'error', message: 'Identificador de cliente no válido.' }
  }

  const context = await getContext()
  if (context == null) return SESSION_CHECK_FAILED

  const { error } = await context.supabase.auth.oauth.revokeGrant({ clientId: parsed.data })
  if (error) {
    console.error(`revokeMcpGrant: ${error.name ?? 'error'}`)
    return { status: 'error', message: 'No se pudo revocar el acceso. Vuelve a intentarlo.' }
  }

  // la lista repintada sale del servidor, no de una resta local: si otra
  // pestaña (o el propio cliente) tocó los grants mientras tanto, se ve
  return listMcpGrants()
}
