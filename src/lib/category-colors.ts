// Muestrario validado de colores de categoría (spec §4). Cada tono tiene su
// par claro/oscuro: la paleta clara no supera el contraste mínimo sobre fondo
// oscuro (el violeta se queda en 2.33:1), así que guardar UN hex no basta.
// En BD se guarda la variante clara; la oscura se resuelve aquí.
// Validado con script (no a ojo): CVD ΔE 9.1 claro / 8.4 oscuro (objetivo ≥8),
// visión normal 19.6 / 19.3 (≥15), contraste ≥3:1 en oscuro.

export type CategoryColor = {
  /** Nombre en la UI del muestrario. */
  name: string
  /** Variante para superficies claras: la que se persiste en BD. */
  light: string
  /** Variante para superficies oscuras. */
  dark: string
}

export const CATEGORY_COLORS: CategoryColor[] = [
  { name: 'Azul', light: '#2a78d6', dark: '#3987e5' },
  { name: 'Naranja', light: '#eb6834', dark: '#d95926' },
  { name: 'Aqua', light: '#1baf7a', dark: '#199e70' },
  { name: 'Amarillo', light: '#eda100', dark: '#c98500' },
  { name: 'Magenta', light: '#e87ba4', dark: '#d55181' },
  { name: 'Verde', light: '#008300', dark: '#008300' },
  { name: 'Violeta', light: '#4a3aa7', dark: '#9085e9' },
  { name: 'Rojo', light: '#e34948', dark: '#e66767' },
]

export const CATEGORY_COLOR_VALUES = CATEGORY_COLORS.map((c) => c.light)

const DARK_BY_LIGHT = new Map(CATEGORY_COLORS.map((c) => [c.light, c.dark]))

export const FALLBACK_CATEGORY_COLOR = '#71717a'

/**
 * Estilo con las dos variantes como variables CSS. El modo activo elige cuál
 * usar vía la clase `cat-mark` (globals.css): los estilos inline no pueden
 * cambiar con el modo, las variables de la hoja de estilos sí. Un color
 * heredado que no esté en el muestrario usa el mismo hex en ambos modos.
 */
export function categoryColorStyle(light: string | null): Record<string, string> {
  const base = light ?? FALLBACK_CATEGORY_COLOR
  return {
    '--cat-light': base,
    '--cat-dark': DARK_BY_LIGHT.get(base) ?? base,
  }
}
