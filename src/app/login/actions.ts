'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { mapAuthError } from '@/lib/auth-errors'
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

  redirect('/app')
}
