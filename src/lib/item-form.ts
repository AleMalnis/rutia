// Traducción del FormData del navegador a la entrada del RoutineService.
// Es una frontera con sus propias trampas (un input vacío llega como '', no
// como null; los checkboxes llegan repetidos; un recordatorio no debe
// arrastrar la hora de fin del bloque que era antes), así que vive aparte y
// tiene tests. No valida: de eso se encarga Zod dentro del servicio.

type FormLike = { get(name: string): unknown; getAll(name: string): unknown[] }

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalText(value: unknown): string | null {
  const trimmed = text(value)
  return trimmed === '' ? null : trimmed
}

export function parseItemForm(formData: FormLike): Record<string, unknown> {
  const kind = formData.get('kind')
  const end = optionalText(formData.get('end'))

  return {
    title: typeof formData.get('title') === 'string' ? text(formData.get('title')) : undefined,
    kind,
    // los checkboxes marcados llegan como valores repetidos del mismo campo
    days: formData.getAll('days').map((day) => Number(day)),
    start: optionalText(formData.get('start')) ?? undefined,
    // un recordatorio nunca lleva hora de fin, aunque el formulario la
    // enviara por haber cambiado de tipo sin recargar
    end: kind === 'block' ? end : null,
    categoryId: optionalText(formData.get('categoryId')),
    detail: optionalText(formData.get('detail')),
  }
}
