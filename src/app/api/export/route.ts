import { createClient } from '@/lib/supabase/server'
import { todayInTimezone } from '@/lib/today'
import { createCategoriesRepo } from '@/repositories/categories.repo'
import { createChatRepo } from '@/repositories/chat.repo'
import { createCompletionsRepo } from '@/repositories/completions.repo'
import { createItemsRepo } from '@/repositories/items.repo'
import { createHealthConsentsRepo } from '@/repositories/health-consents.repo'
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
    const { data, error } = await supabase.auth.getClaims()
    // un fallo RECUPERABLE de la dependencia (JWKS o Auth caídos) no es «no
    // tienes sesión»: decirle al usuario que inicie sesión cuando lo roto es
    // el servicio sería mentirle; que reintente en un momento
    if (error != null && data == null && error.name === 'AuthRetryableFetchError') {
      console.error('[api/export]', error.name)
      return Response.json(
        { error: 'No se ha podido verificar la sesión. Vuelve a intentarlo en un momento.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (data == null || typeof data.claims.sub !== 'string') {
      return Response.json(
        { error: 'No hay sesión. Inicia sesión y vuelve a intentarlo.' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    userId = data.claims.sub
    email = typeof data.claims.email === 'string' ? data.claims.email : null
  } catch (caught) {
    // solo la CLASE del error: el mensaje puede incrustar material del token
    // (un error de parseo arrastra trozos de la cookie que lo provocó)
    const name = caught instanceof Error ? caught.name : 'UnknownError'
    console.warn(`[api/export] sesión inválida — ${name}`)
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
      healthConsents: createHealthConsentsRepo(supabase),
    })

    // UN solo instante para el contenido y el nombre: con dos new Date(), un
    // export que cruce la medianoche llevaría fechas distintas dentro y fuera
    const now = new Date()
    const payload = await service.buildExport(userId, email, now)

    // la fecha del nombre en el huso del PERFIL, como el resto de la app: a
    // las 23:30 en Madrid el fichero no debe llamarse como el día siguiente
    // en UTC
    const timezone = payload.perfil.zona_horaria
    const { date } = todayInTimezone(now, timezone)

    // En streaming a propósito: las respuestas no-streaming de Vercel están
    // capadas a 4,5 MB, y la conversación se guarda completa e indefinida —
    // el usuario con más datos sería justo aquel al que le fallaría su
    // descarga RGPD. Las respuestas en streaming están exentas del tope.
    //
    // Se codifica UNA vez y se trocea por BYTES: trocear el string podría
    // partir un par sustituto (un emoji del chat) y codificar cada mitad por
    // separado corrompería el JSON con caracteres de reemplazo.
    const bytes = new TextEncoder().encode(JSON.stringify(payload, null, 2))
    const CHUNK = 1 << 20
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += CHUNK) {
          controller.enqueue(bytes.subarray(i, i + CHUNK))
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
  } catch (caught) {
    const name = caught instanceof Error ? caught.name : 'Error'
    const message = caught instanceof Error ? caught.message : String(caught)
    console.error('[api/export]', name, message)
    return Response.json(
      { error: 'No se ha podido generar la descarga. Vuelve a intentarlo en un momento.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
