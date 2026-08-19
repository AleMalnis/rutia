// Paginación exhaustiva para las lecturas de exportación (spec §12.13).
//
// PostgREST corta cada respuesta al Max Rows del proyecto (1000 por defecto
// en Supabase) SIN error: un select «sin límite» devuelve 1000 filas como si
// fueran todas. Para un export que promete ser completo eso es veneno: el
// fichero saldría parcial y nadie lo notaría. De ahí el bucle y la red de
// seguridad con el recuento exacto.

export type Page<T> = {
  rows: T[]
  /** Recuento EXACTO total (count: 'exact'); solo hace falta en la primera página. */
  count: number | null
}

export async function fetchAllPages<T>(
  pageSize: number,
  fetchPage: (from: number, to: number) => Promise<Page<T>>,
): Promise<T[]> {
  const rows: T[] = []
  let expected: number | null = null

  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1)
    if (expected == null) expected = page.count
    rows.push(...page.rows)
    if (page.rows.length < pageSize) break
  }

  // Si el Max Rows del proyecto bajara por debajo del tamaño de página, cada
  // página llegaría corta y el bucle pararía antes de tiempo creyendo haber
  // terminado. Mejor fallar ruidosamente que exportar un fichero incompleto
  // que dice ser completo. Solo con `<`: filas AÑADIDAS durante la paginación
  // (el chat sigue escribiendo) hacen llegar más de las contadas al inicio,
  // y eso no es una lectura incompleta.
  if (expected != null && rows.length < expected) {
    throw new Error(
      `Lectura incompleta: se esperaban ${expected} filas y llegaron ${rows.length}. ` +
        'Revisa el ajuste Max Rows del proyecto de Supabase.',
    )
  }
  return rows
}
