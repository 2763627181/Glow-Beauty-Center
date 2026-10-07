-- Glow Beauty Center — nómina de pago de las especialistas.
-- Una nómina (payroll_run) cubre un período; tiene un volante (payroll_line) por especialista con sus ventas, comisión,
-- propinas, sueldo base, bonos y descuentos. Mientras está en borrador se puede recalcular y editar; al marcarla como
-- pagada queda congelada (los reembolsos o cambios posteriores en las ventas ya no la modifican).

alter table public.employees add column if not exists base_salary numeric(10,2) not null default 0 check (base_salary >= 0);

create sequence if not exists public.payroll_run_seq;

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  run_number text not null unique default ('NOM-' || lpad(nextval('public.payroll_run_seq')::text, 4, '0')),
  title text not null check (length(trim(title)) between 2 and 120),
  period_start date not null,
  period_end date not null,
  status text not null default 'borrador' check (status in ('borrador', 'pagada')),
  only_paid boolean not null default true,      -- solo ventas cobradas por completo
  include_tips boolean not null default true,   -- las propinas de cada venta se reparten entre quienes la atendieron
  notes text,
  paid_on date,
  paid_method text,
  paid_reference text,
  created_by uuid references auth.users(id) on delete set null,
  paid_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  check ((status = 'pagada') = (paid_on is not null))
);

create table public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  employee_name text not null,
  period_start date not null,   -- copia del período de la nómina: permite impedir que se pague dos veces el mismo día
  period_end date not null,
  services_count int not null default 0,
  sales_total numeric(12,2) not null default 0,
  commission numeric(12,2) not null default 0,
  tips numeric(12,2) not null default 0,
  base_salary numeric(12,2) not null default 0,
  bonus numeric(12,2) not null default 0,
  deductions numeric(12,2) not null default 0,
  net numeric(12,2) generated always as (base_salary + commission + tips + bonus - deductions) stored,
  notes text,
  detail jsonb not null default '[]'::jsonb,  -- foto de las ventas que dieron origen a la comisión
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_lines_amounts_ck check (services_count >= 0 and sales_total >= 0 and commission >= 0 and tips >= 0
                                             and base_salary >= 0 and bonus >= 0 and deductions >= 0),
  constraint payroll_lines_notes_ck check (notes is null or length(notes) <= 300),
  constraint payroll_lines_run_emp_uq unique (run_id, employee_id),
  constraint payroll_lines_no_double_pay exclude using gist (employee_id with =, daterange(period_start, period_end, '[]') with &&)
);
create index payroll_lines_run_idx on public.payroll_lines (run_id);
create index payroll_runs_period_idx on public.payroll_runs (period_end desc);

create trigger t_payroll_runs_updated before update on public.payroll_runs for each row execute function public.set_updated_at();
create trigger t_payroll_lines_updated before update on public.payroll_lines for each row execute function public.set_updated_at();

-- Una nómina pagada no se toca: ni sus datos, ni sus volantes (para cambiarla hay que reabrirla a propósito).
create or replace function public.guard_payroll_run() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'pagada' then raise exception 'payroll_paid'; end if;
    return old;
  end if;
  if new.period_start <> old.period_start or new.period_end <> old.period_end then raise exception 'payroll_period_locked'; end if;
  if old.status = 'pagada' and new.status = 'pagada' then raise exception 'payroll_paid'; end if;
  return new;
end $$;
create trigger t_payroll_runs_guard before update or delete on public.payroll_runs for each row execute function public.guard_payroll_run();

create or replace function public.guard_payroll_line() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.payroll_runs where id = coalesce(new.run_id, old.run_id);
  if v_status = 'pagada' then raise exception 'payroll_paid'; end if;
  return coalesce(new, old);
end $$;
create trigger t_payroll_lines_guard before insert or update or delete on public.payroll_lines for each row execute function public.guard_payroll_line();

revoke execute on function public.guard_payroll_run() from public, anon, authenticated;
revoke execute on function public.guard_payroll_line() from public, anon, authenticated;

-- Auditoría: quién creó, editó, pagó o eliminó
create trigger t_audit_payroll_runs after insert or update or delete on public.payroll_runs for each row execute function public.audit_row();
create trigger t_audit_payroll_lines after insert or update or delete on public.payroll_lines for each row execute function public.audit_row();

-- Solo super administrador y gerencia ven y manejan la nómina
alter table public.payroll_runs enable row level security;
alter table public.payroll_lines enable row level security;
create policy payroll_runs_all on public.payroll_runs for all to authenticated
  using (public.has_role('super_admin', 'manager')) with check (public.has_role('super_admin', 'manager'));
create policy payroll_lines_all on public.payroll_lines for all to authenticated
  using (public.has_role('super_admin', 'manager')) with check (public.has_role('super_admin', 'manager'));
revoke all on public.payroll_runs, public.payroll_lines from anon;
