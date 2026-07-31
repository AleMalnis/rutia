<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# RutIA — Guía para agentes de IA

## Proyecto

**RutIA** — calendario de rutina semanal recurrente gestionado por un agente de IA (chat integrado + MCP). La fuente de verdad es [docs/ESPECIFICACION.md](docs/ESPECIFICACION.md) (*Spec Driven Development*): alcance MoSCoW, modelo de datos, contrato de las 6 herramientas del agente, arquitectura y estructura de carpetas. **Consúltala antes de implementar.** Cualquier cambio de diseño se refleja primero en la spec.

## Stack

- **Next.js (App Router) + TypeScript estricto** — full-stack en un repo, deploy en Vercel.
- **Tailwind CSS** (+ shadcn/ui opcional) para la UI.
- **Supabase** — Postgres, Auth y RLS (obligatoria en todas las tablas).
- **IA** — API de Anthropic u OpenAI con tool use, detrás de `LLMClient`; servidor MCP propio como segunda puerta (Should).
- **Zod** para validación en todas las fronteras (modelo ↔ servidor ↔ BD).
- **Vitest** (unit) + **Playwright** (E2E); **Sentry** para observabilidad; **CodeRabbit** revisa cada PR.

## Comandos

```bash
npm run dev       # servidor de desarrollo (http://localhost:3000)
npm run build     # build de producción
npm run start     # servir el build
npm run lint      # ESLint
npm test          # unit (Vitest)
npm run typecheck # tsc --noEmit      ← script pendiente de añadir
npm run test:e2e  # E2E (Playwright)  ← pendiente: Playwright sin instalar
```

Los dos últimos aún no existen en `package.json`; hasta entonces el typecheck se ejecuta con `npx tsc --noEmit`.

## Arquitectura y reglas

Capas (spec §7.2), sin saltos:

```text
UI (React) → Server Actions / Route Handlers → Servicios (RoutineService · AgentService) → Repositorios (Supabase) / LLMClient
```

- La **UI nunca** habla directamente con Supabase ni con el LLM.
- Los **servicios** contienen la lógica (solapes, recurrencia, checks de hoy, bucle del agente); los **repositorios** encapsulan el acceso a datos.
- **Toda entrada externa** (formularios, herramientas del agente, respuestas del LLM) se valida con **Zod en la frontera**. Tipos compartidos y esquemas en `src/lib/schemas`.
- El `user_id` **siempre lo pone el servidor** desde la sesión; jamás llega del modelo ni del cliente.
- Las herramientas del agente validan con Zod y comprueban solapes **antes** de escribir; si hay conflicto entre bloques, no se escribe.
- **Secretos solo en el servidor** (variables de entorno); nunca en código de cliente ni en el repo.
- **No desactives reglas de lint ni borres tests** para «hacer que pase»: si algo estorba, coméntalo primero.
- **Idioma:** textos de UI y documentación en español; nombres de código (variables, funciones, tablas) en inglés.
- Estructura de carpetas: código bajo `src/` (`app/`, `components/`, `services/`, `repositories/`, `lib/`, `tests/`), migraciones en `supabase/`, E2E en `e2e/` (spec §7.3).
- Trabajo en rama por funcionalidad → Pull Request → revisión (CodeRabbit) + CI → merge. `main` siempre desplegable.

## Definición de hecho

Una tarea está terminada cuando:

1. Cumple lo que pide la spec (o la spec se ha actualizado primero si el diseño cambió).
2. Respeta las capas y valida las fronteras con Zod, con el `user_id` puesto por el servidor.
3. **Ninguna consulta se salta la RLS:** todo filtra por el usuario autenticado.
4. `npm run build` compila, y lint y typecheck están limpios.
5. Los tests pasan. La lógica nueva en `services/` tiene tests unitarios (objetivo ≥ 70 % de cobertura en `services/`); los flujos clave de UI tienen E2E cuando aplique.
6. La app arranca en local.
7. La PR describe qué cambia y cómo probarlo.
