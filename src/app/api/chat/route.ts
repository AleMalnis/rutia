import { NextResponse } from 'next/server'
import { SecretConfigError } from '@/lib/crypto'
import { createClient } from '@/lib/supabase/server'
import { createCategoriesRepo } from '@/repositories/categories.repo'
import { createChatRepo } from '@/repositories/chat.repo'
import { createCompletionsRepo } from '@/repositories/completions.repo'
import { createItemsRepo } from '@/repositories/items.repo'
import { createLlmSettingsRepo } from '@/repositories/llm-settings.repo'
import { createProfilesRepo } from '@/repositories/profiles.repo'
import { createAgentService } from '@/services/agent.service'
import { createLlmSettingsService } from '@/services/llm-settings.service'
import { createLLMClient, LLMError } from '@/services/llm.client'
import { createRoutineService } from '@/services/routine.service'

// POST /api/chat: el endpoint del agente (puerta A, spec §7.3). La UI envía
// { message } y recibe { reply, affectedItemIds, mutated }. La sesión se
// verifica aquí; el chat funciona SOLO con la clave BYOK del usuario (spec
// §6.4): sin clave se devuelve code:'no_key' y la UI ofrece configurarla.

// El bucle agéntico encadena hasta 5 llamadas al proveedor: el tope por
// defecto de la plataforma (segundos) cortaría una conversación normal. 60 s
// es el máximo del plan gratuito de Vercel; AgentService se corta antes
// (REQUEST_BUDGET_MS) para poder responder con un mensaje útil.
export const maxDuration = 60

// las respuestas llevan Set-Cookie de sesión: que ningún CDN las cachee
const NO_STORE = { 'Cache-Control': 'private, no-store' }

function jsonError(message: string, status: number, code?: string) {
  return NextResponse.json(
    code == null ? { error: message } : { error: message, code },
    { status, headers: NO_STORE },
  )
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getClaims()
    if (data == null || typeof data.claims.sub !== 'string') {
      return jsonError('No has iniciado sesión.', 401)
    }
    const userId = data.claims.sub

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('El cuerpo de la petición debe ser JSON.', 400)
    }
    const message =
      typeof body === 'object' && body != null
        ? (body as { message?: unknown }).message
        : undefined

    // la clave BYOK del usuario decide el proveedor; sin clave no hay chat
    const llmSettings = createLlmSettingsService({ repo: createLlmSettingsRepo(supabase) })
    const credentials = await llmSettings.getCredentials(userId)
    if (credentials == null) {
      return jsonError(
        'Para usar el chat, configura tu clave de API en «IA» (o conecta por MCP cuando esté disponible).',
        409,
        'no_key',
      )
    }

    const routine = createRoutineService({
      items: createItemsRepo(supabase),
      completions: createCompletionsRepo(supabase),
      profiles: createProfilesRepo(supabase),
      categories: createCategoriesRepo(supabase),
    })
    const agent = createAgentService({
      routine,
      chat: createChatRepo(supabase),
      llm: createLLMClient(credentials.provider, credentials.apiKey),
    })

    const result = await agent.chat(userId, message, new Date())
    if (!result.ok) {
      return jsonError(result.message, result.reason === 'rate_limited' ? 429 : 400)
    }
    return NextResponse.json(
      { reply: result.reply, affectedItemIds: result.affectedItemIds, mutated: result.mutated },
      { headers: NO_STORE },
    )
  } catch (error) {
    if (error instanceof SecretConfigError) {
      console.error('[api/chat]', error.name, error.message)
      return jsonError('El asistente no está configurado en este servidor.', 503)
    }
    if (error instanceof LLMError) {
      // el kind basta para diagnosticar; el mensaje del proveedor no se
      // reenvía al cliente
      console.error('[api/chat]', error.name, error.kind, error.message)
      if (error.kind === 'bad_key') {
        return jsonError('Tu clave de API parece inválida o revocada. Revísala en «IA».', 400)
      }
      if (error.kind === 'timeout') {
        return jsonError(
          'El asistente ha tardado demasiado en responder. Prueba a pedírmelo en pasos más pequeños.',
          504,
        )
      }
      if (error.kind === 'quota') {
        // condición permanente de la cuenta del usuario: decir «vuelve a
        // intentarlo» solo le haría reintentar para siempre
        return jsonError(
          'Tu cuenta del proveedor de IA no tiene crédito o ha agotado su cuota. Revisa la facturación en el panel de tu proveedor.',
          400,
        )
      }
      return jsonError('El asistente no está disponible ahora mismo. Vuelve a intentarlo en un momento.', 502)
    }
    // log saneado (solo nombre y mensaje), igual que en los server actions
    const name = error instanceof Error ? error.name : 'Error'
    const message = error instanceof Error ? error.message : String(error)
    console.error('[api/chat]', name, message)
    return jsonError('Algo ha ido mal. Vuelve a intentarlo.', 500)
  }
}
