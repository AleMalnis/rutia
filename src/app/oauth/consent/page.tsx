import { redirect } from 'next/navigation'
import { ConsentForm } from '@/components/consent-form'
import { createClient } from '@/lib/supabase/server'

// Pantalla de consentimiento del modo MCP (spec §6.5). Supabase manda aquí al
// usuario durante el flujo OAuth, y esta pantalla es la PUERTA REAL: como el
// registro dinámico permite que cualquier cliente MCP se registre, lo único
// que decide si entra o no es que el usuario lo autorice a conciencia.
//
// Por eso enumera en claro lo que el cliente podrá hacer, sin eufemismos: son
// herramientas que escriben en su rutina.

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const raw = params.authorization_id
  const authorizationId = typeof raw === 'string' ? raw : undefined

  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()

  // Sin sesión no hay nada que autorizar: al login, y que vuelva aquí después
  // con los mismos parámetros.
  if (claims == null || typeof claims.claims.sub !== 'string') {
    const destino = authorizationId
      ? `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`
      : '/oauth/consent'
    redirect(`/login?redirect=${encodeURIComponent(destino)}`)
  }

  if (!authorizationId) {
    return (
      <Aviso titulo="Falta la solicitud de autorización">
        Esta página se abre desde tu cliente de IA al conectar RutIA. Vuelve a intentarlo desde
        allí.
      </Aviso>
    )
  }

  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId)

  if (error != null || data == null) {
    console.error('[oauth-consent] details', error?.name, error?.message)
    return (
      <Aviso titulo="Esta solicitud ya no es válida">
        Puede haber caducado o haberse usado ya. Vuelve a iniciar la conexión desde tu cliente.
      </Aviso>
    )
  }

  // Si ya había consentido antes, Supabase devuelve directamente la redirección
  // en vez de los detalles: no hay nada que preguntar.
  if (!('authorization_id' in data)) {
    redirect(data.redirect_url)
  }

  // El nombre del cliente lo elige quien lo registra, así que no identifica a
  // nadie: con el registro dinámico abierto, cualquiera puede llamarse
  // «Claude». El único dato que el atacante NO controla libremente es a dónde
  // viajará el código, porque tiene que ser una URL suya. Se muestra el host
  // para que el usuario tenga algo real con lo que decidir.
  let destino: string
  try {
    destino = new URL(data.redirect_uri).host
  } catch {
    destino = data.redirect_uri
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <ConsentForm
        authorizationId={data.authorization_id}
        clientName={data.client.name ?? 'Un cliente sin nombre'}
        redirectHost={destino}
        email={data.user.email}
      />
    </main>
  )
}

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-lg font-semibold">{titulo}</h1>
      <p className="max-w-sm text-sm text-neutral-600 dark:text-neutral-400">{children}</p>
    </main>
  )
}
