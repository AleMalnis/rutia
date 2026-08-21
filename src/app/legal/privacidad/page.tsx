import type { Metadata } from 'next'
import Link from 'next/link'
import { CONTACTO, REPOSITORIO, RESPONSABLE } from '@/lib/legal'

// Política de privacidad. Cada afirmación de esta página describe lo que el
// código hace HOY, no lo que sería deseable: el inventario de datos sale de las
// tablas de supabase/migrations, y lo que se envía al proveedor de IA, de
// buildSystemPrompt en agent.service.ts y de readRoutine en mcp.tools.ts.
// Si cambia cualquiera de esos sitios, este texto queda desactualizado.

export const metadata: Metadata = {
  title: 'Política de privacidad — RutIA',
  description: 'Qué datos guarda RutIA, para qué, quién más los trata y cómo ejercer tus derechos.',
}

export default function PrivacidadPage() {
  return (
    <>
      <h1>Política de privacidad</h1>
      <p>
        RutIA es un calendario de rutinas semanales que se gestiona conversando con una IA. Esta
        página explica qué datos guarda, dónde acaban y qué puedes exigir sobre ellos.
      </p>

      <h2>1. Quién trata tus datos</h2>
      <p>
        El responsable del tratamiento es <strong>{RESPONSABLE}</strong>, a título personal. Para
        cualquier asunto relacionado con tus datos, incluido el ejercicio de tus derechos:{' '}
        <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>.
      </p>
      <p>
        RutIA es software libre (licencia MIT) y su código es público en{' '}
        <a href={REPOSITORIO} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        . Si estás usando una copia instalada por otra persona, el responsable es quien la haya
        desplegado, no el autor original.
      </p>

      <h2>2. Qué datos se guardan</h2>
      <p>Todo lo que hay en la base de datos, sin más:</p>
      <ul>
        <li>
          <strong>Cuenta:</strong> tu correo electrónico, la contraseña (guardada como resumen
          criptográfico, nunca en claro), la fecha de registro y las de tus inicios de sesión. Los
          gestiona el servicio de autenticación de Supabase.
        </li>
        <li>
          <strong>Perfil:</strong> un nombre para mostrar (por defecto, la parte de tu correo
          anterior a la arroba), tu zona horaria y tus preferencias de apariencia (modo, tema y
          fuente).
        </li>
        <li>
          <strong>Rutina:</strong> por cada ítem, el título, si es bloque o recordatorio, los días
          de la semana, las horas de inicio y fin, la categoría, un <em>detalle</em> corto y unas{' '}
          <em>notas</em> de texto libre.
        </li>
        <li>
          <strong>Categorías:</strong> nombre y color. Al crear la cuenta se generan ocho por
          defecto, entre ellas «Salud» y «Comidas».
        </li>
        <li>
          <strong>Completados:</strong> qué ítem marcaste como hecho, en qué fecha y a qué hora.
        </li>
        <li>
          <strong>Conversación:</strong> cada mensaje tuyo y cada respuesta del asistente, con las
          herramientas que ejecutó y la fecha.
        </li>
        <li>
          <strong>Clave de API:</strong> si configuras la tuya, se guarda el proveedor elegido y la
          clave <strong>cifrada</strong> (AES-256-GCM con un secreto que solo está en el servidor).
          La base de datos nunca contiene la clave legible.
        </li>
        <li>
          <strong>Accesos del modo MCP:</strong> qué cliente externo autorizaste, cuándo y con qué
          permisos. Los gestiona el servidor OAuth de Supabase.
        </li>
        <li>
          <strong>Suscripciones de avisos:</strong> si activas los avisos en un dispositivo, la
          dirección técnica de entrega y las claves de cifrado que emite tu navegador para ese
          dispositivo — se borran al desactivar los avisos y con la cuenta. Aparte, un registro de
          qué recordatorio ya se avisó y qué día, solo para no avisarte dos veces: ese caduca solo,
          a la semana (borrarlo al desactivar un dispositivo re-avisaría a tus otros dispositivos).
        </li>
      </ul>
      <p>
        RutIA no pide ni deduce tu nombre real, tu teléfono, tu dirección ni tu ubicación, y no
        contiene ninguna herramienta de analítica, medición ni publicidad.
      </p>

      <h2>3. El caso de los datos de salud</h2>
      <p>
        Esto es lo más importante de esta página. Los campos <em>detalle</em> y <em>notas</em> de
        cada ítem son texto libre: nada impide que escribas ahí una medicación con su dosis, una
        cita médica, una pauta de comidas o una condición de salud. Si lo haces, estás
        introduciendo <strong>datos de categoría especial</strong> (artículo 9 del RGPD), que tienen
        una protección reforzada.
      </p>
      <p>
        RutIA no necesita esa información para funcionar y no te la pide en ningún momento. Si la
        escribes, se trata <strong>únicamente</strong> para mostrártela a ti y para enviarla al
        proveedor de IA que tú hayas configurado (apartado 5), sobre la base de tu consentimiento
        al aportarla voluntariamente. Puedes retirarlo borrando o editando ese texto.
      </p>
      <p>
        Si prefieres no tratarla, la app funciona igual sin ella: un ítem puede llamarse
        «Medicación» a las 9:00 y dejar el detalle vacío. La recomendación es escribir lo mínimo que
        te sirva para reconocer el ítem.
      </p>

      <h2>4. Para qué se usan y con qué base legal</h2>
      <ul>
        <li>
          <strong>Prestarte el servicio</strong> (mostrar tu calendario, guardar tus cambios,
          responder en el chat): ejecución del contrato de uso que aceptas al crear la cuenta.
        </li>
        <li>
          <strong>Tratar datos de salud que hayas escrito:</strong> tu consentimiento explícito, que
          das al introducirlos y retiras al borrarlos.
        </li>
        <li>
          <strong>Enviar tu rutina al proveedor de IA:</strong> tu consentimiento, que das al
          configurar tu clave de API. Sin clave, el chat no funciona y nada sale del servidor.
        </li>
        <li>
          <strong>Mantener la app en pie y evitar abusos</strong> (registros de error del servidor,
          límite de 20 mensajes cada 5 minutos): interés legítimo en que el servicio sea seguro y
          sostenible.
        </li>
      </ul>
      <p>
        Tus datos <strong>no</strong> se venden, no se ceden a terceros con fines comerciales, no se
        usan para publicidad ni para elaborar perfiles, y no se usan para entrenar modelos de IA
        propios.
      </p>

      <h2>5. Qué sale de RutIA y hacia dónde</h2>
      <p>
        El chat solo funciona con <strong>tu propia clave de API</strong>. Mientras no la
        configures, ni tu rutina ni tus mensajes salen del servidor. Cuando la configuras, cada vez
        que envías un mensaje se transmite al proveedor que hayas elegido —{' '}
        <strong>Anthropic, OpenAI o Google</strong> — lo siguiente:
      </p>
      <ul>
        <li>tu rutina completa: identificadores, tipo, días, horas, título, categoría y detalle;</li>
        <li>la lista de tus categorías;</li>
        <li>lo que toca hoy, con su estado de completado, y tu zona horaria;</li>
        <li>los últimos 12 mensajes de la conversación, más el que acabas de escribir.</li>
      </ul>
      <p>
        El campo <em>notas</em> <strong>no</strong> se envía en el chat. Tu correo, tu contraseña y
        tu identificador de usuario tampoco: el proveedor no recibe nada que te identifique por
        nombre, aunque el contenido de tu rutina puede identificarte por sí mismo.
      </p>
      <p>
        Lo que ese proveedor haga con lo recibido se rige por sus propias condiciones y por las de
        la cuenta a la que pertenece tu clave, no por esta política. Conviene leerlas: el
        tratamiento se produce en <strong>tu</strong> cuenta con ellos.
      </p>
      <p>
        Si activas los <strong>avisos</strong> en un dispositivo, cada aviso (el título del
        recordatorio y su hora, nunca el <em>detalle</em>) viaja hasta tu navegador a través del
        servicio de push de su fabricante (Google, Mozilla o Apple, según el navegador). Va{' '}
        <strong>cifrado de extremo a extremo</strong>: ese servicio ve que te llega un aviso y
        cuándo, no lo que dice.
      </p>
      <p>
        Si además activas el <strong>modo MCP</strong> y conectas un cliente externo (Claude,
        ChatGPT o tu editor de código), ese cliente puede leer tu rutina completa — esta vez{' '}
        <strong>incluidas las notas</strong> — y crear, editar, borrar y marcar ítems en tu nombre.
      </p>
      <p>
        Sobre eso conviene ser exacto, porque es la parte que más fácil resulta contar de menos: la
        pantalla de consentimiento enumera lo que hacen las herramientas del modo MCP, todas sobre
        tu rutina, pero <strong>el permiso que se entrega no está técnicamente limitado a esa
        lista</strong>. El cliente recibe un token de acceso tuyo con el mismo alcance que tu propia
        sesión, así que, si quisiera, podría llegar también a tu perfil, a tu conversación completa
        del chat y a la fila donde se guarda tu clave de API cifrada — no a la clave en claro, que
        solo se descifra en el servidor. Lo que lo delimita es que cada consulta sigue filtrada por
        tu usuario: nunca alcanza datos de otra persona. Autoriza solo clientes en los que confíes y
        revoca el acceso cuando dejes de usarlo (apartado 9).
      </p>

      <h2>6. Quién más los trata</h2>
      <p>Encargados del tratamiento, es decir, proveedores que tratan los datos por cuenta nuestra:</p>
      <ul>
        <li>
          <strong>Supabase</strong> — base de datos, autenticación y servidor OAuth.
        </li>
        <li>
          <strong>Vercel</strong> — alojamiento de la aplicación y registros técnicos del servidor.
        </li>
        <li>
          <strong>Anthropic, OpenAI o Google</strong> — solo el que tú configures, y solo para
          procesar cada mensaje del chat.
        </li>
        <li>
          <strong>Google, Mozilla o Apple</strong> (el servicio de push de tu navegador) — solo si
          activas los avisos, y solo para entregarlos: ven que te llega un aviso y cuándo, nunca
          su contenido, que viaja cifrado de extremo a extremo (apartado 5).
        </li>
      </ul>
      <p>
        Son empresas con sede en Estados Unidos, así que puede haber transferencias internacionales
        de datos. Se amparan en las garantías que cada proveedor declara en sus propias condiciones
        (cláusulas contractuales tipo y, en su caso, el Marco de Privacidad de Datos UE-EE. UU.).
        Consulta también el apartado 11.
      </p>

      <h2>7. Cuánto tiempo se conservan</h2>
      <p>
        Mientras tengas la cuenta. La conversación del chat <strong>no caduca</strong>: se guarda
        entera y de forma indefinida hasta que se borre la cuenta, aunque en el chat solo se
        muestren y se envíen los mensajes más recientes.
      </p>
      <p>
        Al borrar la cuenta se elimina en cascada todo lo asociado: perfil, rutina, categorías,
        completados, conversación, clave cifrada, accesos concedidos y suscripciones de avisos.
      </p>

      <h2>8. Seguridad</h2>
      <ul>
        <li>
          Cada consulta a la base de datos se filtra por el usuario autenticado mediante seguridad
          a nivel de fila, activada en todas las tablas: aunque una consulta se escribiera mal, la
          base de datos no devolvería filas de otra persona.
        </li>
        <li>Tu clave de API se guarda cifrada y el secreto que la descifra solo existe en el servidor.</li>
        <li>Todo el tráfico va por HTTPS y las contraseñas nunca se guardan en claro.</li>
        <li>
          El modo MCP usa OAuth 2.1 con PKCE y una pantalla de consentimiento propia; ningún cliente
          externo recibe tu contraseña.
        </li>
      </ul>

      <h2>9. Tus derechos</h2>
      <p>
        Puedes ejercer los derechos de acceso, rectificación, supresión, limitación, portabilidad y
        oposición, y retirar tu consentimiento en cualquier momento, escribiendo a{' '}
        <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>. En la práctica:
      </p>
      <ul>
        <li>
          <strong>Rectificación y supresión parcial</strong> las haces tú directamente: editar o
          borrar cualquier ítem, o el texto de un detalle, tiene efecto inmediato.
        </li>
        <li>
          <strong>Acceso y portabilidad</strong> son autoservicio: el enlace «Descargar mis datos»
          al pie de tu calendario baja un fichero JSON con todo lo tuyo — tu correo, el perfil,
          las categorías, la rutina completa con sus notas, el historial de completados, la
          conversación entera y el proveedor de IA elegido. Tres cosas no van en el fichero: la
          clave de API (no sale del servidor en ninguna forma), y las fechas técnicas de
          registro/inicios de sesión y los accesos del modo MCP, que gestiona el servicio de
          autenticación de Supabase — si los necesitas, pídelos por correo. En la app instalada
          de iPhone/iPad la descarga debe hacerse desde Safari: la app instalada no puede guardar
          ficheros.
        </li>
        <li>
          <strong>El borrado de la cuenta</strong> también es autoservicio: «Borrar mi cuenta», al
          pie del calendario, elimina de forma <strong>inmediata e irreversible</strong> la cuenta
          y todo lo asociado — perfil, rutina, categorías, completados, conversación, clave
          cifrada, accesos del modo MCP y suscripciones de avisos. Un matiz honesto sobre esos accesos: ningún cliente
          podrá renovar su acceso, pero un token ya emitido sigue siendo formalmente válido hasta
          su caducidad (una hora como máximo); es inofensivo, porque ya no existen datos que
          consultar. Si lo prefieres, también puedes pedir el borrado por correo. Única excepción:
          la cuenta de demostración pública, que es del responsable y no puede borrarse desde la
          app. Es <strong>compartida</strong>: no escribas en ella datos personales ni claves
          propias — lo que dejes lo verá quien entre después y se elimina en cada restauración
          periódica; si quieres que algo tuyo desaparezca antes, pídelo por correo.
        </li>
        <li>
          <strong>Revocar el acceso de un cliente MCP</strong> también es autoservicio: en
          Ajustes → IA → Conectores, «Accesos concedidos» lista lo autorizado y cada acceso se
          revoca ahí mismo. Al revocar se invalidan las sesiones del cliente y sus tokens de
          renovación — no puede volver a entrar —, aunque un token de acceso ya emitido puede
          seguir valiendo hasta una hora, hasta que caduque. También puedes revocar desde el
          propio cliente.
        </li>
      </ul>
      <p>
        Si crees que tus datos no se están tratando bien, puedes reclamar ante la{' '}
        <a href="https://www.aepd.es" target="_blank" rel="noopener noreferrer">
          Agencia Española de Protección de Datos
        </a>
        .
      </p>

      <h2>10. Cookies y menores</h2>
      <p>
        RutIA solo usa las cookies necesarias para mantener tu sesión abierta. No hay cookies de
        analítica, de publicidad ni de terceros, así que no aparece ningún banner de consentimiento:
        no hay nada que consentir.
      </p>
      <p>
        El servicio no está dirigido a menores de 14 años. Si detectamos una cuenta de un menor de
        esa edad sin consentimiento de quien ejerza su tutela, se eliminará.
      </p>

      <h2>11. Limitaciones que conviene que sepas</h2>
      <p>
        RutIA es un proyecto personal y de código abierto, y esta política prefiere decir lo que
        falta antes que dar por hecho lo que no está:
      </p>
      <ul>
        <li>
          No hay un consentimiento explícito e independiente para los datos de salud, con su propio
          registro: hoy se apoya en que los aportas voluntariamente.
        </li>
        <li>
          El acceso del modo MCP no está acotado por permisos: como se explica en el apartado 5, el
          token entregado alcanza todo lo que alcanza tu propia sesión. Acotarlo exige permisos
          granulares que el servidor de autorización no admite hoy.
        </li>
        <li>
          No se ha revisado formalmente si los acuerdos de tratamiento de los proveedores de
          alojamiento cubren datos de categoría especial. Si esto te preocupa, la recomendación del
          apartado 3 es la respuesta corta: no escribas datos de salud en la app.
        </li>
      </ul>

      <h2>12. Cambios</h2>
      <p>
        Si esta política cambia, se actualizará la fecha del pie. Cuando el cambio afecte a para qué
        se usan tus datos o a quién se envían, se avisará dentro de la app antes de aplicarlo.
      </p>
      <p>
        Ver también los <Link href="/legal/terminos">términos de uso</Link>.
      </p>
    </>
  )
}
