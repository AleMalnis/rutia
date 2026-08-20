import { z } from 'zod'
import { FONTS, MODES, THEME_IDS } from '@/lib/appearance'
import { CATEGORY_COLOR_VALUES } from '@/lib/category-colors'
import { LLM_PROVIDER_IDS } from '@/lib/llm-providers'

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

// ── Ítems de rutina (spec §5 y §6.2) ─────────────────────────────────────────

// Día de la semana: 0=lunes … 6=domingo (spec §5).
export const daySchema = z
  .number('El día debe ser un número entre 0 (lunes) y 6 (domingo).')
  .int('El día debe ser un número entero entre 0 y 6.')
  .min(0, 'El día mínimo es 0 (lunes).')
  .max(6, 'El día máximo es 6 (domingo).')

export const daysSchema = z
  .array(daySchema, 'days debe ser un array de días (0-6).')
  .min(1, 'El ítem necesita al menos un día.')
  .max(7, 'Un ítem no puede tener más de 7 días.')
  .refine((days) => new Set(days).size === days.length, 'Hay días repetidos.')

// Hora "HH:MM" en 24 h. Con este formato de ancho fijo, comparar strings
// equivale a comparar horas ('09:00' < '19:30'), y de eso dependen la regla
// end > start y la detección de solapes.
export const timeSchema = z
  .string('La hora es obligatoria.')
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida: usa el formato HH:MM en 24 h.')

// La hora de fin admite además '24:00' (medianoche exacta): la rejilla de la
// spec §4 llega a 24:00 y el tipo time de Postgres lo acepta. La comparación
// lexicográfica sigue valiendo: '24:00' > '23:59'.
export const endTimeSchema = z
  .string('La hora es obligatoria.')
  .regex(
    /^(?:([01]\d|2[0-3]):[0-5]\d|24:00)$/,
    'Hora inválida: usa el formato HH:MM en 24 h.',
  )

// El tipo text de Postgres no admite U+0000: sin este rechazo en la frontera,
// un NUL colado pasaría Zod y reventaría en la BD como error no manejado.
// (String.fromCharCode en lugar de un escape \\u para que ninguna capa de
// tooling convierta el escape en un byte NUL literal dentro de este archivo.)
const NUL_CHAR = String.fromCharCode(0)
const hasNoNul = (value: string) => !value.includes(NUL_CHAR)

// Se comprueba por punto de código y no con un rango en una expresión regular
// para no escribir caracteres de control literales en este archivo.
function hasNoControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

const routineItemFields = {
  title: z
    .string('El título es obligatorio.')
    .trim()
    .min(1, 'El título no puede estar vacío.')
    .max(80, 'El título no puede superar los 80 caracteres.')
    .refine(hasNoNul, 'El título contiene caracteres no válidos.'),
  kind: z.enum(['block', 'reminder'], "kind debe ser 'block' o 'reminder'."),
  days: daysSchema,
  start: timeSchema,
  end: endTimeSchema.nullish(),
  categoryId: z.uuid('categoryId debe ser un UUID.').nullish(),
  detail: z
    .string()
    .trim()
    .max(120, 'El detalle no puede superar los 120 caracteres.')
    .refine(hasNoNul, 'El detalle contiene caracteres no válidos.')
    .nullish(),
  notes: z
    .string()
    .trim()
    .refine(hasNoNul, 'Las notas contienen caracteres no válidos.')
    .nullish(),
}

// Regla cruzada (spec §5): un bloque tiene franja (end > start); un
// recordatorio es puntual y no lleva hora de fin.
function refineKindTimes(
  value: { kind: 'block' | 'reminder'; start: string; end?: string | null },
  ctx: z.RefinementCtx,
) {
  if (value.kind === 'block') {
    if (value.end == null) {
      ctx.addIssue({ code: 'custom', path: ['end'], message: 'Un bloque necesita hora de fin.' })
    } else if (value.end <= value.start) {
      ctx.addIssue({
        code: 'custom',
        path: ['end'],
        message: 'La hora de fin debe ser posterior a la de inicio.',
      })
    }
  } else if (value.end != null) {
    ctx.addIssue({
      code: 'custom',
      path: ['end'],
      message: 'Un recordatorio no lleva hora de fin.',
    })
  }
}

// Datos completos de un ítem (sin id): la frontera de creación, y también la
// validación del resultado de mezclar un ítem existente con un parche.
export const routineItemDataSchema = z.object(routineItemFields).superRefine(refineKindTimes)

export const createRoutineItemSchema = routineItemDataSchema

// Parche de actualización: todos los campos opcionales, al menos uno presente.
// La coherencia kind/end del resultado se valida tras mezclar con el ítem
// actual (routineItemDataSchema), no aquí.
export const updateRoutineItemSchema = z
  .object({
    title: routineItemFields.title.optional(),
    kind: routineItemFields.kind.optional(),
    days: daysSchema.optional(),
    start: timeSchema.optional(),
    end: routineItemFields.end,
    categoryId: routineItemFields.categoryId,
    detail: routineItemFields.detail,
    notes: routineItemFields.notes,
  })
  .refine(
    (patch) => Object.values(patch).some((v) => v !== undefined),
    'El parche no cambia ningún campo.',
  )

export type CreateRoutineItemInput = z.infer<typeof createRoutineItemSchema>
export type UpdateRoutineItemInput = z.infer<typeof updateRoutineItemSchema>

// ── Apariencia (spec §4) ─────────────────────────────────────────────────────

export const appearanceSchema = z.object({
  mode: z.enum(MODES, 'Modo de apariencia no válido.'),
  theme: z
    .string('Elige un tema.')
    .refine((value) => THEME_IDS.includes(value), 'Elige un tema de la lista.'),
  font: z.enum(FONTS, 'Fuente no válida.'),
})

// ── Destino de vuelta tras autenticarse (spec §6.5) ──────────────────────────

/**
 * Ruta interna a la que volver después de iniciar sesión. La usa el flujo OAuth
 * del modo MCP, que manda al usuario a /login y necesita que regrese a la
 * pantalla de autorización.
 *
 * Solo rutas internas: aceptar una URL absoluta convertiría el formulario de
 * login en un redirector abierto, un vector clásico de phishing («inicia
 * sesión en la app de verdad y acabas en el sitio del atacante, ya
 * autenticado»).
 */
export const redirectDestinationSchema = z
  .string('El destino debe ser una ruta.')
  .min(1, 'El destino no puede estar vacío.')
  // Los navegadores ELIMINAN tabuladores y saltos de línea de las URLs antes
  // de resolverlas, así que «/<TAB>/host» se convierte en «//host» —una URL
  // absoluta— y burlaría la comprobación de la barra inicial de abajo.
  .refine(hasNoControlChars, 'El destino contiene caracteres no válidos.')
  .refine((value) => value.startsWith('/'), 'El destino debe ser una ruta interna.')
  // «//host» lo interpreta el navegador como URL absoluta con el esquema
  // actual, y «/\host» lo normalizan igual algunos navegadores.
  .refine(
    (value) => !value.startsWith('//') && !value.startsWith('/\\'),
    'El destino debe ser una ruta interna.',
  )

// ── Clave BYOK (spec §6.4) ───────────────────────────────────────────────────

// Validación laxa a propósito: los formatos de clave cambian por proveedor y
// con el tiempo; la prueba real es la primera llamada. Solo se corta lo
// claramente roto (vacío, gigante, NUL, espacios internos).
export const llmKeyInputSchema = z.object({
  provider: z.enum(LLM_PROVIDER_IDS, 'Elige un proveedor de la lista.'),
  apiKey: z
    .string('Pega tu clave de API.')
    .trim()
    .min(20, 'Esa clave parece demasiado corta.')
    .max(256, 'Esa clave parece demasiado larga.')
    .refine(hasNoNul, 'La clave contiene caracteres no válidos.')
    .refine((value) => !/\s/.test(value), 'La clave no puede contener espacios.'),
})

export type LlmKeyInput = z.infer<typeof llmKeyInputSchema>

// ── Categorías propias (spec §4) ─────────────────────────────────────────────

export const categoryInputSchema = z.object({
  name: z
    .string('El nombre es obligatorio.')
    .trim()
    .min(1, 'El nombre no puede estar vacío.')
    .max(40, 'El nombre no puede superar los 40 caracteres.')
    .refine(hasNoNul, 'El nombre contiene caracteres no válidos.'),
  // solo colores del muestrario validado: garantiza lectura en ambos modos
  color: z
    .string('Elige un color.')
    .refine(
      (value) => CATEGORY_COLOR_VALUES.includes(value),
      'Elige un color del muestrario.',
    ),
})

/**
 * Al editar se admite además el color que YA tenía la categoría, aunque sea
 * heredado de la paleta antigua: si no, renombrarla obligaría a cambiarle el
 * color. Los colores nuevos siguen restringidos al muestrario.
 */
export function categoryUpdateSchema(currentColor: string) {
  return categoryInputSchema.extend({
    color: z
      .string('Elige un color.')
      .refine(
        (value) => value === currentColor || CATEGORY_COLOR_VALUES.includes(value),
        'Elige un color del muestrario.',
      ),
  })
}

export type CategoryInput = z.infer<typeof categoryInputSchema>

// Confirmación del borrado de cuenta (spec §12.13): exactamente «BORRAR».
// El diálogo ya la exige, pero una server action es invocable sin la UI.
export const deleteAccountConfirmationSchema = z.literal('BORRAR')

// Cliente OAuth del modo MCP (spec §12.9): GoTrue identifica cada cliente
// por UUID, y revocar es la única acción que viaja con ese id.
export const mcpClientIdSchema = z.uuid('clientId debe ser un UUID.')

// Entidad completa tal y como sale del repositorio. El user_id no viaja en la
// entidad: lo pone siempre el servidor desde la sesión (spec §6.2).
export type RoutineItem = {
  id: string
  title: string
  kind: 'block' | 'reminder'
  days: number[]
  start: string
  end: string | null
  categoryId: string | null
  detail: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export type Category = {
  id: string
  name: string
  color: string
}
