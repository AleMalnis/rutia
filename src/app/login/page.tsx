'use client'

import Link from 'next/link'
import { Suspense } from 'react'
import { useActionState } from 'react'
import { RedirectDestination, RegisterLink } from '@/components/redirect-destination'
import { login } from './actions'

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(login, null)

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 dark:bg-black">
      <form
        action={formAction}
        className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      >
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Iniciar sesión
        </h1>

        {/* El destino de vuelta vive en la URL (lo pone, por ejemplo, el
            consentimiento del modo MCP). Leerlo obliga a un límite de Suspense,
            así que va aislado: el resto del formulario sigue prerenderizándose
            y no parpadea. El servidor lo valida con safeRedirect. */}
        <Suspense fallback={null}>
          <RedirectDestination />
        </Suspense>

        <label className="block space-y-1">
          <span className="text-sm text-zinc-700 dark:text-zinc-300">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-zinc-700 dark:text-zinc-300">Contraseña</span>
          <input
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="current-password"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>

        {state?.error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isPending ? 'Entrando…' : 'Entrar'}
        </button>

        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          ¿No tienes cuenta?{' '}
          {/* el enlace conserva el destino si lo hay; el fallback es el enlace
              de siempre, así que nunca se ve un hueco */}
          <Suspense
            fallback={
              <Link
                href="/registro"
                className="font-medium text-zinc-900 underline dark:text-zinc-50"
              >
                Regístrate
              </Link>
            }
          >
            <RegisterLink className="font-medium text-zinc-900 underline dark:text-zinc-50" />
          </Suspense>
        </p>

        <p className="space-x-3 text-xs text-zinc-500 dark:text-zinc-400">
          <Link href="/legal/privacidad" className="underline">
            Privacidad
          </Link>
          <Link href="/legal/terminos" className="underline">
            Términos
          </Link>
        </p>
      </form>
    </main>
  )
}
