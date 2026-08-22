// Regenera supabase/setup.sql: las migraciones 0001…N concatenadas en orden,
// para que instalar desde cero sea UN solo pegado en el SQL Editor. El
// fichero va COMMITEADO (quien clona no debe ejecutar nada para poder
// instalar); un test de CI comprueba que no se desincronice de las
// migraciones, que siguen siendo la fuente de verdad.
//
// Uso:
//   npm run db:setup                        → regenera con la URL MCP del repo
//   npm run db:setup -- https://mi-dominio  → deja la URL del MCP apuntando a tu dominio
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'supabase', 'migrations')
const outputPath = join(root, 'supabase', 'setup.sql')

const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort() // el prefijo numérico ordena solo

const domain = process.argv[2]?.replace(/\/+$/, '')
if (domain && !/^https?:\/\/[^\s]+$/.test(domain)) {
  console.error(`El dominio no parece una URL: ${domain}`)
  process.exit(1)
}

let sql = `-- ============================================================================
-- RutIA — instalación completa desde cero.
--
-- GENERADO por scripts/build-setup-sql.mjs (\`npm run db:setup\`): no editar a
-- mano. Es la concatenación en orden de supabase/migrations/
-- (${files[0]} … ${files.at(-1)}).
--
-- Pégalo ENTERO en el SQL Editor de Supabase y ejecútalo UNA vez sobre un
-- proyecto vacío. Para actualizar una instalación existente, ejecuta solo las
-- migraciones numeradas que te falten, nunca este fichero.
--
-- ⚠ Si vas a usar el modo MCP: busca abajo el insert en mcp_config y cambia
--   la URL por la de tu dominio (o regenera este fichero con
--   \`npm run db:setup -- https://TU-DOMINIO\`). Sin modo MCP, da igual.
-- ============================================================================

`

for (const file of files) {
  sql += `\n-- ────────────────────────── ${file} ──────────────────────────\n\n`
  const body = readFileSync(join(migrationsDir, file), 'utf8')
    .split(/\r?\n/)
    // en un fichero de un solo pegado, el «ejecutar después de 000X» de cada
    // cabecera solo confunde; el resto de cada cabecera se conserva
    .filter((line) => !/^-- Ejecutar en el SQL Editor de Supabase después de \d{4}\.\s*$/.test(line))
    .filter((line) => !/^-- Instalaciones nuevas: ejecutar tras 0001_init\.sql\.\s*$/.test(line))
    .join('\n')
  sql += body.trim() + '\n'
}

if (domain) {
  sql = sql.replaceAll('https://rutia-six.vercel.app/api/mcp', `${domain}/api/mcp`)
}

writeFileSync(outputPath, sql)
console.log(`Generado ${outputPath} (${files.length} migraciones${domain ? `, MCP → ${domain}/api/mcp` : ''}).`)
