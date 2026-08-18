import Image from 'next/image'
import Link from 'next/link'
import { mcpServerUrl } from '@/lib/mcp/connect'

// Portada pública (spec §4): qué es RutIA en una pantalla, con las puertas a
// registro e inicio de sesión y los textos legales alcanzables desde la raíz.
// Estática a propósito (nada de sesión ni datos): es la página que más veces
// se abre sin cuenta, y en la paleta neutra de login/registro porque la
// apariencia personalizable es de la cuenta, no de la puerta.

function features() {
  // El tramo MCP solo se promete si este despliegue lo ofrece: mismo criterio
  // que la sección del diálogo de IA. En una copia autoinstalada sin
  // MCP_RESOURCE_URL la portada no debe vender lo que sus propios ajustes
  // ocultan. Se evalúa en build (la página sigue estática): activar MCP
  // después exige redeploy, igual que el propio cambio de la variable.
  const withMcp = mcpServerUrl() != null
  return [
    {
      title: 'Tu semana, siempre visible',
      detail:
        'Una rutina semanal recurrente: bloques con horario y recordatorios puntuales, y el panel «Hoy» para marcar lo que vas cumpliendo.',
    },
    {
      title: 'Se organiza conversando',
      // «desde Claude» y no «Claude o ChatGPT»: ChatGPT exige modo
      // desarrollador y la app de Gemini no admite conectores propios (§6.5).
      // La pantalla de conectores da los pasos de cada uno; la portada no
      // promete paridad que no existe.
      detail: `Un agente de IA crea, mueve y borra por ti. Funciona con tu propia clave de API (Anthropic, OpenAI o Google)${withMcp ? ' o conectando RutIA por MCP a Claude, a ChatGPT o a tu editor' : ''}.`,
    },
    {
      title: 'En tu móvil, sin tiendas',
      detail:
        'Instálala desde el navegador y tendrás la app con su icono, a pantalla completa, en Android, iPhone y iPad.',
    },
  ]
}

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 bg-zinc-50 px-6 py-16 dark:bg-black">
      <header className="flex max-w-xl flex-col items-center gap-4 text-center">
        {/* el icono real de la app instalada: la portada no inventa marca */}
        <Image
          src="/icon-192.png"
          alt=""
          width={72}
          height={72}
          priority
          className="rounded-2xl shadow-sm"
        />
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          RutIA
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          Tu semana, organizada conversando.
        </p>
      </header>

      <ul className="grid max-w-3xl gap-4 sm:grid-cols-3">
        {features().map((feature) => (
          <li
            key={feature.title}
            className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {feature.title}
            </h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              {feature.detail}
            </p>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/registro"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Crear cuenta
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"
        >
          Entrar
        </Link>
      </div>

      <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <Link href="/legal/privacidad" className="underline">
          Privacidad
        </Link>
        <Link href="/legal/terminos" className="underline">
          Términos
        </Link>
        <a
          href="https://github.com/AleMalnis/rutia"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Código abierto (MIT)
        </a>
      </footer>
    </main>
  )
}
