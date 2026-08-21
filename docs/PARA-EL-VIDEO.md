# RutIA — guía para el vídeo

Inventario de tecnologías, configuraciones y decisiones del proyecto, pensado
para preparar la explicación en vídeo. La referencia técnica completa es
[ESPECIFICACION.md](ESPECIFICACION.md); esto es la vista de «qué usé, dónde se
configura y por qué», en orden contable de viva voz.

> **Regla de mantenimiento:** cada feature o configuración nueva añade o
> actualiza su entrada aquí, en la misma PR.

---

## 1. El elevator pitch (30 segundos)

RutIA es un **calendario de rutina semanal recurrente que se gestiona
conversando con una IA**. La semana se repite (no es una agenda de citas):
bloques con franja horaria y recordatorios puntuales, agrupados por categorías
de color. Se puede usar a mano, por chat con tu propia clave de IA (BYOK), o
conectando Claude/ChatGPT por MCP. Tiene panel «Hoy» con checks (el caso
estrella: la medicación), exportación de la semana como lámina PNG, avisos
push a la hora de cada recordatorio, y RGPD en autoservicio (exportar y borrar
la cuenta). Desplegada en producción con capa gratuita de punta a punta.

## 2. El stack y por qué cada pieza

| Pieza | Qué hace en RutIA | Por qué se eligió |
|---|---|---|
| **Next.js 16** (App Router) | Toda la app: páginas servidor, server actions, route handlers, middleware (`proxy.ts`) | Un solo framework para UI + API; render en servidor = los datos nunca se piden desde el navegador |
| **React 19** | UI: `useOptimistic` (checks del panel Hoy), `useTransition`, server components | Viene con Next 16 |
| **Tailwind CSS 4** | Estilos + sistema de temas con variables CSS (5 temas × claro/oscuro) | Utilidades + tokens semánticos (`bg-page`, `text-ink`) validados de contraste |
| **Supabase** | Postgres + Auth + RLS + servidor OAuth + pg_cron/pg_net + Vault | Login resuelto, capa gratuita, y la **RLS como frontera de seguridad demostrable** |
| **Vercel** | Hosting y despliegue automático por push a `main` | Cero infraestructura propia |
| **Zod** | Validación en TODAS las fronteras (formularios, server actions, endpoints, salida del LLM) | «TypeScript en runtime»: nada entra sin validar |
| **Vitest** | ~245 tests unitarios (servicios, validación, endpoints) | Rápido, corre en cada PR (GitHub Actions) |
| **web-push** | Criptografía de los avisos (VAPID + cifrado aes128gcm) | La librería de referencia del protocolo Web Push |
| **html-to-image** | La lámina PNG de la semana, generada en el navegador | Reutiliza la geometría real del calendario: lo exportado es lo que ves |
| **CodeRabbit** | Revisión de IA en cada PR | Segunda red de revisión; gratuito en repos públicos |

**Arquitectura en capas (regla de oro):** UI → server actions / route handlers
→ servicios de dominio → repositorios → Supabase. La UI **nunca** habla
directamente con Supabase ni con la API de IA, y **ninguna consulta se salta
la RLS** (no existe ninguna clave de servicio en el código).

## 3. Las dos puertas de la IA

1. **Chat integrado (BYOK)**: el usuario pega su propia clave de Anthropic,
   OpenAI o Google en Ajustes → IA. Se guarda **cifrada** (AES-256-GCM con un
   secreto que solo vive en el servidor, `LLM_KEY_SECRET`) y no vuelve jamás
   al navegador. El agente funciona con *tool use*: el modelo llama a
   herramientas (crear ítem, mover, vaciar día, marcar hecho…) y los cambios
   se reflejan al momento en el calendario. Coste de inferencia para la app:
   cero.
2. **Modo MCP**: RutIA expone un **servidor MCP** (`/api/mcp`) protegido con
   **OAuth 2.1** — el servidor de autorización es el propio Supabase. El
   usuario conecta Claude (o ChatGPT en modo desarrollador) y gestiona su
   rutina desde ahí, con la suscripción que ya paga. Pantalla de
   consentimiento honesta (avisa de que el token alcanza toda la sesión, no
   solo la rutina) y revocación de accesos dentro de la app.

## 4. Configuraciones manuales (lo que no está en el código)

Cosas que se hicieron una vez en paneles web — importante para el vídeo
porque no se ven en el repo:

### Supabase (dashboard)
- **Migraciones**: `supabase/migrations/0001…0009` ejecutadas **en orden** en
  el SQL Editor (tablas, RLS, funciones, el hook de tokens, el planificador).
- **Hook de tokens**: Authentication → Hooks → *Customize Access Token* →
  activar `mcp_access_token_hook` (añade la audiencia MCP a los tokens OAuth
  y retrasa el `iat` 60 s — apartado 7).
- **Servidor OAuth** activado (para el modo MCP) y **claves de firma
  asimétricas** (ES256).
- **Cuenta demo**: Authentication → Add user (con *Auto Confirm*) +
  `seed_demo_user.sql` — rutina realista re-sembrable; la cuenta está
  blindada por SQL contra borrado y cambio de credenciales.
- **Vault** (secretos dentro de la base de datos): `push_dispatch_url` y
  `push_dispatch_secret`, que usa el planificador de avisos.
- **pg_cron + pg_net**: extensiones que activa la migración 0008; el trabajo
  `rutia-avisos-push` corre **cada minuto** dentro de Postgres.

### Vercel (Settings → Environment Variables)
| Variable | Para qué | ¿Sensitive? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | Conexión a Supabase (públicas por diseño; la seguridad real es la RLS) | No |
| `LLM_KEY_SECRET` | Cifra las claves BYOK de los usuarios | **Sí** |
| `MCP_RESOURCE_URL` | Identidad del servidor MCP (audiencia OAuth) | No |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Identidad del servidor ante los servicios de push | Privada **sí**; pública y subject no |
| `PUSH_DISPATCH_SECRET` | Contraseña entre el cron de la BD y `/api/push/send` | **Sí** |

- Las claves VAPID se generaron una vez con `npx web-push generate-vapid-keys`
  y **no se rotan** (invalidaría todas las suscripciones).
- Regla del proyecto: ningún secreto lleva prefijo `NEXT_PUBLIC_` ni está en
  el repo.

### GitHub
- **CI**: lint + typecheck + tests en cada PR (GitHub Actions).
- **CodeRabbit** instalado en el repo: revisa cada PR (1 revisión/hora en el
  plan gratuito → por eso los pushes van agrupados).
- Flujo: PR pequeña por funcionalidad → revisión → **merge commit** (nunca
  squash) → Vercel despliega solo.

## 5. La PWA y los avisos push (la pieza más "de sistema")

- **Instalable sin tiendas**: manifest + iconos (maskable para Android) +
  aviso de instalación en iOS (Safari no ofrece instalación sola). Sin
  service worker de caché: **offline descartado a propósito** (contenido
  autenticado y dinámico).
- **Avisos**: opt-in por dispositivo desde el panel «Hoy». El circuito:

  ```
  pg_cron (cada minuto, en Supabase)
    → calcula qué recordatorios tocan (huso de CADA usuario, día, minuto)
    → deduplica en push_sent
    → pg_net hace POST a /api/push/send (secreto compartido, Vault)
      → Vercel cifra con web-push (VAPID + aes128gcm)
        → servicio de push del navegador (Google/Mozilla/Apple)
          → el móvil suena, con la app cerrada
  ```

- Decisiones de producto explicables: **solo el título y la hora** en la
  pantalla de bloqueo (el detalle puede llevar datos de salud), **solo
  recordatorios** (un bloque es ambiente, un chip es una alerta), TTL de
  5 minutos (un recordatorio tardío molesta más que ayuda), y el contenido
  viaja cifrado extremo a extremo (Google/Apple ven que llega un aviso, no
  qué dice).

## 6. RGPD en autoservicio (diferencial del proyecto)

- **Textos legales honestos**: política y términos describen lo que el código
  hace HOY (regla de mantenimiento: el inventario de datos sale de las
  migraciones), con un apartado de limitaciones conocidas en vez de
  esconderlas.
- **Exportación (art. 15/20)**: `/api/export` baja un JSON con todo, en
  streaming (la respuesta no-streaming de Vercel capa a 4,5 MB) y con
  lecturas paginadas (PostgREST corta en 1000 filas *sin avisar*).
- **Borrado (art. 17)**: «Borrar mi cuenta» con doble confirmación; una
  función SQL `security definer` que borra `auth.users` en cascada — sin
  parámetros, imposible borrar a otro; rechaza tokens MCP y la cuenta demo.
- **Consentimiento y revocación MCP** dentro de la app.

## 7. Batallas técnicas contables (anécdotas con moraleja)

1. **El desfase de reloj de Supabase**: a rachas, PostgREST rechazaba tokens
   recién emitidos («JWT issued at future», PGRST303) y la primera pantalla
   tras el login moría. Diagnóstico con los logs de Vercel + reproducción en
   Chrome headless. Doble arreglo: reintento del `fetch` (1 s + 2 s) y, de
   raíz, el hook de emisión **retrasa el `iat` 60 s** — verificado contra el
   código fuente de GoTrue que las claims del hook se firman tal cual.
2. **La RLS como frontera real**: el modo MCP reenvía el JWT del usuario a
   PostgRESQL, así que un cliente externo tiene exactamente el mismo alcance
   que el usuario — ninguna clave de servicio en toda la app. La revisión
   adversarial encontró que un token MCP podía llamar al RPC de borrado de
   cuenta saltándose la confirmación: la función SQL ahora rechaza tokens con
   `client_id`.
3. **La cuenta demo compartida**: cualquiera con la contraseña podía borrarla
   o *secuestrarla* cambiando la contraseña (`auth.updateUser` no pide la
   actual). Blindada por SQL: ni borrado ni cambio de credenciales; el seed
   restaura los datos en una ejecución.
4. **El lote de avisos todo-o-nada**: un título con emojis pasa el CHECK de
   Postgres (80 *caracteres*) pero rompía la validación JS (80 *unidades
   UTF-16*) y tumbaba todos los avisos del minuto. Moraleja: dos sistemas
   «midiendo lo mismo» pueden medir cosas distintas.
5. **Calidad con dos redes**: revisión adversarial propia (agentes que
   intentan refutar cada hallazgo ejecutando código) antes de cada push +
   CodeRabbit después. Cada red cazó cosas que la otra no vio.
6. **Verificación de migraciones sin staging**: cada migración se prueba
   contra un **Postgres real embebido (PGlite)** antes de tocar producción —
   cascadas, RLS, el hook, el planificador entero con pg_net simulado.

## 8. Cifras para cerrar

- 9 migraciones SQL, todas con RLS · ~245 tests · 5 temas × 2 modos validados
  de contraste · 33+ PRs revisadas con doble red · coste fijo de
  infraestructura: **0 €** (capas gratuitas de Vercel y Supabase; la
  inferencia la paga cada usuario con su clave o su suscripción).
