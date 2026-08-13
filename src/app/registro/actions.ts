'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { mapAuthError } from '@/lib/auth-errors'
import { safeRedirect } from '@/lib/safe-redirect'
import { authCredentialsSchema, type AuthFormState } from '@/lib/schemas'

export async function register(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = authCredentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Revisa los datos del formulario.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp(parsed.data)
  if (error) {
    return { error: mapAuthError(error.code) }
  }

  // Email ya registrado con la confirmación por correo activada: Supabase
  // devuelve un «éxito» ofuscado con identities vacío en lugar de un error.
  if (data.user && data.user.identities?.length === 0) {
    return { error: mapAuthError('user_already_exists') }
  }

  // Sin confirmación por email hay sesión directa; con ella, solo aviso.
  if (data.session) {
    // mismo destino de vuelta que en /login: un usuario nuevo que llega desde
    // el consentimiento del modo MCP tiene que acabar autorizando, no en /app
    redirect(safeRedirect(formData.get('redirect')))
  }
  return { info: 'Cuenta creada. Revisa tu correo para confirmarla y después inicia sesión.' }
}
