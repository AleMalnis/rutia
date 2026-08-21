# RutIA

Calendario de **rutina semanal recurrente** que se gestiona conversando con un agente de IA. Los
ítems viven en días de la semana y horas, no en fechas: «gimnasio lunes y miércoles de 19:00 a
20:30» es un solo ítem que se pinta en los dos días.

Dos puertas de entrada, la misma base de datos:

- **Chat integrado** (`/app`): el usuario pega su propia clave de API (Anthropic, OpenAI o Google)
  y conversa dentro de la app. La inferencia corre a su cargo.
- **Modo MCP** (`/api/mcp`): conecta RutIA como servidor MCP a Claude, ChatGPT o tu IDE y gestiona
  la rutina desde allí, con tu propia suscripción.

La especificación completa —el documento que manda sobre el código— está en
[`docs/ESPECIFICACION.md`](docs/ESPECIFICACION.md). Las convenciones para trabajar en el repo, en
[`AGENTS.md`](AGENTS.md).

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # y rellena los valores
npm run dev
```

Necesitas un proyecto de [Supabase](https://supabase.com) (la capa gratuita basta). Ejecuta las
migraciones de `supabase/migrations/` **en orden numérico** desde el SQL Editor del dashboard.

**Avisos push (opcional):** genera las claves VAPID una vez (`npx web-push generate-vapid-keys`)
y un secreto de despacho (`openssl rand -base64 32`). En tu plataforma de despliegue configura
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` y `PUSH_DISPATCH_SECRET`, y en el SQL
Editor crea los dos secretos de Vault con la URL de tu `/api/push/send` y ese mismo secreto
(instrucciones exactas en la cabecera de [`0008_push_scheduler.sql`](supabase/migrations/0008_push_scheduler.sql)).
La migración 0008 se ejecuta **una sola vez y en el orden normal** de migraciones; si ya la
ejecutaste, basta con añadir los secretos de Vault — el planificador los lee en cada tick.
Sin nada de esto configurado, la app funciona igual y la campanita de avisos simplemente no se
ofrece.

**Cuenta de demostración (opcional):** crea un usuario en Authentication → Add user (con *Auto
Confirm*), ajusta el correo en la cabecera de [`supabase/seed_demo_user.sql`](supabase/seed_demo_user.sql)
si usaste otro, y ejecuta ese fichero en el SQL Editor (necesita la migración 0006, que además
blinda la cuenta: ni borrarla ni cambiarle la contraseña o el correo). Siembra una semana realista
con completados recientes. Es re-ejecutable y conviene hacerlo **tras cada sesión de evaluación**:
restaura los datos y elimina lo que el evaluador anterior dejara — incluida su clave de API y su
conversación, que en una cuenta compartida quedan a la vista del siguiente. Para cambiar la
contraseña de la demo legítimamente: quita la marca en el SQL Editor
(`update auth.users set raw_app_meta_data = raw_app_meta_data - 'demo' where email = '…'`),
cámbiala en el dashboard y re-ejecuta el seed.

Variables de entorno: están documentadas una a una en [`.env.example`](.env.example). Ninguna clave
secreta lleva el prefijo `NEXT_PUBLIC_`.

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm run test        # Vitest
```

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

Para revocar el acceso de un cliente, hoy hay que hacerlo desde el dashboard de Supabase o desde el
propio cliente. La pantalla de revocación dentro de la app está pendiente: el SDK ya expone
`listGrants()` y `revokeGrant()`, así que es el siguiente paso natural de esta puerta.

## Licencia

MIT — ver [LICENSE](LICENSE).
