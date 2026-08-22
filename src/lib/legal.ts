// Datos del responsable, compartidos por /legal/privacidad y /legal/terminos.
// Viven en un solo sitio para que las dos páginas no se desincronicen.
//
// IMPORTANTE para quien despliegue su propia copia: si publicas esta app, el
// responsable del tratamiento eres TÚ, no el autor original. Cambia estas
// constantes antes de abrirla a nadie más; el correo tiene que ser uno que
// leas, porque el RGPD obliga a atender por él los derechos del usuario.

export const RESPONSABLE = 'Alejandro Victor Malnis'

/** Canal para ejercer derechos y para cualquier duda de privacidad. */
export const CONTACTO = 'intermalnisalevalor@gmail.com'

export const REPOSITORIO = 'https://github.com/AleMalnis/rutia'

/** Fecha de la última revisión de los textos legales. */
export const ACTUALIZADO = '22 de agosto de 2026'

/**
 * Versión del texto de consentimiento de datos de salud (art. 9, spec
 * §12.12). Se guarda junto a cada consentimiento registrado: si el texto de
 * la casilla o del apartado 3 de la política cambia de forma sustancial, hay
 * que subir esta fecha — los consentimientos antiguos quedan ligados a la
 * versión que el usuario leyó de verdad.
 */
export const HEALTH_CONSENT_VERSION = '2026-08-22'
