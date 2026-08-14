'use client'

import Link from 'next/link'
import { Suspense } from 'react'
import { useActionState } from 'react'
import { LoginLink, RedirectDestination } from '@/components/redirect-destination'
import { register } from './actions'

export default function RegistroPage() {
  const [state, formAction, isPending] = useActionState(register, null)

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 dark:bg-black">
      <form
        action={formAction}
        className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      >
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Crear cuenta
        </h1>

        {/* igual que en /login: aislado por el límite de Suspense que exige
            leer la URL, y validado en el servidor con safeRedirect */}
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
          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            Contraseña <span className="text-zinc-400">(mínimo 6 caracteres)</span>
          </span>
          <input
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>

        {state?.error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        )}
        {state?.info && (
          <p role="status" className="text-sm text-green-700 dark:text-green-400">
            {state.info}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isPending ? 'Creando cuenta…' : 'Crear cuenta'}
        </button>

        {/* Los textos legales se enlazan aquí, donde se crea la cuenta: es el
            momento en que se aceptan. No hay casilla que marcar, así que el
            aviso tiene que estar a la vista junto al botón. */}
        <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          Al crear la cuenta aceptas los{' '}
          <Link href="/legal/terminos" className="underline">
            términos de uso
          </Link>{' '}
          y la{' '}
          <Link href="/legal/privacidad" className="underline">
            política de privacidad
          </Link>
          . El chat requiere tu propia clave de API, y RutIA no verifica lo que escribas: no
          sustituye a un profesional sanitario.
        </p>

        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          ¿Ya tienes cuenta?{' '}
          <Suspense
            fallback={
              <Link href="/login" className="font-medium text-zinc-900 underline dark:text-zinc-50">
                Inicia sesión
              </Link>
            }
          >
            <LoginLink className="font-medium text-zinc-900 underline dark:text-zinc-50" />
          </Suspense>
        </p>
      </form>
    </main>
  )
}
