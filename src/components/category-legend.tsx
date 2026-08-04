import { categoryColorStyle } from '@/lib/category-colors'
import type { Category } from '@/lib/schemas'

// Leyenda de colores por categoría (spec §4).
export function CategoryLegend({ categories }: { categories: Category[] }) {
  if (categories.length === 0) return null

  return (
    <ul role="list" className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {categories.map((category) => (
        <li
          key={category.id}
          className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400"
        >
          <span
            aria-hidden
            className="cat-mark h-2.5 w-2.5 rounded-full"
            style={{ ...categoryColorStyle(category.color), backgroundColor: 'var(--cat)' }}
          />
          {category.name}
        </li>
      ))}
    </ul>
  )
}
