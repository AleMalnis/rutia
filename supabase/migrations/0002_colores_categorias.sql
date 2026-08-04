-- ============================================================================
-- RutIA — 0002_colores_categorias.sql
-- Sustituye los colores de categoría elegidos a ojo por la paleta validada
-- (contraste y separación para daltonismo comprobados con herramienta, en
-- claro y oscuro; ver spec §4). El hex guardado es la variante clara; la
-- oscura la resuelve la app (src/lib/category-colors.ts).
-- Instalaciones nuevas: ejecutar tras 0001_init.sql.
-- ============================================================================

-- 1. El trigger de registro siembra los colores validados a usuarios nuevos.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;

  insert into public.categories (user_id, name, color) values
    (new.id, 'Trabajo',  '#2a78d6'),
    (new.id, 'Estudio',  '#4a3aa7'),
    (new.id, 'Deporte',  '#eb6834'),
    (new.id, 'Salud',    '#e34948'),
    (new.id, 'Comidas',  '#008300'),
    (new.id, 'Hogar',    '#eda100'),
    (new.id, 'Ocio',     '#e87ba4'),
    (new.id, 'Descanso', '#1baf7a')
  on conflict (user_id, name) do nothing;

  return new;
end;
$$;

-- 2. Migra las categorías existentes que aún tengan su color por defecto.
--    Solo se toca la fila si nombre Y color coinciden con el seed original:
--    una categoría renombrada o recoloreada por el usuario no se pisa.
update public.categories set color = v.nuevo
from (values
  ('Trabajo',  '#3b82f6', '#2a78d6'),
  ('Estudio',  '#8b5cf6', '#4a3aa7'),
  ('Deporte',  '#f97316', '#eb6834'),
  ('Salud',    '#ef4444', '#e34948'),
  ('Comidas',  '#22c55e', '#008300'),
  ('Hogar',    '#eab308', '#eda100'),
  ('Ocio',     '#ec4899', '#e87ba4'),
  ('Descanso', '#64748b', '#1baf7a')
) as v(nombre, viejo, nuevo)
where categories.name = v.nombre and categories.color = v.viejo;
