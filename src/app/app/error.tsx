'use client'

// Red de seguridad de /app: si algo se escapa del manejo de errores de las
// server actions, el usuario ve esto y puede reintentar en vez de quedarse
// con la pantalla de error genérica de Next.
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-zinc-50 px-4 text-center dark:bg-black">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        No se pudo cargar tu rutina
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Ha fallado algo al hablar con el servidor. Tus datos están a salvo.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        Reintentar
      </button>
    </main>
  )
}
