-- Glow Beauty Center — INVENTARIO de productos que se usan en los servicios (shampoo, gel, pintura de uñas…).
-- Cada producto (supply) tiene los servicios en los que se usa y, opcionalmente, cuántos servicios rinde una unidad. Cada llegada de pedido
-- es una ENTRADA (supply_lot) con su fecha y cantidad; cuando se acaba se marca la fecha de agotado. Con eso el panel calcula cuántos servicios
-- se hicieron en ese tiempo y cuánto se consumió por cliente, y avisa si el consumo parece excesivo.
-- Solo agrega tablas. Solo super administrador y gerencia las ven y las manejan. Se puede volver a ejecutar sin romper nada.

create table if not exists public.supplies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 80),
  unit text not null default 'unidad' check (length(trim(unit)) between 1 and 30 and unit !~ '\s'), -- una palabra: pote, botella, caja…
  expected_services_per_unit numeric(8,2) check (expected_services_per_unit is null or expected_services_per_unit > 0),
  notes text check (notes is null or length(notes) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Servicios en los que se usa cada producto (de ahí sale cuántos clientes se atendieron)
create table if not exists public.supply_services (
  supply_id uuid not null references public.supplies(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  primary key (supply_id, service_id)
);
create index if not exists supply_services_service_idx on public.supply_services (service_id);

-- Entradas: lo que llega en cada pedido y cuándo se agotó
create table if not exists public.supply_lots (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references public.supplies(id) on delete cascade,
  received_on date not null,
  quantity numeric(10,2) not null check (quantity > 0),
  unit_cost numeric(10,2) check (unit_cost is null or unit_cost >= 0),
  supplier text check (supplier is null or length(supplier) <= 120),
  notes text check (notes is null or length(notes) <= 300),
  depleted_on date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supply_lots_depleted_ck check (depleted_on is null or depleted_on >= received_on)
);
create index if not exists supply_lots_supply_idx on public.supply_lots (supply_id, received_on);

drop trigger if exists t_supplies_updated on public.supplies;
create trigger t_supplies_updated before update on public.supplies for each row execute function public.set_updated_at();
drop trigger if exists t_supply_lots_updated on public.supply_lots;
create trigger t_supply_lots_updated before update on public.supply_lots for each row execute function public.set_updated_at();

-- Auditoría: quién creó, cambió o borró cada producto y cada entrada
drop trigger if exists t_audit_supplies on public.supplies;
create trigger t_audit_supplies after insert or update or delete on public.supplies for each row execute function public.audit_row();
drop trigger if exists t_audit_supply_lots on public.supply_lots;
create trigger t_audit_supply_lots after insert or update or delete on public.supply_lots for each row execute function public.audit_row();

-- Solo super administrador y gerencia
alter table public.supplies enable row level security;
alter table public.supply_services enable row level security;
alter table public.supply_lots enable row level security;
drop policy if exists supplies_all on public.supplies;
create policy supplies_all on public.supplies for all to authenticated using (public.has_role('super_admin', 'manager')) with check (public.has_role('super_admin', 'manager'));
drop policy if exists supply_services_all on public.supply_services;
create policy supply_services_all on public.supply_services for all to authenticated using (public.has_role('super_admin', 'manager')) with check (public.has_role('super_admin', 'manager'));
drop policy if exists supply_lots_all on public.supply_lots;
create policy supply_lots_all on public.supply_lots for all to authenticated using (public.has_role('super_admin', 'manager')) with check (public.has_role('super_admin', 'manager'));
revoke all on public.supplies, public.supply_services, public.supply_lots from anon;
