<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# RutIA — Guía para agentes de IA

## Proyecto

**RutIA** — rutina semanal recurrente gestionada por un agente de IA. La fuente de verdad es [docs/ESPECIFICACION.md](docs/ESPECIFICACION.md) (*Spec Driven Development*): alcance MoSCoW, modelo de datos, contrato de las 6 herramientas del agente, arquitectura y estructura de carpetas. Cualquier cambio de diseño se refleja primero en la spec.

## Stack

- **Next.js (App Router) + TypeScript estricto** — full-stack en un repo, deploy en Vercel.
- **Tailwind CSS** (+ shadcn/ui opcional) para la UI.
- **Supabase** — Postgres, Auth y RLS (obligatoria en todas las tablas).
- **IA** — API de Anthropic u OpenAI con tool use, detrás de `LLMClient`; servidor MCP propio como segunda puerta (Should).
- **Zod** para validación en todas las fronteras (modelo ↔ servidor ↔ BD).
- **Vitest** (unit) + **Playwright** (E2E); **Sentry** para observabilidad; **CodeRabbit** revisa cada PR.

## Comandos

```bash
npm run dev      # servidor de desarrollo (http://localhost:3000)
npm run build    # build de producción
npm run start    # servir el build
npm run lint     # ESLint
npx tsc --noEmit # typecheck
```

## Arquitectura y reglas

Capas (spec §7.2), sin saltos:

```text
UI (React) → Server Actions / Route Handlers → Servicios (RoutineService · AgentService) → Repositorios (Supabase) / LLMClient
```

- La **UI nunca** habla directamente con Supabase ni con el LLM.
- Los **servicios** contienen la lógica (solapes, recurrencia, checks de hoy, bucle del agente); los **repositorios** encapsulan el acceso a datos.
- Tipos compartidos y esquemas Zod en `src/lib/schemas`.
- El `user_id` **siempre lo pone el servidor** desde la sesión; jamás llega del modelo ni del cliente.
- Las herramientas del agente validan con Zod y comprueban solapes **antes** de escribir; si hay conflicto entre bloques, no se escribe.
- Estructura de carpetas: código bajo `src/` (`app/`, `components/`, `services/`, `repositories/`, `lib/`, `tests/`), migraciones en `supabase/`, E2E en `e2e/` (spec §7.3).
- Trabajo en rama por funcionalidad → Pull Request → revisión (CodeRabbit) + CI → merge. `main` siempre desplegable.

## Definición de hecho

Una tarea está terminada cuando:

1. Cumple lo que pide la spec (o la spec se ha actualizado primero si el diseño cambió).
2. Respeta las capas y las reglas de seguridad de arriba (RLS, Zod, `user_id` de sesión).
3. `npm run lint` y `npx tsc --noEmit` pasan sin errores.
4. La lógica nueva en `services/` tiene tests unitarios (objetivo ≥ 70 % de cobertura en `services/`); los flujos clave de UI tienen E2E cuando aplique.
5. `npm run build` compila y la app arranca en local.
6. La PR describe qué cambia y cómo probarlo.
