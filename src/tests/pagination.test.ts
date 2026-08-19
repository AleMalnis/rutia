import { describe, expect, it } from 'vitest'
import { fetchAllPages } from '@/lib/pagination'

// El contrato del bucle de exportación (spec §12.13): PostgREST corta en Max
// Rows sin error, así que la completitud depende de ESTE bucle y de su red de
// seguridad con el recuento exacto.

function pagedSource(total: number) {
  const all = Array.from({ length: total }, (_, i) => i)
  return async (from: number, to: number) => ({
    rows: all.slice(from, Math.min(to + 1, total)),
    count: total,
  })
}

describe('fetchAllPages', () => {
  it('agota todas las páginas, no solo la primera', async () => {
    const rows = await fetchAllPages(1000, pagedSource(2500))
    expect(rows).toHaveLength(2500)
    expect(rows[0]).toBe(0)
    expect(rows[2499]).toBe(2499)
  })

  it('un total exacto al tamaño de página no duplica ni pierde', async () => {
    const rows = await fetchAllPages(1000, pagedSource(1000))
    expect(rows).toHaveLength(1000)
  })

  it('cero filas devuelve vacío sin fallar', async () => {
    const rows = await fetchAllPages(1000, pagedSource(0))
    expect(rows).toEqual([])
  })

  it('si el servidor corta por debajo del tamaño de página, falla RUIDOSAMENTE', async () => {
    // simula un Max Rows del proyecto bajado a 500: cada página llega corta y
    // sin la red de seguridad el bucle pararía creyendo haber terminado
    const total = 1200
    const serverCap = 500
    const all = Array.from({ length: total }, (_, i) => i)
    const fetchPage = async (from: number, to: number) => ({
      rows: all.slice(from, Math.min(from + serverCap, to + 1, total)),
      count: total,
    })
    await expect(fetchAllPages(1000, fetchPage)).rejects.toThrow('Lectura incompleta')
  })
})
