// Apariencia personalizable (spec §4): modo, tema de superficie y fuente.
// Los presets viven como variables CSS en globals.css; aquí están sus
// metadatos para la UI y la normalización de lo guardado en
// profiles.preferences. Todos los presets pasaron el verificador de contraste
// (tinta ≥4.5:1 sobre tarjeta y página, acento ≥3:1) y los 8 colores de
// categoría se revalidaron contra cada superficie (scratchpad/themes).

export const MODES = ['light', 'dark', 'auto'] as const
export const FONTS = ['system', 'serif', 'rounded'] as const

export type Mode = (typeof MODES)[number]
export type Font = (typeof FONTS)[number]

export type ThemeMeta = {
  id: string
  label: string
  /** Muestras para el selector: [página clara, acento claro, página oscura]. */
  swatch: [string, string, string]
}

export const THEMES: ThemeMeta[] = [
  { id: 'zinc', label: 'Zinc', swatch: ['#fafafa', '#18181b', '#09090b'] },
  { id: 'pizarra', label: 'Pizarra', swatch: ['#f3f6f9', '#1c5cab', '#0b1220'] },
  { id: 'arena', label: 'Arena', swatch: ['#faf6ef', '#8a5310', '#151210'] },
  { id: 'bosque', label: 'Bosque', swatch: ['#f2f7f3', '#116b3f', '#0c1210'] },
  { id: 'uva', label: 'Uva', swatch: ['#f7f5fb', '#4a3aa7', '#120f1c'] },
]

export const THEME_IDS = THEMES.map((t) => t.id)

export type Appearance = {
  mode: Mode
  theme: string
  font: Font
}

export const DEFAULT_APPEARANCE: Appearance = {
  mode: 'auto',
  // pizarra y no zinc (spec §4): el acento de zinc es la propia tinta, y una
  // primera impresión 100 % monocroma lee como pantalla sin diseñar
  theme: 'pizarra',
  font: 'system',
}

/**
 * Convierte lo que haya en profiles.preferences.appearance en una apariencia
 * usable: cualquier campo ausente o inválido cae a su valor por defecto (las
 * preferencias antiguas o manipuladas no deben romper la página).
 */
export function normalizeAppearance(value: unknown): Appearance {
  const raw = (value ?? {}) as Record<string, unknown>
  return {
    mode: MODES.includes(raw.mode as Mode) ? (raw.mode as Mode) : DEFAULT_APPEARANCE.mode,
    theme: THEME_IDS.includes(raw.theme as string)
      ? (raw.theme as string)
      : DEFAULT_APPEARANCE.theme,
    font: FONTS.includes(raw.font as Font) ? (raw.font as Font) : DEFAULT_APPEARANCE.font,
  }
}
