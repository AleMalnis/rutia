import { redirectDestinationSchema } from '@/lib/schemas'

// Destino de vuelta tras iniciar sesión (spec §6.5). La validación vive en el
// esquema Zod de `lib/schemas`, como toda entrada de formulario; aquí solo se
// añade el respaldo: un destino inválido no es un error que mostrar al usuario,
// simplemente se le lleva a su calendario.

const DEFAULT_DESTINATION = '/app'

export function safeRedirect(value: unknown): string {
  const parsed = redirectDestinationSchema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_DESTINATION
}
