import type { Metadata } from 'next'
import Link from 'next/link'
import { CONTACTO, REPOSITORIO, RESPONSABLE } from '@/lib/legal'

// Términos de uso. Igual que la política de privacidad: describe el servicio
// tal como está, con sus límites reales (2000 caracteres por mensaje, 20
// mensajes cada 5 minutos, chat solo con clave propia) y sin prometer
// disponibilidad ni garantías que un proyecto personal no puede sostener.

export const metadata: Metadata = {
  title: 'Términos de uso — RutIA',
  description: 'Condiciones de uso de RutIA: qué es, qué se espera de ti y qué no puedes esperar.',
}

export default function TerminosPage() {
  return (
    <>
      <h1>Términos de uso</h1>
      <p>
        Al crear una cuenta en RutIA aceptas estas condiciones. Están escritas para que se entiendan
        de una lectura; si algo te parece confuso, escribe a{' '}
        <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a> y se aclara.
      </p>

      <h2>1. Qué es RutIA</h2>
      <p>
        Un calendario de rutinas semanales que se organiza conversando con una IA. La semana se
        repite: no es una agenda de citas con fecha, sino la estructura de lo que haces cada lunes,
        cada martes, y así. Puedes añadir bloques con hora de inicio y fin o recordatorios
        puntuales, agruparlos por categorías y marcar lo que vas cumpliendo cada día.
      </p>
      <p>
        Lo desarrolla y opera <strong>{RESPONSABLE}</strong> como proyecto personal. El código es
        libre bajo licencia MIT y está publicado en{' '}
        <a href={REPOSITORIO} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        : puedes leerlo, copiarlo y desplegar tu propia instancia.
      </p>

      <h2>2. RutIA no da consejo médico ni profesional</h2>
      <p>
        Esto no es un formalismo, es la advertencia más importante de esta página. Mucha gente usa
        una rutina para acordarse de una medicación o de una pauta de comidas, y RutIA{' '}
        <strong>no está construida para eso</strong>:
      </p>
      <ul>
        <li>
          <strong>No verifica nada de lo que escribes.</strong> No comprueba dosis, ni horarios, ni
          interacciones entre medicamentos, ni si una pauta tiene sentido. Guarda el texto que le
          des, tal cual.
        </li>
        <li>
          <strong>La IA puede equivocarse.</strong> Puede entender mal lo que le pides, cambiar una
          hora, borrar algo que querías conservar o afirmar cosas que no son ciertas. Revisa el
          calendario después de pedirle cambios: es tu mejor defensa, y para eso está a la vista.
        </li>
        <li>
          <strong>No hay avisos ni notificaciones.</strong> RutIA no te llama, no te suena y no te
          manda nada: solo muestra lo que toca cuando abres la app. No la uses como el único sistema
          que te recuerda algo que no puedes olvidar.
        </li>
      </ul>
      <p>
        Nada de lo que diga la app o su asistente sustituye a un profesional sanitario. Para
        cualquier decisión sobre tu salud, consulta a quien te trata.
      </p>

      <h2>3. Quién puede usarla</h2>
      <p>
        Necesitas tener al menos 14 años. Si eres menor de esa edad, hace falta el consentimiento de
        quien ejerza tu tutela.
      </p>

      <h2>4. Tu cuenta</h2>
      <p>
        Te registras con un correo y una contraseña, y tienes que confirmar el correo antes de
        entrar. Eres responsable de mantener la contraseña a salvo y de lo que se haga desde tu
        cuenta. Si sospechas que alguien tiene acceso, cámbiala y avísanos.
      </p>
      <p>
        Los datos que introduces son tuyos. No se usan para nada que no sea prestarte el servicio;
        el detalle está en la <Link href="/legal/privacidad">política de privacidad</Link>.
      </p>

      <h2>5. Tu clave de API</h2>
      <p>
        El chat funciona con <strong>tu propia clave</strong> de Anthropic, OpenAI o Google. RutIA no
        pone ninguna clave por su cuenta: sin la tuya, el calendario funciona con normalidad pero el
        asistente no responde.
      </p>
      <p>Consecuencias de que la clave sea tuya:</p>
      <ul>
        <li>
          El <strong>consumo lo pagas tú</strong> al proveedor, según sus tarifas. RutIA no cobra
          nada ni intermedia en ese pago.
        </li>
        <li>
          Cada mensaje se procesa en tu cuenta con ese proveedor, así que se le aplican{' '}
          <strong>sus condiciones</strong> además de estas.
        </li>
        <li>
          La clave se guarda cifrada y puedes borrarla cuando quieras. Aun así, la buena práctica es
          usar una clave dedicada a RutIA y con el límite de gasto que te parezca, para poder
          revocarla sin afectar a nada más.
        </li>
      </ul>

      <h2>6. Límites de uso</h2>
      <p>
        Para que el servicio aguante y el gasto no se descontrole, hay topes: un mensaje no puede
        pasar de 2000 caracteres y no se admiten más de 20 mensajes cada 5 minutos. Si los alcanzas,
        el chat te lo dice y basta con esperar. Estos límites pueden ajustarse.
      </p>

      <h2>7. Uso aceptable</h2>
      <p>No uses RutIA para:</p>
      <ul>
        <li>guardar datos de otras personas sin que lo sepan y lo acepten;</li>
        <li>nada ilegal, ni para generar contenido que dañe a alguien;</li>
        <li>
          intentar acceder a datos de otras cuentas, saltarte los límites de uso o tumbar el
          servicio;
        </li>
        <li>revender el acceso o automatizar el uso a una escala que perjudique a los demás.</li>
      </ul>
      <p>
        Buscar fallos de seguridad para avisar de ellos sí es bienvenido: escribe a{' '}
        <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a> antes de hacerlos públicos.
      </p>

      <h2>8. Modo MCP</h2>
      <p>
        Puedes conectar RutIA como servidor MCP a Claude, ChatGPT o tu editor de código. Ese cliente
        podrá leer tu rutina y modificarla en tu nombre, y el acceso que le concedes llega hasta
        donde llega tu propia sesión, no solo hasta las herramientas que enumera la pantalla de
        consentimiento; está explicado en el apartado 5 de la{' '}
        <Link href="/legal/privacidad">política de privacidad</Link>. Autorizar un cliente es tu
        decisión y tu responsabilidad: comprueba antes que es el que crees, porque el nombre que
        muestra lo elige quien lo registró y nadie lo verifica.
      </p>

      <h2>9. Disponibilidad y garantías</h2>
      <p>
        El servicio se ofrece <strong>tal cual</strong>, sin garantía de disponibilidad,
        continuidad, ausencia de errores ni conservación de los datos. Es un proyecto personal
        alojado en servicios de terceros: puede caerse, cambiar o dejar de estar accesible. Si
        alguna vez se cierra, se avisará con la antelación que sea posible.
      </p>
      <p>
        Aunque los datos se guardan en un servicio gestionado con sus propias copias de seguridad,
        no se ofrece ninguna garantía de recuperación. Si tu rutina es importante para ti, guarda
        una copia por tu cuenta.
      </p>

      <h2>10. Responsabilidad</h2>
      <p>
        En la medida en que lo permita la ley, no se asume responsabilidad por daños derivados del
        uso o de la imposibilidad de usar RutIA, ni por pérdida de datos, ni por lo que responda la
        IA, ni por el gasto que generes con tu clave de API. Nada de esto limita los derechos que la
        normativa de consumo te reconozca como consumidor, ni cubre los daños causados por dolo o
        negligencia grave.
      </p>

      <h2>11. Fin del uso</h2>
      <p>
        Puedes dejar de usar RutIA cuando quieras y borrar tu cuenta tú mismo desde «Borrar mi
        cuenta», al pie del calendario: se elimina de inmediato todo lo asociado, sin vuelta
        atrás (única excepción: la cuenta de demostración pública, que es del responsable y no
        puede borrarse desde la app). Si lo prefieres, también puedes pedirlo escribiendo a{' '}
        <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>. Por nuestra parte,
        una cuenta solo se suspende o elimina si incumple el apartado 7, y se te comunicará el
        motivo salvo que hacerlo sea inviable.
      </p>

      <h2>12. Cambios y ley aplicable</h2>
      <p>
        Estas condiciones pueden cambiar; la fecha del pie indica la última revisión y los cambios
        relevantes se avisarán dentro de la app. Se aplica la legislación española, y si eres
        consumidor conservas el derecho a acudir a los tribunales de tu domicilio.
      </p>
      <p>
        Ver también la <Link href="/legal/privacidad">política de privacidad</Link>.
      </p>
    </>
  )
}
