import { NextResponse } from 'next/server'
import { McpConfigError } from '@/lib/mcp/auth'
import { METADATA_HEADERS, protectedResourceMetadata } from '@/lib/mcp/metadata'

// Metadatos en la ruta que RFC 9728 construye insertando el well-known entre
// el host y el path del recurso: para https://…/api/mcp el documento va en
// /.well-known/oauth-protected-resource/api/mcp. Mismo contenido que la raíz.

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
