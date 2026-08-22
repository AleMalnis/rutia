# RutIA

## Descripción general

Calendario de **rutina semanal recurrente** que se gestiona conversando con un agente de IA. Los
ítems viven en días de la semana y horas, no en fechas: «gimnasio lunes y miércoles de 19:00 a
20:30» es un solo ítem que se pinta en los dos días. El panel **«Hoy»** lista lo que toca con su
casilla de completado — el caso de uso estrella es no olvidarse de la medicación.

Dos puertas de entrada a la IA, la misma base de datos:

- **Chat integrado** (`/app`): el usuario pega su propia clave de API (Anthropic, OpenAI o Google)
  y conversa dentro de la app. La inferencia corre a su cargo (BYOK: *bring your own key*).
- **Modo MCP** (`/api/mcp`): conecta RutIA como servidor MCP a Claude, ChatGPT o tu IDE y gestiona
  la rutina desde allí, con tu propia suscripción.

Instancia en producción: **<https://rutia-six.vercel.app>**

La especificación completa —el documento que manda sobre el código— está en
[`docs/ESPECIFICACION.md`](docs/ESPECIFICACION.md). Las convenciones para trabajar en el repo, en
[`AGENTS.md`](AGENTS.md).

## Stack tecnológico

| Pieza | Papel en RutIA |
|---|---|
| **Next.js 16** (App Router) | Toda la app: páginas de servidor, server actions, route handlers y middleware. Los datos se cargan en el servidor: el navegador nunca habla con la base de datos |
| **React 19** + **TypeScript** (estricto) | UI con estado optimista en los checks de «Hoy», transiciones y server components |
| **Tailwind CSS 4** | Estilos y sistema de apariencia: 5 temas × claro/oscuro con variables CSS, contraste validado |
| **Supabase** | Postgres + Auth + **RLS** (la frontera de seguridad real), servidor OAuth 2.1 para el modo MCP, `pg_cron`/`pg_net` para los avisos push y Vault para sus secretos |
| **Vercel** | Alojamiento; cada push a `main` despliega solo |
| **Zod** | Validación en todas las fronteras: formularios, server actions, endpoints y respuestas del LLM |
| **Vitest** | ~252 tests unitarios de servicios, validación y endpoints; corren en cada PR (GitHub Actions) |
| **web-push** | Criptografía de los avisos (VAPID + cifrado extremo a extremo) |
| **html-to-image** | La lámina PNG de la semana, generada en el navegador con la geometría real del calendario |

**Arquitectura en capas:** UI → server actions / route handlers → servicios de dominio →
repositorios → Supabase. La UI nunca habla directamente con la base de datos ni con la API de IA,
y ninguna consulta se salta la RLS: no existe ninguna clave de servicio en el código.

## Instalación y ejecución

Requisitos: **Node.js 20 o superior**, npm y una cuenta gratuita de [Supabase](https://supabase.com).

**1. Clona e instala:**

```bash
git clone https://github.com/AleMalnis/rutia.git
cd rutia
npm install
```

**2. Crea un proyecto en Supabase** (la capa gratuita basta) y ejecuta las migraciones de
[`supabase/migrations/`](supabase/migrations/) **en orden numérico** (0001 → 0010) desde el
SQL Editor del dashboard, copiando y pegando cada fichero. Dos de ellas piden un ajuste antes de
ejecutarse; lo indica su cabecera (la 0004 lleva tu dominio y la 0008 usa secretos de Vault).

**3. Configura las variables de entorno:**

```bash
cp .env.example .env.local   # y rellena los valores
```

Cada variable está documentada una a una en [`.env.example`](.env.example). Para arrancar en local
bastan las dos de Supabase (URL y anon key, en Project Settings → API) y un `LLM_KEY_SECRET`
aleatorio; el resto son opcionales. Ninguna clave secreta lleva el prefijo `NEXT_PUBLIC_`.

**4. Arranca:**

```bash
npm run dev
```

Abre <http://localhost:3000>, regístrate (pide confirmar el correo) y ya estás dentro. Para
verificar el proyecto:

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm run test        # Vitest
npm run build       # build de producción
```

### Opcional: cuenta de demostración

Crea un usuario en Authentication → Add user (con *Auto Confirm*), ajusta el correo en la cabecera
de [`supabase/seed_demo_user.sql`](supabase/seed_demo_user.sql) si usaste otro, y ejecuta ese
fichero en el SQL Editor (necesita la migración 0006, que además blinda la cuenta: ni borrarla ni
cambiarle la contraseña o el correo). Siembra una semana realista con completados recientes. Es
re-ejecutable y conviene hacerlo **tras cada sesión de evaluación**: restaura los datos y elimina
lo que el evaluador anterior dejara — incluida su clave de API y su conversación, que en una
cuenta compartida quedan a la vista del siguiente. Para cambiar la contraseña de la demo
legítimamente: quita la marca en el SQL Editor
(`update auth.users set raw_app_meta_data = raw_app_meta_data - 'demo' where email = '…'`),
cámbiala en el dashboard y re-ejecuta el seed.

### Opcional: avisos push

Genera las claves VAPID una vez (`npx web-push generate-vapid-keys`) y un secreto de despacho
(`openssl rand -base64 32`). En tu plataforma de despliegue configura `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` y `PUSH_DISPATCH_SECRET`, y en el SQL Editor crea los dos
secretos de Vault con la URL de tu `/api/push/send` y ese mismo secreto (instrucciones exactas en
la cabecera de [`0008_push_scheduler.sql`](supabase/migrations/0008_push_scheduler.sql)). La
migración 0008 se ejecuta **una sola vez y en el orden normal**; si ya la ejecutaste, basta con
añadir los secretos de Vault — el planificador los lee en cada tick. Sin nada de esto configurado,
la app funciona igual y la campanita de avisos simplemente no se ofrece.

### Opcional: modo MCP

La activación completa (migración 0004, `MCP_RESOURCE_URL` y el dashboard de Supabase) está en la
sección [Modo MCP](#modo-mcp).

## Estructuración

```text
rutia/
├── docs/ESPECIFICACION.md     ← la especificación: el documento que manda sobre el código
├── AGENTS.md                  ← convenciones del repo (capas, RLS, validación, idioma)
├── src/
│   ├── app/                   # rutas de Next (App Router)
│   │   ├── page.tsx           #   portada pública
│   │   ├── login/ registro/   #   autenticación
│   │   ├── app/               #   la pantalla de trabajo (calendario + Hoy + chat) y sus server actions
│   │   ├── api/chat/          #   endpoint del agente (puerta A, BYOK)
│   │   ├── api/mcp/           #   servidor MCP (puerta B, OAuth 2.1)
│   │   ├── api/export/        #   exportación de datos (RGPD art. 15/20)
│   │   ├── api/push/send/     #   brazo de envío de los avisos (lo llama pg_cron)
│   │   ├── oauth/consent/     #   pantalla de consentimiento del modo MCP
│   │   ├── .well-known/…      #   metadatos OAuth (RFC 9728)
│   │   ├── legal/             #   política de privacidad y términos
│   │   └── manifest.ts        #   manifest de la PWA
│   ├── components/            # React: calendario, panel Hoy, chat, diálogos, lámina PNG…
│   ├── services/              # lógica de dominio: rutina, agente, export, cifrado BYOK
│   ├── repositories/          # acceso a datos, una tabla por fichero
│   ├── lib/                   # esquemas Zod, clientes de Supabase, utilidades
│   ├── proxy.ts               # middleware: refresco de sesión y protección de /app
│   └── tests/                 # unitarios (Vitest)
├── supabase/
│   ├── migrations/            # 0001…0010: tablas, RLS, funciones, hook de tokens, planificador
│   └── seed_demo_user.sql     # cuenta de demostración re-sembrable
└── public/                    # iconos PWA y service worker de avisos (sw.js)
```

**Capas** (de fuera hacia dentro): la **UI** solo llama a server actions o route handlers; estos
validan la entrada con Zod y delegan en los **servicios de dominio** (solapes, recurrencia,
consentimientos, el bucle del agente); los servicios usan **repositorios**, que son el único
código que toca Supabase — siempre con el token del usuario, de modo que la **RLS** filtra cada
consulta por quien la hace.

## Funcionalidades

- **Calendario semanal recurrente** (L–D × horas) con bloques de franja y recordatorios
  puntuales, categorías de color editables y detección de solapes entre bloques.
- **Panel «Hoy»**: lo que toca hoy en orden, con casilla de completado optimista y barra de
  progreso; también se marca por chat («ya me la tomé»).
- **CRUD manual completo** de ítems y categorías, como alternativa al chat.
- **Agente por chat (BYOK multi-proveedor)**: crea, mueve, borra, vacía días, creación masiva y
  generación de la rutina inicial desde una descripción libre. La clave del usuario se guarda
  cifrada (AES-256-GCM) y no vuelve jamás al navegador.
- **Modo MCP**: servidor MCP propio protegido con OAuth 2.1, pantalla de consentimiento honesta y
  **revocación de accesos dentro de la app** (Ajustes → IA → Conectores).
- **PWA instalable sin tiendas** y **avisos push**: opt-in por dispositivo, un planificador
  `pg_cron` dentro de la base de datos dispara cada recordatorio a su hora en el huso de cada
  usuario, con el contenido cifrado de extremo a extremo.
- **Exportación de la semana como lámina PNG** (clara u oscura, con los colores y la fuente del
  usuario) y vista imprimible.
- **RGPD en autoservicio**: exportación de todos los datos en JSON (art. 15/20), borrado total de
  la cuenta con doble confirmación (art. 17) y **consentimiento explícito y auditable para datos
  de salud** (art. 9), exigido en las tres puertas de escritura.
- **Apariencia personalizable**: 5 temas de superficie × claro/oscuro/auto y 3 fuentes, todos
  validados de contraste.
- **Cuenta de demostración** re-sembrable y blindada, para evaluar sin registrarse.

## Modo MCP

`/api/mcp` es un **servidor de recursos OAuth 2.1**: no emite tokens. Los emite el servidor OAuth de
Supabase, y RutIA los valida contra el JWKS del proyecto y los reenvía a la base de datos, de forma
que la *Row Level Security* sigue siendo la frontera de seguridad. Ninguna clave de servicio
interviene en esa ruta.

### Activación (una sola vez)

**1. Migración.** Abre `supabase/migrations/0004_mcp_access_token_hook.sql`, cambia la URL del
`insert` por la de tu dominio (`https://TU-DOMINIO/api/mcp`) y ejecútalo en el SQL Editor.

**2. Variable de entorno.** Añade `MCP_RESOURCE_URL` con **exactamente** esa misma URL, en local y
en tu plataforma de despliegue. Si no coincide con la de la migración, los tokens se rechazarán con
un 401 y el motivo no se ve desde el cliente.

**3. Dashboard de Supabase → Authentication:**

| Dónde | Qué |
|---|---|
| OAuth Server | Activarlo (está en beta) |
| OAuth Server → Authorization Path | `/oauth/consent` |
| OAuth Server → Dynamic Client Registration | Activarlo. Es imprescindible para ChatGPT, que no admite credenciales pegadas a mano |
| Hooks → Customize Access Token | Activar y apuntar a `public.mcp_access_token_hook` |
| URL Configuration → Site URL | Tu dominio de producción |

> El registro dinámico permite que **cualquier** cliente MCP se registre, así que la pantalla de
> consentimiento es el control real: solo autoriza clientes que reconozcas.

**4. Despliega** y comprueba que los metadatos responden:

```bash
curl https://TU-DOMINIO/.well-known/oauth-protected-resource
```

Debe devolver un JSON con `resource` y `authorization_servers`.

### Conectar un cliente

En **Claude** (Settings → Connectors → Add custom connector) o en tu **IDE**, añade la URL
`https://TU-DOMINIO/api/mcp`. El cliente descubre solo el servidor de autorización, te lleva a la
pantalla de consentimiento y a partir de ahí funciona.

En Claude también sirve un enlace que abre el diálogo con la URL ya puesta, para no copiarla a mano:

```
https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=RutIA&connectorUrl=https%3A%2F%2FTU-DOMINIO%2Fapi%2Fmcp
```

Sustituye `TU-DOMINIO` codificado (`%2F` son las barras). Para la instancia pública:
[**Conectar RutIA a Claude**](https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=RutIA&connectorUrl=https%3A%2F%2Frutia-six.vercel.app%2Fapi%2Fmcp).
El enlace solo rellena el formulario: sigue habiendo que confirmar y pasar por el consentimiento.

**No todos los clientes lo admiten igual** (comprobado en agosto de 2026; esto cambia cada pocos
meses, así que conviene reverificarlo antes de fiarse):

| Cliente | ¿Conector MCP propio? | Cómo |
|---|---|---|
| **Claude** (web y escritorio) | Sí | Settings → Connectors → Add custom connector, o el enlace de un clic de arriba |
| **ChatGPT** | Sí, con *modo desarrollador* | Ajustes → Apps → Ajustes avanzados → «Modo desarrollador». **Solo en la web**, no en la app móvil; planes Plus, Pro, Business, Enterprise o Edu. En cuentas de empresa un administrador debe permitirlo antes. Con el modo desarrollador activo, las **escrituras funcionan** |
| **IDEs y CLIs** (VS Code, Cursor, Claude Code, Gemini CLI…) | Sí | La URL en su configuración de servidores MCP |
| **App de Gemini** (chat de consumo) | **No** | Solo acepta conectores propios dentro de tareas de *Spark*, o en Gemini Enterprise. Para el chat de Gemini normal, la vía es el chat integrado de RutIA con una clave de API de Google (BYOK) |

### Herramientas expuestas

`get_routine` (lectura, para obtener los identificadores), `create_item`, `update_item`,
`delete_items`, `clear_day`, `bulk_create_items` y `set_completed`. Las descripciones que ve el
cliente son el único «prompt» de esta puerta, así que están redactadas con ese cuidado.

Cada una viaja con título y anotaciones (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
`openWorldHint`) para que el cliente sepa a qué pedir confirmación. Se declaran con precisión, no
en bloque: `get_routine` es de solo lectura y crear no destruye nada; van marcadas como
destructivas `update_item`, `delete_items`, `clear_day` y también `set_completed`, porque
desmarcar un completado elimina un registro que existía.

El acceso de un cliente se revoca **dentro de la app** (Ajustes → IA → Conectores → «Accesos
concedidos»), y también desde el propio cliente.

## Licencia

MIT — ver [LICENSE](LICENSE).
