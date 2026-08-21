import type { SupabaseClient } from '@supabase/supabase-js'
import { RepoError } from '@/repositories/items.repo'

// Repositorio de push_subscriptions (spec §4 «Avisos push»): una fila por
// navegador que activó los avisos. El endpoint y las claves funcionan como un
// secreto de entrega: entran una vez y no vuelven enteros al cliente.
// Filtro explícito por user_id sobre la RLS, como el resto.

export type PushSubscriptionRow = {
  endpoint: string
  p256dh: string
  auth: string
}

export function createPushSubscriptionsRepo(supabase: SupabaseClient) {
  return {
    async add(userId: string, subscription: PushSubscriptionRow): Promise<void> {
      const { error } = await supabase.from('push_subscriptions').insert({
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      })
      // el 23505 (endpoint único) sube tal cual en el código: el llamante
      // decide si es «ya estabas suscrito» o «el endpoint es de otro usuario»
      if (error) throw new RepoError(error.message, error.code)
    },

    async removeByEndpoint(userId: string, endpoint: string): Promise<void> {
      const { error } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('user_id', userId)
        .eq('endpoint', endpoint)
      if (error) throw new RepoError(error.message, error.code)
    },

    async listByUser(userId: string): Promise<PushSubscriptionRow[]> {
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('user_id', userId)
      if (error) throw new RepoError(error.message, error.code)
      return (data ?? []) as PushSubscriptionRow[]
    },

    async ownsEndpoint(userId: string, endpoint: string): Promise<boolean> {
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('endpoint')
        .eq('user_id', userId)
        .eq('endpoint', endpoint)
        .maybeSingle()
      if (error) throw new RepoError(error.message, error.code)
      return data != null
    },
  }
}

export type PushSubscriptionsRepo = ReturnType<typeof createPushSubscriptionsRepo>
