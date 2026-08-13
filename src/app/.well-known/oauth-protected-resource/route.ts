import { NextResponse } from 'next/server'
import { McpConfigError } from '@/lib/mcp/auth'
import { METADATA_HEADERS, protectedResourceMetadata } from '@/lib/mcp/metadata'

// Metadatos en la raíz (RFC 9728). Se sirve el MISMO documento aquí y en
// /.well-known/oauth-protected-resource/api/mcp porque los clientes no
// coinciden en cuál sondean: unos usan la ruta con el path del recurso y
// otros la raíz. Duplicar la ruta es más barato que perder una conexión.

export function GET() {
  try {
    return NextResponse.json(protectedResourceMetadata(), { headers: METADATA_HEADERS })
  } catch (error) {
    if (error instanceof McpConfigError) {
      console.error('[well-known]', error.name, error.message)
      return NextResponse.json({ error: 'Servidor MCP no configurado.' }, { status: 503 })
    }
    throw error
  }
}
