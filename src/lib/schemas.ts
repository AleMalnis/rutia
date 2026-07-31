import { z } from 'zod'

// Esquemas Zod y tipos compartidos (spec §7.2: validación en todas las
// fronteras; los formularios nunca llegan al servidor sin pasar por aquí).

// Credenciales de email y contraseña para /login y /registro. El mínimo de
// 6 caracteres es el que exige Supabase Auth por defecto.
export const authCredentialsSchema = z.object({
  email: z.email('Introduce un email válido.'),
  password: z
    .string('La contraseña es obligatoria.')
    .min(6, 'La contraseña debe tener al menos 6 caracteres.'),
})

export type AuthCredentials = z.infer<typeof authCredentialsSchema>

// Estado que devuelven las acciones de los formularios de autenticación.
export type AuthFormState = { error?: string; info?: string } | null
