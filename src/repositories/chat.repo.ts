import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllPages } from '@/lib/pagination'
import { RepoError } from '@/repositories/items.repo'

// Repositorio de chat_messages (spec §5): historial de la conversación con el
// agente. El filtro explícito por user_id es defensa en profundidad sobre la
// RLS, igual que en el resto de repositorios.

export type ChatRole = 'user' | 'assistant'

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  toolCalls: unknown
  createdAt: string
}

type ChatMessageRow = {
  id: string
  role: ChatRole
  content: string
  tool_calls: unknown
  created_at: string
}

const COLUMNS = 'id, role, content, tool_calls, created_at'

function toMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    toolCalls: row.tool_calls,
    createdAt: row.created_at,
  }
}

export function createChatRepo(supabase: SupabaseClient) {
  return {
    async insert(
      userId: string,
      message: { role: ChatRole; content: string; toolCalls?: unknown },
    ): Promise<ChatMessage> {
      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          user_id: userId,
          role: message.role,
          content: message.content,
          tool_calls: message.toolCalls ?? null,
        })
        .select(COLUMNS)
        .single()
      if (error) throw new RepoError(error.message, error.code)
      return toMessage(data as ChatMessageRow)
    },

    /**
     * La conversación ENTERA, para la exportación de datos (§12.13): la
     * política de privacidad dice que se guarda completa e indefinida, así que
     * el export debe devolverla completa — un export parcial desmentiría a la
     * política justo en lo que promete. Paginada porque PostgREST corta en
     * Max Rows (1000) sin error; el desempate por id hace el orden estable
     * entre páginas.
     */
    async listAll(userId: string): Promise<ChatMessage[]> {
      const rows = await fetchAllPages<ChatMessageRow>(1000, async (from, to) => {
        const { data, error, count } = await supabase
          .from('chat_messages')
          .select(COLUMNS, { count: from === 0 ? 'exact' : undefined })
          .eq('user_id', userId)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
        if (error) throw new RepoError(error.message, error.code)
        return { rows: data as ChatMessageRow[], count }
      })
      return rows.map(toMessage)
    },

    /** Los últimos N mensajes, en orden cronológico (el más antiguo primero). */
    async listRecent(userId: string, limit: number): Promise<ChatMessage[]> {
      const { data, error } = await supabase
        .from('chat_messages')
        .select(COLUMNS)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw new RepoError(error.message, error.code)
      return (data as ChatMessageRow[]).map(toMessage).reverse()
    },

    /**
     * Mensajes del usuario desde un instante dado: la base del rate limit de
     * /api/chat (spec §8, 20 mensajes / 5 min). Contar filas en BD funciona
     * igual en serverless, donde un contador en memoria no sobreviviría.
     */
    async countUserMessagesSince(userId: string, sinceIso: string): Promise<number> {
      const { count, error } = await supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('role', 'user')
        .gte('created_at', sinceIso)
      if (error) throw new RepoError(error.message, error.code)
      return count ?? 0
    },
  }
}

export type ChatRepo = ReturnType<typeof createChatRepo>
