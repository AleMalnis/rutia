'use client'

import { useState, useTransition } from 'react'
import { approveConsent, denyConsent } from '@/app/oauth/consent/actions'

// Formulario de consentimiento del modo MCP (spec §6.5). Enumera en claro lo
// que el cliente podrá hacer: son seis herramientas que ESCRIBEN en la rutina
// del usuario, y esta pantalla es el único control real sobre quién entra.

const PERMISOS = [
  'Ver tu rutina semanal completa, tus categorías y lo que te toca hoy',
  'Crear ítems nuevos, de uno en uno o en lote',
  'Editar, mover o cambiar el detalle de ítems existentes',
  'Borrar ítems y vaciar días enteros',
  'Marcar y desmarcar como hecho lo de hoy',
]

export function ConsentForm({
  authorizationId,
  clientName,
  redirectHost,
  email,
}: {
  authorizationId: string
  clientName: string
  /** Host al que viajará el código. Es el dato que el solicitante no puede fingir. */
  redirectHost: string
  email: string
}) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function decidir(aprobar: boolean) {
    setError(null)
    startTransition(async () => {
      try {
        const result = aprobar
          ? await approveConsent(authorizationId)
          : await denyConsent(authorizationId)
        // solo se llega aquí si NO hubo redirección, es decir, si falló
        if (result?.error) setError(result.error)
      } catch (problema) {
        // un NEXT_REDIRECT no es un fallo: es la salida normal
        if (problema instanceof Error && problema.message === 'NEXT_REDIRECT') throw problema
        setError('No se pudo completar la autorización. Vuelve a intentarlo.')
      }
    })
  }

  return (
    <section className="w-full max-w-md rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
      <h1 className="text-lg font-semibold">Conectar RutIA</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Una aplicación que se identifica como{' '}
        <strong className="text-neutral-900 dark:text-neutral-100">{clientName}</strong> pide acceso
        a tu rutina como <span className="tabular-nums">{email}</span>.
      </p>

      {/* El nombre lo escribe quien registra el cliente: cualquiera puede
          llamarse «Claude». El host de destino sí tiene que ser suyo, así que
          es lo único que el usuario puede comprobar de verdad. */}
      <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-sm dark:border-amber-800 dark:bg-amber-950">
        Ese nombre no está verificado: lo elige la propia aplicación. Si autorizas, el acceso se
        entregará a{' '}
        <strong className="break-all font-mono text-[13px]">{redirectHost}</strong>. Continúa solo
        si reconoces ese destino.
      </p>

      {/* sin eufemismos: el usuario tiene que saber que esto escribe */}
      <p className="mt-4 text-sm font-medium">Si aceptas, podrá:</p>
      <ul role="list" className="mt-1 flex flex-col gap-1 text-sm text-neutral-700 dark:text-neutral-300">
        {PERMISOS.map((permiso) => (
          <li key={permiso} className="flex gap-2">
            <span aria-hidden>·</span>
            {permiso}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
        Podrás revocar este acceso cuando quieras desde el panel de Supabase o desde la propia
        aplicación.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={() => decidir(true)}
          disabled={isPending}
          className="flex-1 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          Autorizar
        </button>
        <button
          type="button"
          onClick={() => decidir(false)}
          disabled={isPending}
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Rechazar
        </button>
      </div>

      {isPending && (
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">Procesando…</p>
      )}
    </section>
  )
}
