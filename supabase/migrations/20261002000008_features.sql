-- Glow Beauty Center — funcionalidades de administración completas

-- ───────────── 1. Métodos de pago configurables ─────────────
create table public.payment_methods (
  key text primary key check (key ~ '^[a-z0-9_]{2,30}$'),
  label text not null check (length(trim(label)) between 1 and 40),
  active boolean not null default true,
  display_order int not null default 0
);
insert into public.payment_methods (key, label, display_order) values
  ('efectivo', 'Efectivo', 1), ('tarjeta', 'Tarjeta', 2), ('transferencia', 'Transferencia', 3), ('otro', 'Otro', 4);

drop function if exists public.record_payment(uuid, numeric, public.payment_method, text, boolean);
alter table public.payments alter column method type text using method::text;
alter table public.payments add constraint payments_method_fkey
  foreign key (method) references public.payment_methods(key) on update cascade;
drop type public.payment_method;

-- ───────────── 2. Productos, categorías con imagen, vínculo con promociones ─────────────
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  price numeric(10,2) not null check (price >= 0),
  active boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.service_categories add column if not exists image_url text;
alter table public.sales add column if not exists voided_at timestamptz, add column if not exists void_reason text;
alter table public.notifications add column if not exists sale_id uuid references public.sales(id) on delete cascade;

-- ───────────── 3. Estado de pago (respeta ventas anuladas) ─────────────
create or replace function public.refresh_sale_payment_status(p_sale uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_paid numeric; v_ref numeric; v_void timestamptz;
begin
  select total, voided_at into v_total, v_void from public.sales where id = p_sale;
  if v_void is not null then return; end if;
  select coalesce(sum(amount) filter (where status = 'pagado'), 0), coalesce(sum(amount) filter (where status = 'reembolsado'), 0)
    into v_paid, v_ref from public.payments where sale_id = p_sale;
  update public.sales set payment_status = public.compute_payment_status(v_total, v_paid, v_ref) where id = p_sale;
end $$;

create or replace function public._payment_method_ok(p_method text) returns void
language plpgsql stable set search_path = public as $$
begin
  if not exists (select 1 from public.payment_methods where key = p_method and active) then raise exception 'invalid_method'; end if;
end $$;

-- ───────────── 4. Pagos ─────────────
-- Antes de completar la cita (ligado a la cita) o después (ligado a la venta).
create or replace function public.record_payment(
  p_appointment uuid, p_amount numeric, p_method text, p_reference text default null, p_allow_overpay boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.appointments; v_sale public.sales; v_due numeric; v_paid numeric; v_pid uuid;
begin
  if not public.has_role('super_admin', 'manager', 'receptionist') then raise exception 'forbidden'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  perform public._payment_method_ok(p_method);
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
  insert into public.payments (sale_id, appointment_id, amount, method, reference, created_by, is_demo)
  values (v_sale.id, a.id, p_amount, p_method, nullif(trim(p_reference), ''), public.actor_id(), a.is_demo) returning id into v_pid;
  if v_sale.id is not null then perform public.refresh_sale_payment_status(v_sale.id); end if;
  return jsonb_build_object('payment_id', v_pid, 'pending', greatest(v_due - v_paid - p_amount, 0));
end $$;

create or replace function public.record_sale_payment(
  p_sale uuid, p_amount numeric, p_method text, p_reference text default null, p_allow_overpay boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.sales; v_paid numeric; v_pid uuid;
begin
  if not public.has_role('super_admin', 'manager', 'receptionist') then raise exception 'forbidden'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  perform public._payment_method_ok(p_method);
  select * into s from public.sales where id = p_sale for update;
  if not found then raise exception 'sale_not_found'; end if;
  if s.voided_at is not null then raise exception 'sale_voided'; end if;
  select coalesce(sum(amount), 0) into v_paid from public.payments where sale_id = s.id and status = 'pagado';
  if v_paid + p_amount > s.total and not p_allow_overpay then raise exception 'overpayment'; end if;
  insert into public.payments (sale_id, appointment_id, amount, method, reference, created_by, is_demo)
  values (s.id, s.appointment_id, p_amount, p_method, nullif(trim(p_reference), ''), public.actor_id(), s.is_demo) returning id into v_pid;
  perform public.refresh_sale_payment_status(s.id);
  return jsonb_build_object('payment_id', v_pid, 'pending', greatest(s.total - v_paid - p_amount, 0));
end $$;

-- ───────────── 5. Anular venta / notas de venta ─────────────
create or replace function public.void_sale(p_sale uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.sales;
begin
  if not public.has_role('super_admin', 'manager') then raise exception 'forbidden'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into s from public.sales where id = p_sale for update;
  if not found then raise exception 'sale_not_found'; end if;
  if s.voided_at is not null then return jsonb_build_object('sale_id', s.id, 'already_voided', true); end if;
  update public.payments set status = 'reembolsado' where sale_id = s.id and status = 'pagado';
  update public.sales set payment_status = 'reembolsado', voided_at = now(), void_reason = trim(p_reason) where id = s.id;
  if s.appointment_id is not null then
    update public.appointments set status = 'cancelado' where id = s.appointment_id and status = 'completado';
  end if;
  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
  values (public.actor_id(), 'void_sale', 'sales', s.id, jsonb_build_object('reason', trim(p_reason), 'total', s.total, 'sale_number', s.sale_number));
  return jsonb_build_object('sale_id', s.id, 'already_voided', false);
end $$;

create or replace function public.update_sale_notes(p_sale uuid, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('super_admin', 'manager') then raise exception 'forbidden'; end if;
  update public.sales set notes = nullif(trim(left(p_notes, 1000)), '') where id = p_sale;
  if not found then raise exception 'sale_not_found'; end if;
end $$;

drop policy if exists sales_update_notes on public.sales;

-- ───────────── 6. Venta rápida (mostrador): productos / servicios sin cita ─────────────
-- p: { client_id?, employee_id?, discount?, tip?, notes?, allow_overpay?,
--      items:[{description, quantity, unit_price, service_id?}], payments:[{method, amount, reference?}] }
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
    insert into public.payments (sale_id, amount, method, reference, created_by)
    values (v_sale.id, (v_pay->>'amount')::numeric, v_pay->>'method', nullif(trim(v_pay->>'reference'), ''), public.actor_id());
  end loop;
  perform public.refresh_sale_payment_status(v_sale.id);
  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
  values (public.actor_id(), 'quick_sale', 'sales', v_sale.id, jsonb_build_object('sale_number', v_sale.sale_number, 'total', v_total));
  return jsonb_build_object('sale_id', v_sale.id, 'sale_number', v_sale.sale_number);
end $$;

-- ───────────── 7. Notificaciones: no avisar cancelación de citas ya completadas (anulación de venta) ─────────────
create or replace function public.notify_appointment() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select first_name || ' ' || last_name into v_name from public.clients where id = new.client_id;
  if tg_op = 'INSERT' and new.status = 'solicitud' then
    insert into public.notifications (type, title, body, appointment_id)
    values ('nueva_reservacion', 'Nueva solicitud de ' || trim(v_name), to_char(new.start_time at time zone 'America/Santo_Domingo', 'DD/MM HH12:MI AM'), new.id);
  elsif tg_op = 'UPDATE' and new.status = 'cancelado' and old.status not in ('cancelado', 'completado') then
    insert into public.notifications (type, title, body, appointment_id)
    values ('cita_cancelada', 'Cita cancelada: ' || trim(v_name), to_char(new.start_time at time zone 'America/Santo_Domingo', 'DD/MM HH12:MI AM'), new.id);
  elsif tg_op = 'UPDATE' and new.status not in ('cancelado', 'completado', 'no_asistio') and new.start_time <> old.start_time then
    insert into public.notifications (type, title, body, appointment_id)
    values ('cita_modificada', 'Cita modificada: ' || trim(v_name), to_char(new.start_time at time zone 'America/Santo_Domingo', 'DD/MM HH12:MI AM'), new.id);
  end if;
  return new;
end $$;

-- ───────────── 8. Recordatorios internos: cita próxima y pago pendiente ─────────────
create unique index if not exists notifications_reminder_uidx on public.notifications (type, coalesce(appointment_id, sale_id))
  where type in ('cita_proxima', 'pago_pendiente');

create or replace function public.generate_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare n1 int := 0; n2 int := 0;
begin
  insert into public.notifications (type, title, body, appointment_id)
  select 'cita_proxima', 'Cita en menos de 1 hora: ' || trim(c.first_name || ' ' || c.last_name),
         to_char(a.start_time at time zone 'America/Santo_Domingo', 'HH12:MI AM'), a.id
  from public.appointments a join public.clients c on c.id = a.client_id
  where a.status in ('solicitud', 'contactando', 'contactado', 'confirmado') and a.start_time between now() and now() + interval '60 minutes'
  on conflict do nothing;
  get diagnostics n1 = row_count;
  insert into public.notifications (type, title, body, sale_id)
  select 'pago_pendiente', 'Pago pendiente: ' || s.sale_number, 'Saldo RD$ ' || (s.total - coalesce(p.paid, 0)), s.id
  from public.sales s
  left join lateral (select sum(amount) as paid from public.payments where sale_id = s.id and status = 'pagado') p on true
  where s.payment_status in ('pendiente', 'parcial') and s.voided_at is null and s.completed_at < now() - interval '2 hours'
  on conflict do nothing;
  get diagnostics n2 = row_count;
  return n1 + n2;
end $$;

do $$ begin
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('glow-reminders', '*/5 * * * *', 'select public.generate_reminders()');
exception when others then
  raise notice 'pg_cron no disponible (%): usa /api/cron/reminders', sqlerrm;
end $$;

-- ───────────── 9. Auditoría ampliada ─────────────
do $$ declare t text; begin
  foreach t in array array['clients', 'employees', 'service_categories', 'service_variants', 'service_addons', 'promotions',
                           'gallery', 'business_settings', 'profiles', 'payment_methods', 'products', 'schedule_blocks'] loop
    execute format('create trigger t_audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;
drop trigger if exists t_audit_services on public.services;
create trigger t_audit_services after insert or update or delete on public.services for each row execute function public.audit_row();

-- ───────────── 10. Realtime para ventas y pagos (RLS aplica) ─────────────
do $$ begin
  alter publication supabase_realtime add table public.sales, public.payments;
exception when duplicate_object then null; end $$;

-- ───────────── 11. Integración de calendario por defecto ─────────────
insert into public.calendar_integrations (provider, enabled)
select 'google', false where not exists (select 1 from public.calendar_integrations where provider = 'google');

-- ───────────── 12. RLS de tablas nuevas y ajustes de permisos ─────────────
alter table public.payment_methods enable row level security;
alter table public.products enable row level security;

create policy pm_read on public.payment_methods for select to authenticated using (public.is_staff());
create policy pm_write on public.payment_methods for all to authenticated
  using (public.has_role('super_admin', 'manager')) with check (public.has_role('super_admin', 'manager'));
create policy prod_read on public.products for select to authenticated using (public.is_staff());
create policy prod_write on public.products for all to authenticated
  using (public.has_role('super_admin', 'manager')) with check (public.has_role('super_admin', 'manager'));

-- Citas: recepción crea/edita, solo gerencia elimina
drop policy if exists appt_write on public.appointments;
create policy appt_insert on public.appointments for insert to authenticated
  with check (public.has_role('super_admin', 'manager', 'receptionist'));
create policy appt_update on public.appointments for update to authenticated
  using (public.has_role('super_admin', 'manager', 'receptionist')) with check (public.has_role('super_admin', 'manager', 'receptionist'));
create policy appt_delete on public.appointments for delete to authenticated
  using (public.has_role('super_admin', 'manager'));

-- Clientes: recepción crea/edita, solo gerencia elimina
drop policy if exists clients_write on public.clients;
create policy clients_insert on public.clients for insert to authenticated
  with check (public.has_role('super_admin', 'manager', 'receptionist'));
create policy clients_update on public.clients for update to authenticated
  using (public.has_role('super_admin', 'manager', 'receptionist')) with check (public.has_role('super_admin', 'manager', 'receptionist'));
create policy clients_delete on public.clients for delete to authenticated
  using (public.has_role('super_admin', 'manager'));

-- Todo el personal puede leer los ajustes (plantillas, métodos, etc.); solo gerencia los modifica
drop policy if exists settings_read on public.business_settings;
create policy settings_read on public.business_settings for select to anon, authenticated
  using (is_public or public.is_staff());

-- Notas de cita: solo sobre citas visibles para quien escribe
drop policy if exists anotes_write on public.appointment_notes;
create policy anotes_write on public.appointment_notes for insert to authenticated
  with check (public.is_staff() and created_by = auth.uid()
              and exists (select 1 from public.appointments a where a.id = appointment_id));
