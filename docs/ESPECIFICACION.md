# RutIA — Especificación técnica y de producto

> **Tu semana, organizada conversando.**
> Un calendario de rutina semanal —trabajo, deporte, estudio, medicación, comidas— que se modifica hablando con un agente de IA. Lo recurrente es el corazón de la app.

| Campo | Valor |
|---|---|
| Proyecto | **RutIA** — rutina semanal recurrente gestionada por un agente de IA |
| Versión del documento | 2.4 |
| Licencia | MIT |
| Estado | En desarrollo (v1) |

**Sobre este documento:** es la fuente de verdad del proyecto (*Spec Driven Development*): define visión, alcance, modelo de datos, comportamiento del agente y arquitectura, y sirve como contexto para los asistentes de IA usados durante el desarrollo. Cualquier cambio de diseño se refleja aquí primero.

---

## 1. Visión

Organizar la semana con apps de calendario tradicionales exige formularios, clics y menús, y las apps de hábitos ignoran tu horario real. **RutIA** une ambas cosas: tu **rutina semanal recurrente** siempre visible en un calendario, y a su lado un agente de IA al que simplemente le hablas:

- «Recuérdame la medicación todos los días a las 9:00 y a las 21:00»
- «Gimnasio lunes y miércoles de 19:00 a 20:30»
- «Muéveme el inglés del jueves a la mañana»
- «Los martes ceno pasta y los jueves pescado» *(tu dieta, dictada por ti)*
- «¿Qué me toca hoy?» · «Ya me tomé la pastilla»

El agente interpreta la petición, **modifica la rutina mediante herramientas** (function calling) y el calendario se actualiza en pantalla al instante. También puede **generar una rutina inicial completa** a partir de una descripción libre de tu vida, detectar **conflictos de horario** entre bloques y responder **preguntas** sobre tu semana o tu día.

**Conceptos clave:**
- La rutina es una **plantilla semanal recurrente**: cada ítem vive en uno o varios días de la semana («todos los días», «de lunes a viernes», «L y X»).
- Hay dos tipos de ítem: **bloques** con franja horaria (trabajo 9:00–17:00) y **recordatorios puntuales** a una hora concreta (medicación 9:00), que se muestran como chips sobre el calendario.
- El panel **«Hoy»** lista lo que toca hoy en orden y permite **marcarlo como hecho** (a mano o por chat).
- La semana se puede **exportar como imagen** con diseño limpio: imprímela o ponla de fondo de pantalla.
- **Doble puerta de IA:** chat integrado en la app (vía API) y, como extra, **modo MCP** para gestionar tu rutina desde tu propio Claude, ChatGPT o IDE, con la suscripción que ya pagas.
- **Abierta para todos:** cualquiera la usa registrándose en la URL pública, y cualquier desarrollador puede montarse su propia instancia en ~15 minutos (open source, licencia MIT).

**Propuesta de valor / diferenciación:** no es un chatbot que da consejos ni un calendario más; es tu rutina recurrente cuya interfaz principal es la conversación. La IA no acompaña al producto: **es** el producto.

---

## 2. Alcance (MoSCoW)

### Must — el corazón de la v1
1. Registro e inicio de sesión con email y contraseña (Supabase Auth) + **usuario de prueba** con rutina precargada.
2. Vista de **calendario semanal** (lunes–domingo × horas) con bloques coloreados por categoría y **chips** para los recordatorios puntuales.
3. Ítems con **recurrencia multi-día** (`days[]`): un solo ítem puede vivir en varios días («todos los días», «L-V»).
4. **CRUD manual básico** de ítems desde la UI (crear, editar, borrar) como alternativa al chat.
5. **Chat con el agente** que modifica la rutina mediante herramientas: crear, editar/mover, borrar, vaciar día, creación masiva y marcar completado. Funciona en modo **BYOK multi-proveedor**: cada usuario pega su propia API key (Anthropic, OpenAI o Google) en **Ajustes → IA** y la inferencia corre a su cargo; sin clave configurada, el chat lo explica y ofrece configurarla (o usar el modo MCP cuando exista). No hay clave del servidor: coste de inferencia cero para la app.
6. Cambios del agente **reflejados inmediatamente** en el calendario, con resaltado breve de los ítems afectados.
7. **Generación de rutina inicial** a partir de una descripción libre («trabajo de 9 a 17, gym 3 días, medicación a las 9 y a las 21…»).
8. **Detección de solapes entre bloques**: el agente avisa del conflicto y propone alternativa antes de pisar nada (los recordatorios puntuales no generan conflicto).
9. Panel **«Hoy»**: lista ordenada de lo que toca hoy con **casilla de completado** (imprescindible para medicación); también se marca por chat («ya me la tomé»).
10. **Comidas como ítems de rutina**: el usuario dicta su dieta («los martes ceno pasta») y queda registrada en el detalle del ítem. El agente **no inventa menús ni da consejos médicos o nutricionales**.
11. Persistencia por usuario en Supabase con **RLS** (cada usuario solo ve lo suyo).
12. Diseño **responsive** (uso real desde el móvil, con «Hoy» como vista principal).
13. **Exportación de la semana**: botón que genera una **imagen PNG** de la rutina con diseño limpio (sin interfaz), lista para imprimir o usar de fondo de pantalla, más **vista imprimible** con estilos de impresión del navegador.
14. Desplegado en producción (Vercel) con URL pública.

### Should — segunda oleada, solo con el Must cerrado
- **Modo MCP (v1):** servidor MCP remoto que expone las herramientas sobre `RoutineService`; autorización **OAuth 2.1 con Supabase como servidor de autorización** y pantalla de consentimiento propia; guía de conexión en el README (Claude, ChatGPT, IDEs). Coste de inferencia: cero para la app — el modelo lo pone el cliente del usuario.
- **Instalable por terceros (plug and play):** botón «Deploy with Vercel» en el README y guía de autoinstalación paso a paso (proyecto gratuito de Supabase + ejecutar la migración SQL + 3 variables de entorno, ~15 minutos). Quien se autoinstala pone su propia API key y paga su propio consumo.
- Historial de conversación persistente entre sesiones.
- **Deshacer** el último cambio del agente (snapshot previo de la rutina).
- **Cumplimiento semanal** simple por ítem (p. ej. «Medicación: 6/7 esta semana») y rachas básicas.
- Insights por chat: «¿cuántas horas dedico a estudio?», equilibrio de la semana.
- Export en **formato vertical para móvil** (agenda por días, tamaño de fondo de pantalla) y elección de tema claro/oscuro de la lámina.
- Acciones rápidas: duplicar día, limpiar semana.

### Could — extras si sobra tiempo
- Excepciones para una semana concreta (sin romper la plantilla recurrente).
- Modo MCP avanzado: refresco del calendario **en tiempo real** (Supabase Realtime) mientras chateas desde tu cliente externo, y pantalla de revocación de accesos dentro de la app.
- Validación en vivo de la API key al guardarla (botón «Probar» con una llamada mínima al proveedor).
- Lista de la compra generada desde las comidas que el usuario ha dictado.
- Avisos del navegador mientras la app está abierta (Notification API).
- Exportar en formato calendario (.ics), modo oscuro de la app, PWA instalable, streaming de respuestas.

### Won't — fuera de la v1 (recogidas como líneas futuras)
- Notificaciones push reales en móvil, sugerencia de menús/dietas por IA, integración con Google Calendar, rutinas compartidas/multiusuario, entrada por voz.
- Consumir la **suscripción de consumidor** del usuario (ChatGPT Plus, Claude Pro…) dentro del chat integrado: hoy no existe un mecanismo general para apps de terceros; el **modo MCP es precisamente la alternativa** que lo consigue.

> **Regla de oro:** si algo del *Should* amenaza al *Must*, se corta. La v1 se cierra con un Must impecable, no con un Could a medias.

---

## 3. Historias de usuario

1. Como usuario nuevo, describo mi vida en un mensaje y obtengo una rutina semanal inicial completa.
2. Como usuario, digo «recuérdame la medicación todos los días a las 9 y a las 21» y aparecen los chips en los 7 días.
3. Como usuario, digo «gimnasio lunes y miércoles de 19:00 a 20:30» y se crea un único ítem en ambos días.
4. Como usuario, pido «muéveme el estudio del jueves a la mañana» y el bloque cambia de sitio.
5. Como usuario, pido «elimina todo lo del domingo por la tarde» y el agente confirma antes de borrar en masa.
6. Como usuario, dicto mi dieta («los martes ceno pasta») y el detalle queda visible en el ítem de la cena.
7. Como usuario, pregunto «¿qué me toca hoy?» y el agente me lista el día en orden, sin tocar nada.
8. Como usuario, digo «ya me tomé la pastilla» y el recordatorio de hoy queda marcado como hecho.
9. Como usuario, marco o desmarco a mano cualquier ítem de hoy desde el panel «Hoy».
10. Como usuario, si pido algo que solapa con otro bloque, el agente me avisa y propone alternativas.
11. Como usuario, puedo crear o retocar un ítem a mano sin usar el chat.
12. Como usuario, cierro sesión, vuelvo otro día y mi rutina, mis checks y mi conversación siguen ahí.
13. Como usuario, pulso «Exportar» y descargo mi semana como imagen limpia para imprimirla o ponerla de fondo de pantalla.
14. Como usuario, genero un token en ajustes, añado RutIA como conector MCP en mi Claude o ChatGPT y gestiono mi rutina desde allí con mi propia suscripción.
15. Como desarrollador externo, encuentro el repo en GitHub, pulso «Deploy with Vercel», sigo la guía de autoinstalación y en ~15 minutos tengo mi propia instancia de RutIA con mis claves.

---

## 4. Experiencia de usuario

**Pantallas:**
- `/login` y `/registro` — formularios mínimos, mensaje de error claro.
- `/app` — pantalla única de trabajo:
  - **Escritorio:** calendario semanal (columnas L–D, filas por horas, 06:00–24:00 por defecto) + panel derecho con pestañas **Chat** y **Hoy**.
  - **Móvil:** vista **«Hoy»** como pantalla principal (lista con checks) y calendario semanal deslizable. En v1 el chat comparte el mismo panel de pestañas **Chat**/**Hoy** también en móvil; el panel flotante queda como pulido futuro.
- Primera visita: el agente saluda y ofrece crear la rutina inicial (onboarding conversacional, sin tutorial).

**Detalles de acabado:**
- Los recordatorios puntuales se pintan como **chips** anclados a su hora; los bloques, como tarjetas con altura proporcional a su duración.
- Los ítems recién creados o movidos se resaltan ~2 s: feedback visual inmediato de lo que acaba de hacer el agente.
- Colores por categoría con leyenda: Trabajo, Estudio, Deporte, **Salud**, Comidas, Hogar, Ocio, Descanso (editables). El usuario puede **crear, renombrar y borrar categorías propias**; al borrar una, sus ítems quedan «sin categoría». El color se elige de un **muestrario validado** (8 tonos con par claro/oscuro, contraste y separación para daltonismo comprobados con herramienta, no a ojo): así cualquier categoría se lee bien en ambos modos.
- **Apariencia personalizable**: modo claro/oscuro/automático, un **tema de superficie** entre 5 presets validados de contraste (zinc, pizarra, arena, bosque, uva — cada uno define fondo de página, tarjeta, bordes, tinta y acento vía variables CSS, en claro y oscuro) y **fuente** (sistema, serif o redondeada, autoalojadas con `next/font`). Guardada en `profiles.preferences.appearance`; se aplica solo dentro de `/app` (login/registro quedan en el tema neutro). No hay pickers libres en v1: solo combinaciones que pasan la validación, y los 8 colores de categoría están revalidados contra cada superficie.
- Los ítems muestran su detalle como subtítulo (p. ej. «Cena · Pasta», «Medicación · Enalapril 10 mg»).
- Indicador «pensando…» mientras el agente trabaja; mensajes del agente breves y accionables.
- **Ajustes → IA (BYOK)**: el usuario elige proveedor (Anthropic, OpenAI o Google) y pega su API key. La clave nunca se vuelve a mostrar (solo proveedor y últimos 4 caracteres), se puede reemplazar o borrar, y sin clave el chat muestra un aviso claro con acceso directo a estos ajustes.

**Exportación (lámina):** botón «Exportar» en la cabecera del calendario. Genera una **lámina dedicada** —un componente aparte renderizado fuera de pantalla a resolución fija (p. ej. 1920×1080)— con la semana completa, título y leyenda de categorías, convertida a PNG en el navegador con una librería tipo `html-to-image`. La misma lámina sirve como **vista imprimible** (`@media print`, ocultando chat y paneles). El formato vertical para móvil es la variante del *Should*.

---

## 5. Modelo de datos (Postgres / Supabase)

La rutina es una **plantilla semanal recurrente**: los ítems viven en días-de-la-semana + horas, no en fechas. (Extensión futura: tabla de excepciones por semana.)

| Tabla | Campos principales | Notas |
|---|---|---|
| `profiles` | `id` (= auth.users.id), `display_name`, `timezone`, `preferences jsonb` | Se crea con trigger al registrarse |
| `categories` | `id`, `user_id`, `name`, `color` | Seed de 8 categorías por defecto al crear perfil (incluidas «Salud» y «Comidas») |
| `routine_items` | `id`, `user_id`, `title`, `category_id`, `kind` ('block' \| 'reminder'), `days smallint[]` (0=lunes … 6=domingo), `start_time` (time), `end_time` (time, null si reminder), `detail` (texto corto: plato, dosis…), `notes`, `created_at`, `updated_at` | Check: si `kind='block'` entonces `end_time > start_time`; `days` no vacío |
| `completions` | `id`, `user_id`, `item_id`, `date` (date), `completed_at` | Unique (`item_id`, `date`) — un check por ítem y día |
| `chat_messages` | `id`, `user_id`, `role` ('user' \| 'assistant'), `content`, `tool_calls jsonb`, `created_at` | Historial del chat |
| `llm_settings` | `user_id` (PK, = auth.users.id), `provider` ('anthropic' \| 'openai' \| 'google'), `api_key_encrypted`, `created_at`, `updated_at` | Clave BYOK cifrada (AES-256-GCM con secreto del servidor); una fila por usuario |
| `routine_snapshots` (Should) | `id`, `user_id`, `data jsonb`, `created_at` | Estado previo para «deshacer» |

El modo MCP (§6.5) **no añade tablas**: Supabase guarda los clientes OAuth y las autorizaciones. Sí añade una función de Postgres, el *Custom Access Token Hook*, que inyecta la audiencia MCP en los tokens del flujo OAuth.

**RLS obligatoria en todas las tablas:** política `user_id = auth.uid()` para SELECT/INSERT/UPDATE/DELETE. Sin excepciones.

> **Nota de diseño:** un ítem que ocurre «todos los días» es **una sola fila** con `days=[0,1,2,3,4,5,6]`. Editar su hora es un solo cambio; el calendario lo pinta en cada día de su array. La dieta la escribe el usuario en `detail`; no hay recetario ni generación de menús en la v1.

---

## 6. El agente

### 6.1 Patrón: bucle agéntico con herramientas

1. El usuario envía un mensaje.
2. El servidor construye el contexto: system prompt + **rutina actual completa serializada** (es pequeña, siempre cabe) + estado de los checks de hoy + últimos N mensajes.
3. El LLM responde con texto o con **llamadas a herramientas**.
4. El servidor ejecuta cada herramienta (validación Zod → comprobación de solapes → escritura en BD) y devuelve el resultado al LLM.
5. Se repite hasta que el LLM responde solo texto (máximo **5 rondas** por mensaje, por coste y seguridad).
6. Se devuelve la confirmación al chat y el front **refresca el calendario y el panel «Hoy»**.

**Decisión de diseño:** la rutina se inyecta siempre en el contexto (no hay herramienta de lectura). Así el agente nunca «alucina» IDs y las herramientas son solo de escritura → menos rondas, menos errores, menos coste.

### 6.2 Herramientas (contrato)

| Herramienta | Parámetros | Efecto |
|---|---|---|
| `create_item` | `title, kind ('block'\|'reminder'), days[0-6][], start ("HH:MM"), end? (obligatorio si block), category_id? (UUID de la lista de categorías del contexto), detail?, notes?` | Crea un ítem recurrente |
| `update_item` | `item_id, campos opcionales (title, kind, days, start, end, category_id, detail, notes)` | Edita, mueve o cambia el detalle de un ítem |
| `delete_items` | `item_ids[]` | Borra uno o varios ítems |
| `clear_day` | `day, franja opcional (from, to)` | Quita ese día del array de los ítems afectados; si un ítem se queda sin días, se borra |
| `bulk_create_items` | `items[]` | Rutina inicial o cambios masivos |
| `set_completed` | `item_id, done (bool)` | Marca o desmarca el ítem como hecho **hoy** (la fecha la pone el servidor) |

Reglas comunes de toda herramienta (en el servidor, nunca fiadas al modelo):
- El `user_id` **lo pone el servidor** desde la sesión; el modelo jamás lo envía ni lo ve.
- Validación estricta con Zod (formatos de hora, días 0-6, título ≤ 80 caracteres, `detail` ≤ 120…).
- Comprobación de solapes **solo entre bloques** que compartan algún día: si hay conflicto, la herramienta **no escribe** y devuelve el conflicto para que el agente lo negocie con el usuario. Un recordatorio dentro de un bloque es válido (tomar la pastilla en horario de trabajo es lo normal).
- Toda ejecución se registra (log) para observabilidad.

### 6.3 System prompt (borrador v1 — se itera durante el desarrollo)

```text
Eres RutIA, un asistente que gestiona la rutina semanal recurrente del usuario.
Fecha actual: {{FECHA}} ({{DIA_SEMANA}}). Zona horaria del usuario: {{TIMEZONE}}.

RUTINA ACTUAL DEL USUARIO:
{{RUTINA_SERIALIZADA}}  // ítems con id, kind, days, horas, título, categoría, detail

CATEGORÍAS DISPONIBLES (usa su id como category_id):
{{CATEGORIAS}}  // id y nombre de las categorías del usuario

CHECKS DE HOY:
{{COMPLETADOS_HOY}}  // item_id → hecho / pendiente

REGLAS:
1. Cuando el usuario pida cambios, usa las herramientas. No describas cambios sin ejecutarlos.
2. Usa siempre los `item_id` que aparecen en la rutina actual. Nunca inventes IDs.
3. Horas en formato 24 h. La semana empieza en lunes (day=0). «Todos los días» = days=[0,1,2,3,4,5,6]; «entre semana» = [0,1,2,3,4].
4. Usa kind='reminder' para eventos puntuales (medicación, llamadas, riego…) y kind='block' para franjas con duración.
5. Si una acción borra o modifica 3+ ítems, pide confirmación antes de ejecutar.
6. Si detectas un conflicto de horario entre bloques, no lo pises: explica el choque y propone 1-2 alternativas.
7. Si la petición es ambigua (¿qué días?, ¿qué hora?), haz UNA pregunta corta.
8. Si el usuario dicta su dieta o una dosis, regístrala tal cual en `detail`. No inventes menús, no cambies dosis, no des consejos médicos ni nutricionales; si te los piden, recomienda consultar a un profesional.
9. «¿Qué me toca hoy/ahora?» se responde leyendo la rutina y los checks del contexto, sin herramientas.
10. Cuando el usuario diga que ya hizo algo de hoy, usa set_completed.
11. Al generar una rutina inicial, respeta horas de sueño razonables y reparte con equilibrio.
12. Responde en español, en 1-3 frases, con tono cercano. Tras ejecutar, resume qué has cambiado.
13. Solo gestionas la rutina. Si te piden otra cosa, redirige con amabilidad.
```

### 6.4 Proveedor de IA (puerta A: chat integrado, BYOK multi-proveedor)

- El chat integrado funciona **exclusivamente con la API key del propio usuario** (*bring your own key*): no hay clave del servidor ni coste de inferencia para la app. Sin clave configurada, el chat lo explica con un mensaje claro y ofrece dos salidas: pegar una clave de desarrollador en **Ajustes → IA** (pago por uso contra su cuenta de API) o, cuando exista, el **modo MCP** (§6.5) con su propia suscripción. La suscripción de consumidor (ChatGPT Plus, Claude Pro) NO se puede consumir vía API: eso es exactamente lo que resuelve el modo MCP.
- **Tres proveedores soportados**, cada uno tras la interfaz `LLMClient` (añadir otro = tocar un solo archivo): **Anthropic** (`claude-sonnet-4-6`, Messages API), **OpenAI** (`gpt-5.6-terra`, Responses API) y **Google** (`gemini-2.5-flash`, `generateContent`). Los tres soportan tool use fiable; el modelo por defecto de cada proveedor es una constante del código.
- La clave se guarda **cifrada en reposo** (AES-256-GCM con el secreto de servidor `LLM_KEY_SECRET`), nunca vuelve al navegador (solo proveedor + últimos 4 caracteres), es reemplazable y revocable desde Ajustes y jamás aparece en logs.
- Tope de gasto: el que el usuario tenga configurado en el panel de su proveedor. El rate limit de §8 sigue aplicando: también protege la clave del usuario.

### 6.5 Modo MCP: la segunda puerta (Should)

El **servidor MCP de RutIA** expone las herramientas de `RoutineService` como un adaptador fino (ni una línea de lógica duplicada). El usuario añade RutIA como conector MCP en su cliente (Claude, ChatGPT, su IDE…), autoriza el acceso una vez y gestiona la rutina conversando desde allí — **con su propia suscripción y coste cero de inferencia para la app**.

#### Reparto de papeles

`/api/mcp` es **exclusivamente un servidor de recursos** OAuth 2.1; **Supabase Auth es el servidor de autorización**. RutIA no emite tokens: eso lo hace el servidor OAuth 2.1 de Supabase, cuyos access tokens son JWT del propio proyecto con `sub` = usuario y `role` = `authenticated`.

Esta decisión es la que permite cumplir la regla dura del proyecto («ninguna consulta se salta la RLS») sin coste operativo: el token entrante se reenvía a PostgREST, `auth.uid()` devuelve el usuario real y **las políticas RLS existentes aplican sin cambiar una línea de los repositorios**. En toda la ruta `/api/mcp` no interviene ninguna clave de servicio.

> **Por qué no hay tokens personales.** La versión anterior de esta sección prometía un token personal hasheado generado en ajustes. Se descartó al implementar: un token propio que preserve la RLS tiene que ser un JWT firmado con la clave del proyecto, lo que obligaría a importar y custodiar una clave ES256 (Supabase no permite extraer las suyas); y la alternativa —token opaco más clave de servicio— se salta la RLS. Además los tokens estáticos esquivan el consentimiento y la revocación, que es justo donde vive el control del usuario sobre unas herramientas que **escriben**. Queda anotado en §12.

#### Contrato del endpoint

- **Descubrimiento (RFC 9728, obligatorio).** Se publica el mismo documento de *Protected Resource Metadata* en `/.well-known/oauth-protected-resource/api/mcp` y en `/.well-known/oauth-protected-resource`, con `resource`, `authorization_servers` apuntando al servidor OAuth de Supabase, `scopes_supported` y `bearer_methods_supported`.
- **Validación del token, antes de ejecutar nada:** firma contra el JWKS del proyecto, `iss` exacto, vigencia, `role = authenticated`, `sub` presente y —lo que exige MCP— que la **audiencia** incluya este servidor. Cualquier fallo devuelve `401` con `WWW-Authenticate: Bearer resource_metadata="…"`, nunca un 500 ni un 200 con el error dentro.
- **Audiencia por hook.** Supabase emite `aud: "authenticated"`, que no vale como audiencia de este servidor. Un *Custom Access Token Hook* en Postgres añade la audiencia MCP **solo a los tokens del flujo OAuth** (se distinguen por llevar `client_id`), dejando intactos los de la sesión web. Efecto secundario deseable: un token de sesión web no se puede reutilizar contra `/api/mcp`.
- **Scopes.** Supabase solo admite los cinco scopes OIDC (`openid`, `profile`, `email`, `phone`, `offline_access`) y sus scopes no protegen tablas, así que **los permisos los define la RLS**, no el scope. Anunciar un scope propio rompe el flujo de autorización.
- **Consentimiento.** La pantalla de autorización es nuestra (`/oauth/consent`): muestra qué cliente pide acceso y qué puede hacer, y es la puerta real de entrada porque el registro dinámico de clientes permite que cualquier cliente MCP se registre.
- **Revocación.** Pendiente de UI en la app (`listGrants` / `revokeGrant` del SDK); mientras tanto se revoca desde el dashboard de Supabase o desde el propio cliente. Anotado en §12.

#### Herramientas

Las mismas de §6.2 **más una de lectura** (`get_routine`), que en el chat integrado no existe. La razón está en §6.1: allí la rutina se inyecta en el contexto, así que las herramientas pueden ser solo de escritura y el modelo nunca inventa IDs. Un cliente MCP no recibe esa inyección, y sin lectura tres herramientas (`update_item`, `delete_items`, `set_completed`) serían inutilizables porque exigen identificadores. El «prompt» de esta puerta son las **descripciones de las herramientas**, así que se redactan con el mismo mimo (qué hace cada una, formato de días y horas, cuándo usar `reminder`).

#### Notas de implementación

- **Dos eras del protocolo.** La revisión vigente (`2026-07-28`) es sin estado: sin `initialize`, sin sesiones y sin `ping`, con `server/discover`, `tools/list` y `tools/call`. El endpoint reconoce también las anteriores y rechaza lo desconocido con el error `-32022`. `GET` y `DELETE` responden `405`.

  **Medido en producción (13-08-2026):** Claude declara `2025-11-25`, la era antigua, así que soportarla no es opcional — un servidor que solo hablara la revisión vigente no conectaría. Envía además las cabeceras `MCP-Protocol-Version`, `Mcp-Method` y `Mcp-Name`, que son de la revisión NUEVA, mientras negocia la antigua: está a medio migrar. De ahí que la coincidencia de cabeceras solo se **exija** cuando la era declarada es la moderna; exigirla siempre, o deducir la era de la simple presencia de esas cabeceras, devolvería un `400` en cada llamada de Claude. No sabemos aún qué habla ChatGPT: hasta medirlo, la sonda de diagnóstico (`[mcp-probe]`) se queda.
- Ambas puertas escriben en la misma base de datos; con Supabase Realtime (*Could*) el calendario abierto en la web se refresca en vivo mientras chateas desde tu cliente.

---

## 7. Stack y arquitectura

### 7.1 Stack

| Capa | Tecnología | Por qué |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | Full-stack en un solo repo, ecosistema maduro y despliegue directo en Vercel |
| UI | Tailwind CSS (+ shadcn/ui opcional) | Rapidez y acabado profesional |
| BBDD + Auth | **Supabase** (Postgres, Auth, RLS) | Login resuelto, capa gratuita, RLS = seguridad demostrable |
| IA | API de Anthropic u OpenAI (tool use) + servidor **MCP** propio | Núcleo del proyecto: doble puerta |
| Validación | Zod | Fronteras seguras entre modelo, servidor y BD |
| Testing | Vitest (unit) + Playwright (E2E) | Unit rápidos para servicios y validación; E2E realistas de los flujos clave |
| Observabilidad | Sentry | Errores y rendimiento en producción con capa gratuita |
| Revisión de código | **CodeRabbit** | Revisión con IA de cada PR (resumen, riesgos, sugerencias); gratuito en repositorios públicos |
| CI/CD | GitHub Actions + Vercel | Lint/tests en cada PR, despliegue automático |

### 7.2 Capas (Clean Architecture pragmática)

```mermaid
flowchart LR
    A[UI - React / Next.js] --> B[Server Actions / Route Handlers]
    B --> C[Servicios de dominio\nRoutineService · AgentService]
    C --> D[(Repositorios\nSupabase)]
    C --> E[[LLMClient\nAPI del proveedor de IA]]
    F[[Clientes MCP externos\nClaude · ChatGPT · IDE]] --> G[Servidor MCP - puerta B]
    G --> C
```

- **UI** no habla nunca directamente con Supabase ni con el LLM.
- **Servicios** contienen la lógica: solapes, recurrencia, checks de hoy, ejecución de herramientas, bucle del agente.
- **Repositorios** encapsulan el acceso a datos.
- Tipos compartidos + esquemas Zod en `lib/schemas`.

### 7.3 Estructura de carpetas propuesta

```text
rutia/
├── AGENTS.md                  ← reglas y base de conocimiento para los agentes de IA del IDE
├── CLAUDE.md                  ← puntero a AGENTS.md (Claude Code)
├── docs/
│   └── ESPECIFICACION.md      ← este documento
├── src/
│   ├── app/                   # rutas: login, registro, app
│   │   ├── api/chat/route.ts  # endpoint del agente (puerta A)
│   │   ├── api/mcp/route.ts   # servidor MCP (puerta B, Should)
│   │   ├── .well-known/…      # Protected Resource Metadata (RFC 9728)
│   │   └── oauth/consent/     # pantalla de consentimiento del modo MCP
│   ├── components/            # Calendario, ItemBloque, ItemChip, PanelHoy, Chat, LaminaExport, …
│   ├── services/              # routine.service.ts · agent.service.ts · llm.client.ts
│   ├── repositories/          # items.repo.ts · completions.repo.ts · chat.repo.ts · categories.repo.ts
│   ├── lib/                   # schemas.ts (Zod) · supabase clients · utils
│   └── tests/                 # unit
├── e2e/                       # Playwright
├── supabase/                  # migraciones SQL (tablas + RLS + seed)
├── .github/workflows/ci.yml
├── .env.example
└── README.md
```

---

## 8. Seguridad (mapeo OWASP resumido)

| Riesgo | Mitigación en RutIA |
|---|---|
| Control de acceso roto (A01) | RLS en todas las tablas + sesión verificada en cada server action |
| Secretos expuestos (A02) | Secretos de la app solo en env del servidor; `.env.example` documentado; nada de claves en el cliente ni en Git |
| Clave BYOK del usuario (A02) | Cifrada en reposo (AES-256-GCM, secreto `LLM_KEY_SECRET` solo en env del servidor); write-only hacia el cliente (solo proveedor + últimos 4); revocable desde Ajustes; nunca en logs |
| Inyección (A03) | Consultas vía SDK de Supabase (parametrizadas) + validación Zod de toda entrada |
| Diseño inseguro (A04) | Las herramientas del agente nunca reciben `user_id` del modelo; confirmación para borrados masivos |
| Abuso / coste | Rate limiting por usuario en `/api/chat` (p. ej. 20 mensajes / 5 min) y tope de gasto en el proveedor |
| Prompt injection | El agente solo puede ejecutar las 6 herramientas, siempre sobre los datos del propio usuario; reglas del system prompt + validación servidor |
| Acceso del modo MCP | OAuth 2.1 con Supabase como servidor de autorización: RutIA no emite tokens. `/api/mcp` valida firma, emisor, vigencia y **audiencia** antes de ejecutar nada, y reenvía el JWT del usuario a PostgREST, así que la RLS sigue siendo la frontera (ninguna clave de servicio en esa ruta). El usuario concede acceso en una pantalla de consentimiento y lo revoca cuando quiera |
| Datos sensibles (salud) | La medicación es dato personal: RLS estricta, sin analítica de terceros sobre contenidos, y el usuario puede borrar sus ítems |

---

## 9. Calidad

- **Unit (Vitest):** lógica de solapes multi-día, validaciones Zod, semántica de `clear_day`, idempotencia de `set_completed`, mapeo de tool calls → repositorios, `AgentService` con el LLM **mockeado**. Objetivo orientativo: ≥ 70 % de cobertura en `services/`.
- **E2E (Playwright):** flujo feliz — registro/login → crear ítem manual → enviar mensaje al chat (LLM mockeado o fixture) → el ítem aparece en el calendario → marcar un check en «Hoy».
- **Estática:** ESLint + Prettier + `tsc --noEmit` en CI.
- **Observabilidad:** Sentry en cliente y servidor; log estructurado de cada tool call (herramienta, duración, resultado).
- **Flujo de desarrollo asistido por IA:** el repositorio incluye `AGENTS.md` (stack, comandos, convenciones y definición de hecho) como base de conocimiento para los agentes del IDE, que trabajan contra esta especificación (*spec-driven*). Cada Pull Request recibe además una revisión automática de **CodeRabbit** (resumen, riesgos y sugerencias), cuyos hallazgos se triagean como cualquier revisión humana antes del merge.

---

## 10. CI/CD y despliegue

- **GitHub Actions** en cada push/PR: install → lint → typecheck → tests.
- **Flujo de trabajo:** rama por funcionalidad → Pull Request → revisión automática (CodeRabbit) + checks de CI → merge. `main` se mantiene siempre desplegable.
- **Vercel:** preview automática por PR, producción en `main`. Variables de entorno configuradas en Vercel (LLM) y Supabase (BD).
- Desplegar **desde el primer día** (aunque solo sea el login): la rama `main` siempre tiene una versión funcionando y las sorpresas de despliegue aparecen pronto, cuando son baratas.
- **Distribución open source:** el README incluirá un botón «Deploy with Vercel» (clona el repo a la cuenta del visitante y le pide las variables de entorno) y la guía de autoinstalación. La migración `supabase/migrations/0001_init.sql` y el `.env.example` documentado son las otras dos piezas que lo hacen plug and play.

---

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El agente falla o tarda | CRUD manual como red de seguridad; límite de rondas y timeouts |
| Scope creep | MoSCoW estricto; el *Should* solo se arranca con el *Must* cerrado |
| Coste del LLM | Contexto compacto, máx. 5 rondas, rate limiting, tope de gasto en el proveedor |
| Ámbito salud | La app organiza recordatorios personales que el usuario define; no es un dispositivo médico, no pauta ni ajusta medicación ni dietas. Aviso breve en README y onboarding |
| El export de imagen da guerra (fuentes, tamaños) | Lámina dedicada con estilos simples y resolución fija; librería `html-to-image`; probarlo en cuanto exista el calendario |
| Complejidad del modo MCP | Es *Should* y se apoya en el mismo `RoutineService`; la autorización se delega en el servidor OAuth 2.1 de Supabase, así que RutIA no implementa ningún servidor de autorización (§6.5) |
| Servicios gratuitos | Vercel, Supabase y Sentry tienen capa gratuita suficiente para un despliegue personal |

---

## 12. Nombre y roadmap

- Nombre del proyecto: **RutIA** (rutina + IA). Nombre técnico: `rutia`.
- **Roadmap (líneas futuras):** excepciones semanales, notificaciones push, sugerencia de menús por IA, lista de la compra, estadísticas de hábitos y rachas avanzadas, más formatos de exportación (PDF, tamaños exactos de cada móvil), tiempo real y revocación en la app para el modo MCP, self-hosting completo con docker-compose, Google Calendar, rutinas compartidas, voz, PWA.

### Endurecimientos aplazados conscientemente (deuda técnica registrada)

Señalados por revisión (CodeRabbit, PR #6) y aplazados en v1 por decisión de diseño; se retoman si el uso multi-puerta (web + MCP) los convierte en problema real:

1. **Concurrencia optimista en `updateItem`** — el patrón leer-mezclar-escribir puede perder una edición concurrente sobre el mismo ítem (último en escribir gana). Aplazado: en una app personal la carrera realista es mínima y recuperable. Implementación prevista sin migración: usar `updated_at` como revisión esperada en el `WHERE` del update (`items.repo.update`) y devolver conflicto si afecta 0 filas.
2. **Solapes de bloques reforzados en BD** — dos escrituras simultáneas podrían pasar ambas la comprobación del servicio e insertar bloques solapados. Aplazado: la spec (§6.2) sitúa los solapes en el servicio porque el conflicto es un resultado que el agente negocia, y el agente ejecuta herramientas en secuencia. Implementación prevista: trigger de exclusión por `(user_id, día ∈ days, franja)` en una migración futura, mapeando su error a `reason: 'conflict'`.
3. **Prettier en CI** — §9 lo promete pero aún no está en el repo (ni dependencia ni config). Aplazado: introducirlo exige un formateo inicial de todo el código en un chore dedicado, para no mezclar churn de formato en PRs funcionales. Implementación prevista: `prettier` como devDependency + `format:check` en el workflow de CI entre Lint y Typecheck.
4. **Apariencia: superficies fuera del wrapper** — implementada en §4, pero el tema vive en el `<main>` de `/app`: el `<html>`/`<body>` y el error boundary quedan fuera, así que con un modo forzado contrario al del sistema pueden asomar el color del sistema en el overscroll móvil, la scrollbar raíz y la pantalla de error. Solución prevista si molesta: persistir la apariencia también en una cookie y estampar los data-attrs en el `<html>` desde el layout raíz.
5. **`preferences` es leer-mezclar-escribir no atómico** — con `appearance` como única clave el peor caso es last-write-wins entre pestañas. Al añadir una segunda clave hay que pasar a merge atómico en BD (`preferences = preferences || $1` vía función SQL + rpc). Anotado también en `profiles.repo.ts`.
6. **`24:00` no es editable desde el formulario manual** — `endTimeSchema` acepta `24:00` (la rejilla de §4 llega ahí y Postgres lo admite), pero `<input type="time">` solo llega a 23:59: al abrir un ítem que termine a medianoche, el campo Fin sale vacío y, al ser obligatorio, bloquea el guardado. Sigue siendo latente: el agente (el único camino que podría crear ese valor) normaliza `24:00` → `23:59` en su frontera (`agent.tools.ts`), así que ningún ítem real lo lleva. Si algún día hace falta la medianoche exacta, la opción es la casilla «hasta medianoche» en el formulario.
7. **Una herramienta ya en vuelo no está acotada por el presupuesto** — `/api/chat` corta por tiempo (`AbortSignal` compartido) las peticiones al proveedor —los reintentos de Anthropic y OpenAI se desactivan porque su espera entre intentos ignora el signal— y deja de despachar herramientas nuevas al vencer, pero una escritura de Supabase que ya haya empezado sigue hasta que responda: en el peor caso, una única consulta colgada agota el `maxDuration` de la función. Aplazado: acotarla exige propagar el signal por toda la API de `RoutineService` y los repositorios (supabase-js lo admite con `.abortSignal()` en cada consulta), y el mismo hueco lo tienen las demás rutas, que también consultan sin límite. Implementación prevista: `AbortSignal` opcional en los repositorios y un parámetro de contexto en el servicio, si alguna vez se observa una consulta lenta real.
8. **Tokens personales para el modo MCP, descartados a propósito** — §6.5 los prometía y se retiraron al implementar, no por dejadez: cualquier token propio que preserve la RLS tiene que ser un JWT firmado con la clave del proyecto, y como Supabase no permite extraer las suyas habría que importar y custodiar una ES256 propia (que además podría firmar `role: service_role`, o sea tan sensible como una clave de servicio); la alternativa, token opaco más clave de servicio, se salta la RLS y contradice AGENTS.md. Con OAuth el usuario obtiene lo mismo con consentimiento y revocación reales. Se retomarían si aparece un caso que OAuth no cubra (scripts sin navegador, por ejemplo) y Supabase publica scopes granulares.
9. **Pantalla de revocación del modo MCP, pendiente** — §6.5 promete que el usuario revoca el acceso cuando quiera, y hoy solo puede hacerlo desde el dashboard de Supabase o desde su cliente. Aplazado a propósito para no ampliar la primera entrega, que se despliega como sonda: el SDK ya expone `listGrants()` y `revokeGrant()`, así que es una pantalla de ajustes con una lista y un botón, sin migración ni cambios de dominio.
10. **Dependencia de una beta en la puerta B** — el servidor OAuth 2.1 de Supabase está en beta y no publica política de cambios de ruptura; siendo la entrada de escritura del modo MCP, conviene revisarlo antes de anunciar la integración. Mitigación mientras tanto: `/api/mcp` solo depende de la validación estándar del JWT contra el JWKS, así que un cambio en el flujo de autorización no obliga a tocar el servidor de recursos.
11. **Rate limit del chat sin transacción** — `/api/chat` cuenta filas de `chat_messages` en los últimos 5 minutos antes de escribir (spec §8): dos peticiones simultáneas pueden pasar ambas el conteo y colar un par de mensajes por encima de 20. Aplazado: el exceso realista es de unidades y el tope de gasto vive también en el panel del proveedor. Implementación prevista si hiciera falta: función SQL que cuente e inserte en la misma transacción (o token bucket en BD).
