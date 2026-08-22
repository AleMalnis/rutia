import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// supabase/setup.sql es la instalación de un solo pegado y va COMMITEADO
// (quien clona no ejecuta nada para poder instalar). Este test impide que se
// desincronice de las migraciones, que son la fuente de verdad: añadir una
// migración sin regenerar (`npm run db:setup`) rompe aquí, en CI — no en el
// SQL Editor de quien instala.

const root = process.cwd()

describe('supabase/setup.sql', () => {
  it('contiene cada migración entera y en su orden', () => {
    const setup = readFileSync(join(root, 'supabase', 'setup.sql'), 'utf8')
    const files = readdirSync(join(root, 'supabase', 'migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort()
    expect(files.length).toBeGreaterThan(0)

    // normalizaciones que el propio generador hace o permite: se filtran los
    // «ejecutar después de 000X» de las cabeceras, y la URL del MCP puede
    // haberse regenerado con el dominio propio (npm run db:setup -- https://…)
    const normalize = (sql: string) =>
      sql
        .split(/\r?\n/)
        .filter((line) => !/^-- Ejecutar en el SQL Editor de Supabase después de \d{4}\.\s*$/.test(line))
        .filter((line) => !/^-- Instalaciones nuevas: ejecutar tras 0001_init\.sql\.\s*$/.test(line))
        .join('\n')
        .replace(/https?:\/\/[^'\s]+\/api\/mcp/g, '<URL-MCP>')

    const normalizedSetup = normalize(setup)
    let cursor = 0
    for (const file of files) {
      const body = normalize(readFileSync(join(root, 'supabase', 'migrations', file), 'utf8')).trim()
      const at = normalizedSetup.indexOf(body, cursor)
      expect(at, `${file} falta o está desordenada en setup.sql — regenera con npm run db:setup`).toBeGreaterThanOrEqual(0)
      cursor = at + body.length
    }
  })
})
