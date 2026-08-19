import { createClient } from '@/lib/supabase/server'
import { todayInTimezone } from '@/lib/today'
import { createCategoriesRepo } from '@/repositories/categories.repo'
import { createChatRepo } from '@/repositories/chat.repo'
import { createCompletionsRepo } from '@/repositories/completions.repo'
import { createItemsRepo } from '@/repositories/items.repo'
import { createLlmSettingsRepo } from '@/repositories/llm-settings.repo'
import { createProfilesRepo } from '@/repositories/profiles.repo'
import { createExportService } from '@/services/export.service'

// GET /api/export: descarga de TODOS los datos del usuario (spec §12.13,
// RGPD art. 15 y 20). Misma autenticación por cookies que el resto de la app
// y la RLS de siempre como frontera; el ensamblado vive en ExportService.
//
// Es un GET a propósito: el pie de /app lo enlaza con un <a> normal y el
// navegador gestiona la descarga sin una línea de JS. No muta nada. Los
// errores responden JSON con mensaje claro: al ser una navegación, un error
// se VE como página, así que el texto es lo único que el usuario recibe.

export async function GET() {
  const supabase = await createClient()

  // getClaims relanza lo que no es AuthError (p. ej. una cookie forjada con
  // un alg inválido, caso ya observado que motivó el catch del proxy): aquí
  // eso es «no autenticado», no un 500. Log saneado: el error crudo puede
  // arrastrar fragmentos del token.
  let userId: string
  let email: string | null
  try {
    const { data } = await supabase.auth.getClaims()
    if (data == null || typeof data.claims.sub !== 'string') {
      return Response.json(
        { error: 'No hay sesión. Inicia sesión y vuelve a intentarlo.' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    userId = data.claims.sub
    email = typeof data.claims.email === 'string' ? data.claims.email : null
  } catch (problema) {
    const detalle = problema instanceof Error ? `${problema.name}: ${problema.message}` : String(problema)
    console.warn(`[api/export] sesión inválida — ${detalle}`)
    return Response.json(
      { error: 'No hay sesión. Inicia sesión y vuelve a intentarlo.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  try {
    const service = createExportService({
      profiles: createProfilesRepo(supabase),
      categories: createCategoriesRepo(supabase),
      items: createItemsRepo(supabase),
      completions: createCompletionsRepo(supabase),
      chat: createChatRepo(supabase),
      llmSettings: createLlmSettingsRepo(supabase),
    })

    const payload = await service.buildExport(userId, email, new Date())

    // la fecha del nombre en el huso del PERFIL, como el resto de la app: a
    // las 23:30 en Madrid el fichero no debe llamarse como el día siguiente
    // en UTC
    const timezone = (payload as { perfil: { zona_horaria: string } }).perfil.zona_horaria
    const { date } = todayInTimezone(new Date(), timezone)

    // En streaming a propósito: las respuestas no-streaming de Vercel están
    // capadas a 4,5 MB, y la conversación se guarda completa e indefinida —
    // el usuario con más datos sería justo aquel al que le fallaría su
    // descarga RGPD. Las respuestas en streaming están exentas del tope.
    const body = JSON.stringify(payload, null, 2)
    const encoder = new TextEncoder()
    const CHUNK = 1 << 20
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < body.length; i += CHUNK) {
          controller.enqueue(encoder.encode(body.slice(i, i + CHUNK)))
        }
        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="rutia-datos-${date}.json"`,
        // datos personales completos: que ningún intermediario los guarde
        'Cache-Control': 'no-store',
      },
    })
  } catch (problema) {
    const nombre = problema instanceof Error ? problema.name : 'Error'
    const mensaje = problema instanceof Error ? problema.message : String(problema)
    console.error('[api/export]', nombre, mensaje)
    return Response.json(
      { error: 'No se ha podido generar la descarga. Vuelve a intentarlo en un momento.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
