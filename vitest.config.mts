import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/tests/**/*.test.ts'],
    coverage: {
      // Los repos salen a ~0 % a propósito: son envoltorios de I/O de Supabase
      // y se ejercitarán con tests de integración, no con el stub en memoria.
      include: ['src/services/**', 'src/repositories/**', 'src/lib/schemas.ts'],
      thresholds: {
        // objetivo de la spec §9: >= 70 % en services/; hace fallar el proceso
        'src/services/**': { statements: 70, lines: 70 },
      },
    },
  },
})
