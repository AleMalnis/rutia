// Traduce los códigos de error de Supabase Auth a mensajes claros en español
// (spec §4: «formularios mínimos, mensaje de error claro»). El mensaje por
// defecto no filtra detalles internos.

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Email o contraseña incorrectos.',
  email_not_confirmed: 'Confirma tu correo antes de iniciar sesión.',
  user_already_exists: 'Ya existe una cuenta con este email. Inicia sesión.',
  email_exists: 'Ya existe una cuenta con este email. Inicia sesión.',
  // Zod ya bloquea menos de 6 caracteres: si el servidor devuelve
  // weak_password es por una política más estricta (longitud, filtradas…)
  weak_password: 'La contraseña no cumple los requisitos de seguridad: prueba una más larga y menos común.',
  over_request_rate_limit: 'Demasiados intentos. Espera un momento y vuelve a probarlo.',
  over_email_send_rate_limit: 'Demasiados intentos. Espera un minuto antes de volver a probarlo.',
  signup_disabled: 'El registro está desactivado en este momento.',
}

export function mapAuthError(code: string | undefined): string {
  return (
    (code && MESSAGES[code]) ||
    'No se pudo completar la operación. Inténtalo de nuevo.'
  )
}
