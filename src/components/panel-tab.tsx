// Alternador simple con aria-pressed: dos vistas del mismo panel. No se usa
// el patrón ARIA de tabs porque exige navegación con flechas que aquí no
// aporta nada con solo dos opciones. Nació en el panel Chat/Hoy del tablero y
// lo reutiliza el diálogo de IA (Clave de API / Conectores): mismo aspecto,
// mismo comportamiento, un solo sitio que mantener.
export function PanelTab({
  active,
  disabled = false,
  onClick,
  children,
}: {
  active: boolean
  /** El diálogo de IA bloquea el cambio de vista con un guardado en vuelo. */
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex-1 rounded-md px-3 py-1 text-sm font-medium transition-colors disabled:opacity-50 ${
        active ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:bg-edge/40'
      }`}
    >
      {children}
    </button>
  )
}
