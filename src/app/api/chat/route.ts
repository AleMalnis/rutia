import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCategoriesRepo } from '@/repositories/categories.repo'
import { createChatRepo } from '@/repositories/chat.repo'
import { createCompletionsRepo } from '@/repositories/completions.repo'
import { createItemsRepo } from '@/repositories/items.repo'
import { createProfilesRepo } from '@/repositories/profiles.repo'
import { createAgentService } from '@/services/agent.service'
import { createAnthropicClient, LLMError } from '@/services/llm.client'
import { createRoutineService } from '@/services/routine.service'

// POST /api/chat: el endpoint del agente (puerta A, spec §7.3). La UI envía
// { message } y recibe { reply, affectedItemIds, mutated }. La sesión se
// verifica aquí; el rate limit y el bucle agéntico viven en AgentService.

// las respuestas llevan Set-Cookie de sesión: que ningún CDN las cachee
const NO_STORE = { 'Cache-Control': 'private, no-store' }

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE })
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

    const routine = createRoutineService({
      items: createItemsRepo(supabase),
      completions: createCompletionsRepo(supabase),
      profiles: createProfilesRepo(supabase),
      categories: createCategoriesRepo(supabase),
    })
    const agent = createAgentService({
      routine,
      chat: createChatRepo(supabase),
      llm: createAnthropicClient(),
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
    if (error instanceof LLMError) {
      // el kind basta para diagnosticar; el mensaje del proveedor no se
      // reenvía al cliente
      console.error('[api/chat]', error.name, error.kind, error.message)
      if (error.kind === 'missing_key') {
        return jsonError('El asistente no está configurado en este servidor.', 503)
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
