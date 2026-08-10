import { describe, expect, it } from 'vitest'
import { safeRedirect } from '@/lib/safe-redirect'

// El destino de vuelta tras el login viene de la URL, así que lo escribe quien
// sea: sin validarlo, el formulario de login sería un redirector abierto.

describe('safeRedirect', () => {
  it('acepta rutas internas', () => {
    expect(safeRedirect('/app')).toBe('/app')
    expect(safeRedirect('/oauth/consent?authorization_id=abc123')).toBe(
      '/oauth/consent?authorization_id=abc123',
    )
  })

  it('rechaza URLs absolutas: sería un redirector abierto', () => {
    for (const malo of [
      'https://evil.example/cb',
      'http://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      'data:text/html,<script>',
    ]) {
      expect(safeRedirect(malo)).toBe('/app')
    }
  })

  it('rechaza saltos de línea (inyección de cabeceras)', () => {
    expect(safeRedirect('/app\r\nSet-Cookie: a=b')).toBe('/app')
  })

  it('sin valor o con basura cae al destino por defecto', () => {
    for (const nada of [null, undefined, '', 42, {}, [], 'app']) {
      expect(safeRedirect(nada)).toBe('/app')
    }
  })
})
