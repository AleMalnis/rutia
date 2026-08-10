'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { mapAuthError } from '@/lib/auth-errors'
import { safeRedirect } from '@/lib/safe-redirect'
import { authCredentialsSchema, type AuthFormState } from '@/lib/schemas'

export async function login(
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
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) {
    return { error: mapAuthError(error.code) }
  }

  // Vuelta al destino que trajo al usuario aquí, si era interno. Sin esto, un
  // usuario que llega desde el consentimiento del modo MCP acaba en /app y la
  // autorización se queda colgada esperando un callback que nunca llega.
  redirect(safeRedirect(formData.get('redirect')))
}
