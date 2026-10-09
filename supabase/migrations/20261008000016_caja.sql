-- Glow Beauty Center — CAJA: turnos de caja, entradas y salidas de efectivo, efectivo recibido / vuelto y producción por especialista.
-- Compatible hacia atrás: el código anterior sigue funcionando (los parámetros nuevos son opcionales) y se puede volver a ejecutar sin romper nada.
--
--  • payment_methods.is_cash   : el método cuenta como efectivo (entra a la caja). «Efectivo» ya viene marcado.
--  • payments.tendered         : lo que entregó el cliente en efectivo (el vuelto es tendered − amount). «amount» es lo que quedó cobrado.
--  • payments.refunded_at      : cuándo se reembolsó (el efectivo devuelto sale de la caja del momento en que se devolvió).
--  • cash_sessions             : turnos de caja (apertura con fondo inicial, cierre con efectivo contado y diferencia).
--  • cash_movements            : entradas y salidas de efectivo del turno (pago a especialistas, compras, gastos, retiros…).
--  • cash_session_report       : todo lo del turno (totales, métodos, cobros, movimientos, producción por especialista).
--  • Un solo turno abierto a la vez. El cierre guarda una foto del reporte: lo cobrado o anulado después ya no lo cambia.

-- ───────────── 1. Métodos de pago: ¿es efectivo? ─────────────
alter table public.payment_methods add column if not exists is_cash boolean not null default false;
update public.payment_methods set is_cash = true where key = 'efectivo';

-- ───────────── 2. Pagos: efectivo recibido, momento del reembolso y hora exacta ─────────────
alter table public.payments add column if not exists tendered numeric(10,2);
alter table public.payments add column if not exists refunded_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_tendered_ck') then
    alter table public.payments add constraint payments_tendered_ck check (tendered is null or tendered >= amount);
  end if;
end $$;
-- La hora del pago es la hora real en que se registra (no la de inicio de la transacción)
alter table public.payments alter column paid_at set default clock_timestamp();
-- Igual con la hora de las ventas: es el momento real en que se registran
alter table public.sales alter column completed_at set default clock_timestamp();
create index if not exists payments_paid_at_idx on public.payments (paid_at);
create index if not exists payments_refunded_at_idx on public.payments (refunded_at) where refunded_at is not null;

create or replace function public.set_payment_refunded_at() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'reembolsado' and old.status <> 'reembolsado' then new.refunded_at := coalesce(new.refunded_at, clock_timestamp());
  elsif new.status = 'pagado' and old.status = 'reembolsado' then new.refunded_at := null; end if;
  return new;
end $$;
drop trigger if exists t_payment_refunded_at on public.payments;
create trigger t_payment_refunded_at before update of status on public.payments for each row execute function public.set_payment_refunded_at();
revoke execute on function public.set_payment_refunded_at() from public, anon, authenticated;

-- ───────────── 3. Turnos y movimientos de caja ─────────────
create sequence if not exists public.cash_session_seq;

create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  session_number text not null unique default ('CAJA-' || lpad(nextval('public.cash_session_seq')::text, 4, '0')),
  opened_at timestamptz not null default clock_timestamp(),
  opened_by uuid references auth.users(id) on delete set null,
  opening_amount numeric(10,2) not null check (opening_amount >= 0),
  opening_note text check (opening_note is null or length(opening_note) <= 300),
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  expected_cash numeric(12,2),
  counted_cash numeric(12,2) check (counted_cash is null or counted_cash >= 0),
  difference numeric(12,2),
  closing_note text check (closing_note is null or length(closing_note) <= 300),
  report jsonb,                                  -- foto del reporte al cerrar
  created_at timestamptz not null default now(),
  constraint cash_sessions_closed_ck check (
    (closed_at is null) = (counted_cash is null) and (closed_at is null) = (expected_cash is null)
    and (closed_at is null) = (difference is null) and (closed_at is null or closed_at >= opened_at))
);
create unique index if not exists cash_sessions_one_open on public.cash_sessions ((true)) where closed_at is null;
create index if not exists cash_sessions_opened_idx on public.cash_sessions (opened_at desc);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.cash_sessions(id) on delete restrict,
  kind text not null check (kind in ('entrada', 'salida')),
  category text not null check (category in ('pago_especialista', 'propina', 'compra', 'gasto', 'retiro', 'aporte', 'otro')),
  amount numeric(10,2) not null check (amount > 0),
  description text check (description is null or length(trim(description)) between 1 and 200),
  employee_id uuid references public.employees(id) on delete set null,
  employee_name text,                            -- el nombre queda aunque la especialista se elimine
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text check (void_reason is null or length(void_reason) <= 300),
  constraint cash_movements_category_ck check (
    (kind = 'entrada' and category in ('aporte', 'otro')) or
    (kind = 'salida' and category in ('pago_especialista', 'propina', 'compra', 'gasto', 'retiro', 'otro'))),
  constraint cash_movements_other_ck check (category <> 'otro' or description is not null),
  constraint cash_movements_void_ck check ((voided_at is null) = (void_reason is null))
);
create index if not exists cash_movements_session_idx on public.cash_movements (session_id, created_at);
create index if not exists cash_movements_employee_idx on public.cash_movements (employee_id) where employee_id is not null;

-- Un turno cerrado no se toca (para corregirlo hay que reabrirlo a propósito). Lo único que se permite son los cambios que hace
-- la propia base cuando se elimina un usuario (quién abrió / cerró pasa a «sin dato»).
create or replace function public.guard_cash_session() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (to_jsonb(new) - array['opened_by', 'closed_by']) = (to_jsonb(old) - array['opened_by', 'closed_by']) then return new; end if;
  if old.closed_at is not null and new.closed_at is not null then raise exception 'cash_session_closed'; end if;
  return new;
end $$;
drop trigger if exists t_cash_sessions_guard on public.cash_sessions;
create trigger t_cash_sessions_guard before update on public.cash_sessions for each row execute function public.guard_cash_session();

-- Un movimiento solo se crea en un turno abierto y, después, lo único que cambia es su anulación.
create or replace function public.guard_cash_movement() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_closed timestamptz; v_skip text[] := array['created_by', 'voided_by', 'employee_id'];
begin
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - v_skip) = (to_jsonb(old) - v_skip) then return new; end if; -- cambios de la propia base al eliminar usuarios o especialistas
  select closed_at into v_closed from public.cash_sessions where id = new.session_id;
  if v_closed is not null then raise exception 'cash_session_closed'; end if;
  if tg_op = 'UPDATE' then
    if old.voided_at is not null then raise exception 'cash_movement_voided'; end if;
    if (to_jsonb(new) - array['voided_at', 'voided_by', 'void_reason']) <> (to_jsonb(old) - array['voided_at', 'voided_by', 'void_reason']) then
      raise exception 'cash_movement_locked';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists t_cash_movements_guard on public.cash_movements;
create trigger t_cash_movements_guard before insert or update or delete on public.cash_movements for each row execute function public.guard_cash_movement();
revoke execute on function public.guard_cash_session() from public, anon, authenticated;
revoke execute on function public.guard_cash_movement() from public, anon, authenticated;

-- Auditoría: los movimientos se anotan solos; abrir, cerrar y reabrir se anotan desde sus funciones (sin copiar el reporte completo)
drop trigger if exists t_audit_cash_sessions on public.cash_sessions;
drop trigger if exists t_audit_cash_movements on public.cash_movements;
create trigger t_audit_cash_movements after insert or update or delete on public.cash_movements for each row execute function public.audit_row();

-- Solo super administrador, gerencia y recepción ven la caja; todo se escribe por las funciones de abajo
alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;
drop policy if exists cash_sessions_read on public.cash_sessions;
create policy cash_sessions_read on public.cash_sessions for select to authenticated using (public.has_role('super_admin', 'manager', 'receptionist'));
drop policy if exists cash_movements_read on public.cash_movements;
create policy cash_movements_read on public.cash_movements for select to authenticated using (public.has_role('super_admin', 'manager', 'receptionist'));
revoke all on public.cash_sessions, public.cash_movements from anon;
revoke insert, update, delete, truncate on public.cash_sessions, public.cash_movements from authenticated;

do $$ begin
  alter publication supabase_realtime add table public.cash_sessions, public.cash_movements;
exception when others then null; -- ya estaban publicadas o no hay publicación
end $$;

-- ───────────── 4. Cálculos de la caja (una sola fuente de la verdad) ─────────────
-- Ventana de un turno = [apertura, cierre). Los turnos no se solapan, así que cada cobro cae en uno solo.
--   efectivo esperado = fondo inicial + efectivo cobrado − efectivo reembolsado + entradas − salidas
-- «amount» es lo que quedó cobrado (el vuelto ya está descontado), por eso el vuelto no afecta la caja.
create or replace function public._cash_totals(p_session uuid, p_end timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.cash_sessions; v_end timestamptz; v_in numeric; v_ref numeric; v_ent numeric; v_sal numeric;
begin
  select * into s from public.cash_sessions where id = p_session;
  if not found then raise exception 'cash_session_not_found'; end if;
  v_end := coalesce(p_end, s.closed_at);
  select coalesce(sum(p.amount) filter (where p.paid_at >= s.opened_at and (v_end is null or p.paid_at < v_end)), 0),
         coalesce(sum(p.amount) filter (where p.status = 'reembolsado' and p.refunded_at >= s.opened_at and (v_end is null or p.refunded_at < v_end)), 0)
    into v_in, v_ref
    from public.payments p join public.payment_methods m on m.key = p.method
   where m.is_cash and (p.paid_at >= s.opened_at or p.refunded_at >= s.opened_at);
  select coalesce(sum(amount) filter (where kind = 'entrada'), 0), coalesce(sum(amount) filter (where kind = 'salida'), 0)
    into v_ent, v_sal from public.cash_movements where session_id = s.id and voided_at is null;
  return jsonb_build_object('opening', s.opening_amount, 'cash_in', v_in, 'cash_refunds', v_ref, 'entradas', v_ent, 'salidas', v_sal,
                            'expected', s.opening_amount + v_in - v_ref + v_ent - v_sal);
end $$;

create or replace function public._cash_report(p_session uuid, p_end timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.cash_sessions; v_end timestamptz; v_methods jsonb; v_pays jsonb; v_moves jsonb; v_prod jsonb; v_sales jsonb;
begin
  select * into s from public.cash_sessions where id = p_session;
  if not found then raise exception 'cash_session_not_found'; end if;
  v_end := coalesce(p_end, s.closed_at);

  -- cobrado por método (bruto) y reembolsado en el turno
  select coalesce(jsonb_agg(jsonb_build_object('method', x.key, 'label', x.label, 'is_cash', x.is_cash, 'count', x.cnt, 'total', x.total, 'refunded', x.refunded)
                            order by x.is_cash desc, x.display_order, x.label), '[]'::jsonb)
    into v_methods
    from (
      select m.key, m.label, m.is_cash, m.display_order,
             count(*) filter (where p.paid_at >= s.opened_at and (v_end is null or p.paid_at < v_end)) as cnt,
             coalesce(sum(p.amount) filter (where p.paid_at >= s.opened_at and (v_end is null or p.paid_at < v_end)), 0) as total,
             coalesce(sum(p.amount) filter (where p.status = 'reembolsado' and p.refunded_at >= s.opened_at and (v_end is null or p.refunded_at < v_end)), 0) as refunded
        from public.payments p join public.payment_methods m on m.key = p.method
       where p.paid_at >= s.opened_at or p.refunded_at >= s.opened_at
       group by m.key, m.label, m.is_cash, m.display_order
    ) x
   where x.cnt > 0 or x.refunded > 0;

  -- cada cobro del turno (y los reembolsos hechos en el turno de cobros anteriores)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'paid_at', p.paid_at, 'refunded_at', p.refunded_at, 'status', p.status, 'method', p.method, 'label', m.label, 'is_cash', m.is_cash,
           'amount', p.amount, 'tendered', p.tendered, 'reference', p.reference, 'sale_id', p.sale_id, 'sale_number', sa.sale_number,
           'appointment_id', coalesce(p.appointment_id, sa.appointment_id),
           'client', nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), 'by', pr.full_name,
           'paid_in_turn', (p.paid_at >= s.opened_at and (v_end is null or p.paid_at < v_end)),
           'refunded_in_turn', (p.status = 'reembolsado' and p.refunded_at >= s.opened_at and (v_end is null or p.refunded_at < v_end))
         ) order by p.paid_at), '[]'::jsonb)
    into v_pays
    from public.payments p
    join public.payment_methods m on m.key = p.method
    left join public.sales sa on sa.id = p.sale_id
    left join public.appointments ap on ap.id = coalesce(p.appointment_id, sa.appointment_id)
    left join public.clients c on c.id = coalesce(sa.client_id, ap.client_id)
    left join public.profiles pr on pr.id = p.created_by
   where (p.paid_at >= s.opened_at and (v_end is null or p.paid_at < v_end))
      or (p.status = 'reembolsado' and p.refunded_at >= s.opened_at and (v_end is null or p.refunded_at < v_end));

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', mv.id, 'at', mv.created_at, 'kind', mv.kind, 'category', mv.category, 'amount', mv.amount, 'description', mv.description,
           'employee_id', mv.employee_id, 'employee_name', coalesce(e.full_name, mv.employee_name), 'by', pr.full_name,
           'voided_at', mv.voided_at, 'void_reason', mv.void_reason) order by mv.created_at), '[]'::jsonb)
    into v_moves
    from public.cash_movements mv
    left join public.employees e on e.id = mv.employee_id
    left join public.profiles pr on pr.id = mv.created_by
   where mv.session_id = s.id;

  -- producción por especialista (ventas completadas en el turno, sin anuladas) y lo ya entregado desde la caja.
  -- «earned» = lo que le corresponde a ella según su porcentaje; el resto es del salón. «unknown» = producción sin porcentaje configurado.
  with prod as (
    select si.employee_id, count(*) as services, sum(si.total) as production,
           coalesce(sum(si.total * coalesce(si.commission_pct, e.commission_pct) / 100) filter (where coalesce(si.commission_pct, e.commission_pct) is not null), 0) as earned,
           coalesce(sum(si.total) filter (where coalesce(si.commission_pct, e.commission_pct) is null), 0) as no_pct
      from public.sale_items si
      join public.sales sa on sa.id = si.sale_id
      left join public.employees e on e.id = si.employee_id
     where sa.voided_at is null and sa.completed_at >= s.opened_at and (v_end is null or sa.completed_at < v_end)
     group by si.employee_id
  ), paid as (
    select mv.employee_id,
           coalesce(sum(mv.amount) filter (where mv.category = 'pago_especialista'), 0) as paid_out,
           coalesce(sum(mv.amount) filter (where mv.category = 'propina'), 0) as tips_out
      from public.cash_movements mv
     where mv.session_id = s.id and mv.kind = 'salida' and mv.voided_at is null and mv.employee_id is not null
     group by mv.employee_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'employee_id', r.employee_id, 'name', r.name, 'services', r.services, 'production', r.production, 'earned', round(r.earned, 2),
           'no_pct', r.no_pct, 'paid_out', r.paid_out, 'tips_out', r.tips_out) order by r.production desc, r.name), '[]'::jsonb)
    into v_prod
    from (
      select coalesce(pr.employee_id, pd.employee_id) as employee_id, coalesce(e.full_name, 'Sin especialista') as name,
             coalesce(pr.services, 0) as services, coalesce(pr.production, 0) as production, coalesce(pr.earned, 0) as earned,
             coalesce(pr.no_pct, 0) as no_pct, coalesce(pd.paid_out, 0) as paid_out, coalesce(pd.tips_out, 0) as tips_out
        from prod pr
        full join paid pd on pd.employee_id = pr.employee_id
        left join public.employees e on e.id = coalesce(pr.employee_id, pd.employee_id)
    ) r;

  select jsonb_build_object('count', count(*), 'total', coalesce(sum(sa.total), 0), 'tips', coalesce(sum(sa.tip), 0), 'discount', coalesce(sum(sa.discount), 0),
                            'pending', coalesce(sum(greatest(sa.total - coalesce(pd.paid, 0), 0)), 0))
    into v_sales
    from public.sales sa
    left join lateral (select sum(amount) as paid from public.payments where sale_id = sa.id and status = 'pagado') pd on true
   where sa.voided_at is null and sa.completed_at >= s.opened_at and (v_end is null or sa.completed_at < v_end);

  return jsonb_build_object('totals', public._cash_totals(p_session, p_end), 'methods', v_methods, 'payments', v_pays, 'movements', v_moves,
                            'production', v_prod, 'sales', v_sales);
end $$;
revoke execute on function public._cash_totals(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public._cash_report(uuid, timestamptz) from public, anon, authenticated;

-- Reporte de un turno: en vivo si sigue abierto; la foto del cierre si ya se cerró.
create or replace function public.cash_session_report(p_session uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.cash_sessions; v_session jsonb; v_rep jsonb;
begin
  if not public.has_role('super_admin', 'manager', 'receptionist') then raise exception 'forbidden'; end if;
  select * into s from public.cash_sessions where id = p_session;
  if not found then raise exception 'cash_session_not_found'; end if;
  select jsonb_build_object('id', s.id, 'number', s.session_number, 'opened_at', s.opened_at, 'opened_by', po.full_name, 'opening_amount', s.opening_amount,
                            'opening_note', s.opening_note, 'closed_at', s.closed_at, 'closed_by', pc.full_name, 'expected_cash', s.expected_cash,
                            'counted_cash', s.counted_cash, 'difference', s.difference, 'closing_note', s.closing_note)
    into v_session
    from (select 1) one
    left join public.profiles po on po.id = s.opened_by
    left join public.profiles pc on pc.id = s.closed_by;
  v_rep := coalesce(s.report, public._cash_report(s.id));
  return v_rep || jsonb_build_object('session', v_session);
end $$;

-- Cobros en efectivo que quedaron fuera de todo turno (cobrados con la caja cerrada, después de que ya se usaba la caja).
-- No se pierden: se avisan en la pantalla para contarlos al abrir. Lo cobrado antes del primer turno no se considera.
create or replace function public.cash_unassigned() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_first timestamptz; v_n int; v_total numeric; v_items jsonb;
begin
  if not public.has_role('super_admin', 'manager', 'receptionist') then raise exception 'forbidden'; end if;
  select min(opened_at) into v_first from public.cash_sessions;
  if v_first is null then return jsonb_build_object('count', 0, 'total', 0, 'items', '[]'::jsonb); end if;
  with o as (
    select p.id, p.paid_at, p.amount, p.sale_id, sa.sale_number,
           nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') as client
      from public.payments p
      join public.payment_methods m on m.key = p.method and m.is_cash
      left join public.sales sa on sa.id = p.sale_id
      left join public.appointments ap on ap.id = coalesce(p.appointment_id, sa.appointment_id)
      left join public.clients c on c.id = coalesce(sa.client_id, ap.client_id)
     where p.status = 'pagado' and p.paid_at >= v_first
       and not exists (select 1 from public.cash_sessions s where p.paid_at >= s.opened_at and (s.closed_at is null or p.paid_at < s.closed_at))
  )
  select (select count(*) from o), (select coalesce(sum(amount), 0) from o),
         coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'paid_at', x.paid_at, 'amount', x.amount, 'sale_id', x.sale_id, 'sale_number', x.sale_number, 'client', x.client) order by x.paid_at desc)
                     from (select * from o order by paid_at desc limit 20) x), '[]'::jsonb)
    into v_n, v_total, v_items;
  return jsonb_build_object('count', v_n, 'total', v_total, 'items', v_items);
end $$;

-- ───────────── 5. Abrir, mover, cerrar y reabrir la caja ─────────────
create or replace function public.open_cash_session(p_opening numeric, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.cash_sessions;
begin
  if not public.has_role('super_admin', 'manager', 'receptionist') then raise exception 'forbidden'; end if;
  p_opening := round(p_opening, 2);
  if p_opening is null or p_opening < 0 or p_opening > 10000000 then raise exception 'invalid_amount'; end if;
  perform pg_advisory_xact_lock(hashtext('glow-cash-session'));
  if exists (select 1 from public.cash_sessions where closed_at is null) then raise exception 'cash_already_open'; end if;
  insert into public.cash_sessions (opened_by, opening_amount, opening_note)
  values (public.actor_id(), p_opening, nullif(trim(left(coalesce(p_note, ''), 300)), '')) returning * into s;
  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
  values (public.actor_id(), 'open_cash_session', 'cash_sessions', s.id, jsonb_build_object('number', s.session_number, 'opening', p_opening, 'note', s.opening_note));
  return jsonb_build_object('id', s.id, 'number', s.session_number);
end $$;

-- Entrada o salida de efectivo en el turno abierto. Una salida no puede ser mayor que el efectivo que hay en la caja.
create or replace function public.add_cash_movement(
  p_kind text, p_category text, p_amount numeric, p_description text default null, p_employee uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.cash_sessions; v_emp public.employees; v_mv public.cash_movements; v_expected numeric; v_desc text := nullif(trim(left(coalesce(p_description, ''), 200)), '');
begin
  if not public.has_role('super_admin', 'manager', 'receptionist') then raise exception 'forbidden'; end if;
  p_amount := round(p_amount, 2);
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then raise exception 'invalid_amount'; end if;
  if p_kind not in ('entrada', 'salida') then raise exception 'invalid_movement_kind'; end if;
  if not ((p_kind = 'entrada' and p_category in ('aporte', 'otro')) or (p_kind = 'salida' and p_category in ('pago_especialista', 'propina', 'compra', 'gasto', 'retiro', 'otro'))) then
    raise exception 'invalid_category';
  end if;
  if p_category = 'otro' and v_desc is null then raise exception 'description_required'; end if;
  if p_category in ('pago_especialista', 'propina') then
    select * into v_emp from public.employees where id = p_employee;
    if p_employee is null or not found then raise exception 'employee_required'; end if;
  end if;
  select * into s from public.cash_sessions where closed_at is null for update;
  if not found then raise exception 'cash_not_open'; end if;
  v_expected := (public._cash_totals(s.id)->>'expected')::numeric;
  if p_kind = 'salida' and p_amount > v_expected then raise exception 'insufficient_cash'; end if;
  insert into public.cash_movements (session_id, kind, category, amount, description, employee_id, employee_name, created_by)
  values (s.id, p_kind, p_category, p_amount, v_desc,
          case when p_category in ('pago_especialista', 'propina') then v_emp.id end,
          case when p_category in ('pago_especialista', 'propina') then v_emp.full_name end, public.actor_id())
  returning * into v_mv;
  return jsonb_build_object('id', v_mv.id, 'expected', case when p_kind = 'salida' then v_expected - p_amount else v_expected + p_amount end);
end $$;

-- Anular un movimiento (solo gerencia). Solo mientras el turno sigue abierto; queda el motivo.
create or replace function public.void_cash_movement(p_movement uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_mv public.cash_movements; s public.cash_sessions; v_expected numeric;
begin
  if not public.has_role('super_admin', 'manager') then raise exception 'forbidden'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into v_mv from public.cash_movements where id = p_movement for update;
  if not found then raise exception 'cash_movement_not_found'; end if;
  if v_mv.voided_at is not null then raise exception 'cash_movement_voided'; end if;
  select * into s from public.cash_sessions where id = v_mv.session_id for update;
  if s.closed_at is not null then raise exception 'cash_session_closed'; end if;
  v_expected := (public._cash_totals(s.id)->>'expected')::numeric;
  if v_mv.kind = 'entrada' and v_expected - v_mv.amount < 0 then raise exception 'insufficient_cash'; end if;
  update public.cash_movements set voided_at = clock_timestamp(), voided_by = public.actor_id(), void_reason = trim(left(p_reason, 300)) where id = v_mv.id;
  return jsonb_build_object('id', v_mv.id, 'expected', case when v_mv.kind = 'entrada' then v_expected - v_mv.amount else v_expected + v_mv.amount end);
end $$;

-- Cerrar el turno: se compara lo contado con lo esperado. Si hay diferencia, la nota es obligatoria.
create or replace function public.close_cash_session(p_counted numeric, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.cash_sessions; v_now timestamptz := clock_timestamp(); v_expected numeric; v_diff numeric; v_note text := nullif(trim(left(coalesce(p_note, ''), 300)), '');
begin
  if not public.has_role('super_admin', 'manager', 'receptionist') then raise exception 'forbidden'; end if;
  p_counted := round(p_counted, 2);
  if p_counted is null or p_counted < 0 or p_counted > 1000000000 then raise exception 'invalid_amount'; end if;
  select * into s from public.cash_sessions where closed_at is null for update;
  if not found then raise exception 'cash_not_open'; end if;
  v_expected := (public._cash_totals(s.id, v_now)->>'expected')::numeric;
  v_diff := round(p_counted - v_expected, 2);
  if v_diff <> 0 and v_note is null then raise exception 'difference_note_required'; end if;
  update public.cash_sessions
     set closed_at = v_now, closed_by = public.actor_id(), expected_cash = v_expected, counted_cash = p_counted, difference = v_diff,
         closing_note = v_note, report = public._cash_report(s.id, v_now)
   where id = s.id;
  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
  values (public.actor_id(), 'close_cash_session', 'cash_sessions', s.id,
          jsonb_build_object('number', s.session_number, 'expected', v_expected, 'counted', p_counted, 'difference', v_diff, 'note', v_note));
  return jsonb_build_object('id', s.id, 'number', s.session_number, 'expected', v_expected, 'counted', p_counted, 'difference', v_diff);
end $$;

-- Reabrir el último cierre (solo gerencia) si se contó mal o se olvidó un movimiento.
create or replace function public.reopen_cash_session(p_session uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.cash_sessions;
begin
  if not public.has_role('super_admin', 'manager') then raise exception 'forbidden'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  perform pg_advisory_xact_lock(hashtext('glow-cash-session'));
  select * into s from public.cash_sessions where id = p_session for update;
  if not found then raise exception 'cash_session_not_found'; end if;
  if s.closed_at is null then raise exception 'cash_already_open'; end if;
  if exists (select 1 from public.cash_sessions where closed_at is null) then raise exception 'cash_already_open'; end if;
  if exists (select 1 from public.cash_sessions where opened_at > s.opened_at) then raise exception 'cash_not_latest'; end if;
  insert into public.audit_logs (user_id, action, entity, entity_id, before_data, after_data)
  values (public.actor_id(), 'reopen_cash_session', 'cash_sessions', s.id,
          jsonb_build_object('closed_at', s.closed_at, 'expected', s.expected_cash, 'counted', s.counted_cash, 'difference', s.difference, 'note', s.closing_note),
          jsonb_build_object('reason', trim(left(p_reason, 300)), 'number', s.session_number));
  update public.cash_sessions
     set closed_at = null, closed_by = null, expected_cash = null, counted_cash = null, difference = null, closing_note = null, report = null
   where id = s.id;
  return jsonb_build_object('id', s.id, 'number', s.session_number);
end $$;

-- ───────────── 6. Cobros con efectivo recibido y vuelto ─────────────
-- El efectivo entregado (p_tendered) solo aplica a métodos de efectivo y no puede ser menor que lo cobrado.
create or replace function public._tendered_ok(p_method text, p_amount numeric, p_tendered numeric) returns void
language plpgsql stable set search_path = public as $$
begin
  if p_tendered is null then return; end if;
  if not exists (select 1 from public.payment_methods where key = p_method and is_cash) then raise exception 'tendered_not_cash'; end if;
  if p_tendered > 10000000 then raise exception 'invalid_amount'; end if;
  if round(p_tendered, 2) < p_amount then raise exception 'tendered_too_low'; end if;
end $$;
revoke execute on function public._tendered_ok(text, numeric, numeric) from public, anon, authenticated;

drop function if exists public.record_payment(uuid, numeric, text, text, boolean);
create or replace function public.record_payment(
  p_appointment uuid, p_amount numeric, p_method text, p_reference text default null, p_allow_overpay boolean default false, p_tendered numeric default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.appointments; v_sale public.sales; v_due numeric; v_paid numeric; v_pid uuid;
begin
  if not public.has_role('super_admin', 'manager', 'receptionist') then raise exception 'forbidden'; end if;
  p_amount := round(p_amount, 2);
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  perform public._payment_method_ok(p_method);
  perform public._tendered_ok(p_method, p_amount, p_tendered);
  select * into a from public.appointments where id = p_appointment for update;
  if not found then raise exception 'appointment_not_found'; end if;
  if a.status in ('cancelado', 'no_asistio') then raise exception 'appointment_closed'; end if;
  select * into v_sale from public.sales where appointment_id = a.id;
  if found then
    if v_sale.voided_at is not null then raise exception 'sale_voided'; end if;
    v_due := v_sale.total;
  else
    select coalesce(sum(final_price * quantity), 0) - a.discount + a.tip into v_due from public.appointment_services where appointment_id = a.id;
  end if;
  select coalesce(sum(amount), 0) into v_paid from public.payments where appointment_id = a.id and status = 'pagado';
  if v_paid + p_amount > v_due and not p_allow_overpay then raise exception 'overpayment'; end if;
  insert into public.payments (sale_id, appointment_id, amount, method, reference, tendered, created_by, is_demo)
  values (v_sale.id, a.id, p_amount, p_method, nullif(trim(p_reference), ''), round(p_tendered, 2), public.actor_id(), a.is_demo) returning id into v_pid;
  if v_sale.id is not null then perform public.refresh_sale_payment_status(v_sale.id); end if;
  return jsonb_build_object('payment_id', v_pid, 'pending', greatest(v_due - v_paid - p_amount, 0));
end $$;

drop function if exists public.record_sale_payment(uuid, numeric, text, text, boolean);
create or replace function public.record_sale_payment(
  p_sale uuid, p_amount numeric, p_method text, p_reference text default null, p_allow_overpay boolean default false, p_tendered numeric default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sales; v_paid numeric; v_pid uuid;
begin
  if not public.has_role('super_admin', 'manager', 'receptionist') then raise exception 'forbidden'; end if;
  p_amount := round(p_amount, 2);
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  perform public._payment_method_ok(p_method);
  perform public._tendered_ok(p_method, p_amount, p_tendered);
  select * into s from public.sales where id = p_sale for update;
  if not found then raise exception 'sale_not_found'; end if;
  if s.voided_at is not null then raise exception 'sale_voided'; end if;
  select coalesce(sum(amount), 0) into v_paid from public.payments where sale_id = s.id and status = 'pagado';
  if v_paid + p_amount > s.total and not p_allow_overpay then raise exception 'overpayment'; end if;
  insert into public.payments (sale_id, appointment_id, amount, method, reference, tendered, created_by, is_demo)
  values (s.id, s.appointment_id, p_amount, p_method, nullif(trim(p_reference), ''), round(p_tendered, 2), public.actor_id(), s.is_demo) returning id into v_pid;
  perform public.refresh_sale_payment_status(s.id);
  return jsonb_build_object('payment_id', v_pid, 'pending', greatest(s.total - v_paid - p_amount, 0));
end $$;

-- p: { client_id?, employee_id?, discount?, tip?, notes?, allow_overpay?,
--      items:[{description, quantity, unit_price, service_id?}], payments:[{method, amount, reference?, tendered?}] }
create or replace function public.create_quick_sale(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sub numeric := 0; v_item jsonb; v_disc numeric := coalesce(nullif(p->>'discount', '')::numeric, 0);
  v_tip numeric := coalesce(nullif(p->>'tip', '')::numeric, 0); v_total numeric; v_paid numeric := 0;
  v_sale public.sales; v_pay jsonb; v_qty int; v_price numeric; v_client uuid := nullif(p->>'client_id', '')::uuid;
  v_emp uuid := nullif(p->>'employee_id', '')::uuid; v_allow boolean := coalesce((p->>'allow_overpay')::boolean, false);
begin
  if not public.has_role('super_admin', 'manager', 'receptionist') then raise exception 'forbidden'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'no_items'; end if;
  for v_item in select * from jsonb_array_elements(p->'items') loop
    v_qty := coalesce(nullif(v_item->>'quantity', '')::int, 1); v_price := (v_item->>'unit_price')::numeric;
    if v_qty < 1 or v_price is null or v_price < 0 or coalesce(trim(v_item->>'description'), '') = '' then raise exception 'invalid_item'; end if;
    v_sub := v_sub + v_qty * v_price;
  end loop;
  if v_disc < 0 or v_tip < 0 then raise exception 'invalid_amount'; end if;
  if v_disc > v_sub then raise exception 'discount_exceeds_subtotal'; end if;
  v_total := v_sub - v_disc + v_tip;
  for v_pay in select * from jsonb_array_elements(coalesce(p->'payments', '[]'::jsonb)) loop
    if coalesce((v_pay->>'amount')::numeric, 0) <= 0 then raise exception 'invalid_amount'; end if;
    perform public._payment_method_ok(v_pay->>'method');
    perform public._tendered_ok(v_pay->>'method', round((v_pay->>'amount')::numeric, 2), nullif(v_pay->>'tendered', '')::numeric);
    v_paid := v_paid + (v_pay->>'amount')::numeric;
  end loop;
  if v_paid > v_total and not v_allow then raise exception 'overpayment'; end if;

  insert into public.sales (sale_number, client_id, employee_id, subtotal, discount, tip, total, notes, created_by)
  values (public.next_sale_number(), v_client, v_emp, v_sub, v_disc, v_tip, v_total, nullif(trim(left(p->>'notes', 1000)), ''), public.actor_id())
  returning * into v_sale;
  insert into public.sale_items (sale_id, service_id, category_id, employee_id, description, quantity, unit_price, total)
  select v_sale.id, nullif(i->>'service_id', '')::uuid, sv.category_id, v_emp, trim(i->>'description'),
         coalesce(nullif(i->>'quantity', '')::int, 1), (i->>'unit_price')::numeric,
         coalesce(nullif(i->>'quantity', '')::int, 1) * (i->>'unit_price')::numeric
  from jsonb_array_elements(p->'items') i left join public.services sv on sv.id = nullif(i->>'service_id', '')::uuid;
  for v_pay in select * from jsonb_array_elements(coalesce(p->'payments', '[]'::jsonb)) loop
    insert into public.payments (sale_id, amount, method, reference, tendered, created_by)
    values (v_sale.id, (v_pay->>'amount')::numeric, v_pay->>'method', nullif(trim(v_pay->>'reference'), ''),
            round(nullif(v_pay->>'tendered', '')::numeric, 2), public.actor_id());
  end loop;
  perform public.refresh_sale_payment_status(v_sale.id);
  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
  values (public.actor_id(), 'quick_sale', 'sales', v_sale.id, jsonb_build_object('sale_number', v_sale.sale_number, 'total', v_total));
  return jsonb_build_object('sale_id', v_sale.id, 'sale_number', v_sale.sale_number);
end $$;

-- ───────────── 7. Permisos de ejecución ─────────────
do $$ declare f text; begin
  foreach f in array array[
    'public.record_payment(uuid, numeric, text, text, boolean, numeric)',
    'public.record_sale_payment(uuid, numeric, text, text, boolean, numeric)',
    'public.create_quick_sale(jsonb)',
    'public.cash_session_report(uuid)',
    'public.cash_unassigned()',
    'public.open_cash_session(numeric, text)',
    'public.add_cash_movement(text, text, numeric, text, uuid)',
    'public.void_cash_movement(uuid, text)',
    'public.close_cash_session(numeric, text)',
    'public.reopen_cash_session(uuid, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
