'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Decisión del usuario en la pantalla de consentimiento del modo MCP
// (spec §6.5). Se ejecuta con la sesión web del usuario: es Supabase quien
// valida que ese authorization_id le pertenece, así que aquí no hace falta
// (ni se puede) comprobar propiedad por nuestra cuenta.

export type ConsentState = { error: string } | null

async function decide(
  authorizationId: string,
  aprobar: boolean,
): Promise<ConsentState> {
  const supabase = await createClient()

  // skipBrowserRedirect: estamos en el servidor, no hay navegador que redirigir;
  // queremos la URL para hacer el redirect nosotros.
  const { data, error } = aprobar
    ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true })

  if (error != null || data == null) {
    // el mensaje del proveedor no se reenvía: puede contener detalles internos
    console.error('[oauth-consent]', aprobar ? 'approve' : 'deny', error?.name, error?.message)
    return { error: 'No se pudo completar la autorización. Vuelve a intentarlo desde tu cliente.' }
  }

  // fuera del try/catch de arriba a propósito: redirect lanza NEXT_REDIRECT
  redirect(data.redirect_url)
}

export async function approveConsent(authorizationId: string): Promise<ConsentState> {
  return decide(authorizationId, true)
}

export async function denyConsent(authorizationId: string): Promise<ConsentState> {
  return decide(authorizationId, false)
}
