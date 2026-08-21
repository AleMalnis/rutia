import { createHash, timingSafeEqual } from 'node:crypto'
import webpush from 'web-push'
import { pushDispatchBatchSchema } from '@/lib/schemas'

// Brazo de ENVÍO de los avisos push (spec §4 «Avisos push», etapa B). Lo
// llama el planificador de la base de datos (pg_cron → pg_net, migración
// 0008) con un secreto compartido. A propósito NO toca la base de datos: los
// payloads llegan ya resueltos, aquí solo se hace la criptografía Web Push
// (aes128gcm + VAPID) y se responde qué suscripciones están muertas para que
// el lado SQL las barra. Ninguna clave de servicio, ninguna consulta.

// comparar resúmenes de longitud fija: timingSafeEqual exige buffers iguales
// de tamaño y el secreto del atacante no tiene por qué medir lo mismo
function safeEquals(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest()
  const hashB = createHash('sha256').update(b).digest()
  return timingSafeEqual(hashA, hashB)
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.PUSH_DISPATCH_SECRET
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  const subject = process.env.VAPID_SUBJECT?.trim()
  if (!secret || !publicKey || !privateKey || !subject) {
    console.error('push/send: faltan PUSH_DISPATCH_SECRET o claves VAPID en el entorno')
    return Response.json({ error: 'sin configurar' }, { status: 503 })
  }

  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ') || !safeEquals(authorization.slice(7), secret)) {
    return Response.json({ error: 'no autorizado' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'cuerpo ilegible' }, { status: 400 })
  }
  const parsed = pushDispatchBatchSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'lote inválido' }, { status: 400 })
  }

  webpush.setVapidDetails(subject, publicKey, privateKey)

  const dead: string[] = []
  let sent = 0
  let failed = 0
  await Promise.allSettled(
    parsed.data.map(async (item) => {
      try {
        await webpush.sendNotification(
          { endpoint: item.endpoint, keys: { p256dh: item.p256dh, auth: item.auth } },
          JSON.stringify({ title: item.title, body: item.body, tag: item.tag }),
          // un recordatorio tardío ya no recuerda nada: 5 minutos y caduca
          { TTL: 300 },
        )
        sent += 1
      } catch (error) {
        const statusCode =
          typeof error === 'object' && error != null && 'statusCode' in error
            ? error.statusCode
            : null
        if (statusCode === 404 || statusCode === 410) {
          // el servicio de push dio la suscripción por desaparecida: el
          // planificador la borrará con esta respuesta
          dead.push(item.endpoint)
        } else {
          failed += 1
        }
      }
    }),
  )

  // solo recuentos: ni endpoints ni contenido en los logs
  console.log(`push/send: ${sent} enviados, ${dead.length} muertos, ${failed} fallidos`)
  return Response.json({ sent, dead, failed })
}
