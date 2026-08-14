import Link from 'next/link'
import { ACTUALIZADO } from '@/lib/legal'

// Marco de los textos legales. Son páginas públicas (se leen antes de tener
// cuenta), así que usan la paleta fija de /login y no la apariencia
// personalizable, que vive en las preferencias del perfil.
//
// El estilo de la prosa se aplica una vez aquí con variantes de descendiente:
// repetir clases en cada párrafo de un documento largo enterraría el texto,
// que es lo único que importa revisar en estos ficheros.

export default function LegalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-10 dark:bg-black">
      <main className="w-full max-w-2xl">
        <article
          className="space-y-4 text-sm leading-6 text-zinc-700 dark:text-zinc-300
            [&_a]:font-medium [&_a]:text-zinc-900 [&_a]:underline dark:[&_a]:text-zinc-50
            [&_h1]:mb-1 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-zinc-900 dark:[&_h1]:text-zinc-50
            [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-zinc-900 dark:[&_h2]:text-zinc-50
            [&_li]:mt-1 [&_strong]:font-semibold [&_strong]:text-zinc-900 dark:[&_strong]:text-zinc-50
            [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5"
        >
          {children}
        </article>

        <footer className="mt-10 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <p>Última actualización: {ACTUALIZADO}.</p>
          <p className="mt-2 space-x-3">
            <Link href="/legal/privacidad">Privacidad</Link>
            <Link href="/legal/terminos">Términos</Link>
            <Link href="/login">Iniciar sesión</Link>
          </p>
        </footer>
      </main>
    </div>
  )
}
