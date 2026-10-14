-- Glow Beauty Center — número de cada especialista (00, 01, 02…) para identificarla en el panel junto a su nombre.
-- Solo agrega una columna opcional (0 a 99, sin repetir). La página pública sigue mostrando solo el nombre: esta columna no se
-- le concede al rol anónimo. Se puede volver a ejecutar sin romper nada.

alter table public.employees add column if not exists employee_number smallint;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'employees_number_ck') then
    alter table public.employees add constraint employees_number_ck check (employee_number is null or employee_number between 0 and 99);
  end if;
end $$;

-- Dos especialistas no pueden tener el mismo número
create unique index if not exists employees_number_uidx on public.employees (employee_number) where employee_number is not null;
