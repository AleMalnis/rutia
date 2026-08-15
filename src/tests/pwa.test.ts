import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import manifest from '@/app/manifest'
import { config as proxyConfig } from '@/proxy'

// PWA instalable (spec §4). Lo frágil aquí no es la lógica sino las
// referencias: un icono renombrado o un matcher que atrape el manifest no
// rompen el build, solo la instalación — y eso no se ve hasta probar en un
// móvil real. Estos tests convierten ese fallo silencioso en uno ruidoso.

describe('manifest de la PWA', () => {
  const data = manifest()

  it('arranca en /app en modo standalone', () => {
    expect(data.start_url).toBe('/app')
    expect(data.display).toBe('standalone')
    expect(data.name).toBe('RutIA')
  })

  it('cada icono declarado existe de verdad en public/', () => {
    for (const icon of data.icons ?? []) {
      const file = join(process.cwd(), 'public', icon.src.replace(/^\//, ''))
      expect(existsSync(file), `falta ${icon.src} en public/`).toBe(true)
    }
  })

  it('declara los tamaños que exige la instalación y una variante maskable', () => {
    const sizes = (data.icons ?? []).map((icon) => icon.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    // sin maskable, Android encaja el icono sobre un disco blanco
    expect((data.icons ?? []).some((icon) => icon.purpose === 'maskable')).toBe(true)
  })

  it('el icono de iOS existe en la convención de Next (src/app/apple-icon.png)', () => {
    expect(existsSync(join(process.cwd(), 'src', 'app', 'apple-icon.png'))).toBe(true)
  })
})

describe('el proxy y las rutas públicas de la PWA', () => {
  // el matcher de Next es un patrón path-to-regexp; para lo que se comprueba
  // aquí (un grupo de exclusión negativo) basta evaluarlo como RegExp anclada
  const pattern = new RegExp(`^${proxyConfig.matcher[0]}$`)

  it('no intercepta el manifest ni los iconos', () => {
    for (const publica of [
      '/manifest.webmanifest',
      '/icon-192.png',
      '/icon-512.png',
      '/icon-maskable-512.png',
    ]) {
      expect(pattern.test(publica), `${publica} no debería pasar por el proxy`).toBe(false)
    }
  })

  it('sigue interceptando las rutas de la app, que sí necesitan sesión', () => {
    for (const privada of ['/app', '/login', '/api/chat']) {
      expect(pattern.test(privada), `${privada} debería pasar por el proxy`).toBe(true)
    }
  })
})
