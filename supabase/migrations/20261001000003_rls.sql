-- Glow Beauty Center — Row Level Security
-- Reglas: anon solo lee catálogo público. Las reservas públicas pasan por el servidor (service_role).

do $$ declare t text; begin
  for t in select unnest(array[
    'roles','profiles','employees','employee_schedules','employee_time_off','service_categories','services',
    'service_variants','service_addons','employee_services','clients','appointments','appointment_services',
    'appointment_status_history','appointment_notes','schedule_blocks','sale_counters','sales','sale_items',
    'payments','promotions','promotion_services','gallery','business_settings','notifications','audit_logs',
    'calendar_integrations']) loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Atajos
-- A = super_admin, manager ; R = + receptionist ; S = todos los roles de staff
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('super_admin','manager','receptionist','specialist')
$$;

-- ── roles / profiles
create policy roles_read on public.roles for select to authenticated using (public.is_staff());
create policy profiles_self on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role('super_admin','manager'));
create policy profiles_admin on public.profiles for all to authenticated
  using (public.has_role('super_admin')) with check (public.has_role('super_admin'));

-- ── catálogo público (lectura anon) + escritura admin
create policy cat_read on public.service_categories for select to anon, authenticated
  using (active or public.is_staff());
create policy cat_write on public.service_categories for all to authenticated
  using (public.has_role('super_admin','manager')) with check (public.has_role('super_admin','manager'));

create policy svc_read on public.services for select to anon, authenticated
  using ((active and not pending_review) or public.is_staff());
create policy svc_write on public.services for all to authenticated
  using (public.has_role('super_admin','manager')) with check (public.has_role('super_admin','manager'));

create policy var_read on public.service_variants for select to anon, authenticated
  using (active or public.is_staff());
create policy var_write on public.service_variants for all to authenticated
  using (public.has_role('super_admin','manager')) with check (public.has_role('super_admin','manager'));

create policy addon_read on public.service_addons for select to anon, authenticated
  using (active or public.is_staff());
create policy addon_write on public.service_addons for all to authenticated
  using (public.has_role('super_admin','manager')) with check (public.has_role('super_admin','manager'));

create policy es_read on public.employee_services for select to anon, authenticated using (true);
create policy es_write on public.employee_services for all to authenticated
  using (public.has_role('super_admin','manager')) with check (public.has_role('super_admin','manager'));

-- Empleados: anon ve activos; no se expone email/teléfono/comisión vía vista pública
create policy emp_read_staff on public.employees for select to authenticated using (public.is_staff());
create policy emp_write on public.employees for all to authenticated
  using (public.has_role('super_admin','manager')) with check (public.has_role('super_admin','manager'));
create view public.public_employees with (security_invoker = false) as
  select id, full_name, avatar_url, specialty, bio, display_order
  from public.employees where active and accepts_online_booking;
grant select on public.public_employees to anon, authenticated;

create policy sched_read on public.employee_schedules for select to authenticated using (public.is_staff());
create policy sched_write on public.employee_schedules for all to authenticated
  using (public.has_role('super_admin','manager')) with check (public.has_role('super_admin','manager'));
create policy toff_read on public.employee_time_off for select to authenticated using (public.is_staff());
create policy toff_write on public.employee_time_off for all to authenticated
  using (public.has_role('super_admin','manager')) with check (public.has_role('super_admin','manager'));
create policy blocks_read on public.schedule_blocks for select to authenticated using (public.is_staff());
create policy blocks_write on public.schedule_blocks for all to authenticated
  using (public.has_role('super_admin','manager','receptionist'))
  with check (public.has_role('super_admin','manager','receptionist'));

-- ── clientes
create policy clients_read on public.clients for select to authenticated using (
  public.has_role('super_admin','manager','receptionist')
  or (public.has_role('specialist') and exists (
        select 1 from public.appointments a
        where a.client_id = clients.id and a.employee_id = public.my_employee_id())));
create policy clients_write on public.clients for all to authenticated
  using (public.has_role('super_admin','manager','receptionist'))
  with check (public.has_role('super_admin','manager','receptionist'));

-- ── citas
create policy appt_read on public.appointments for select to authenticated using (
  public.has_role('super_admin','manager','receptionist')
  or (public.has_role('specialist') and employee_id = public.my_employee_id()));
create policy appt_write on public.appointments for all to authenticated
  using (public.has_role('super_admin','manager','receptionist'))
  with check (public.has_role('super_admin','manager','receptionist'));
-- El especialista solo marca inicio/fin de SUS citas
create policy appt_specialist_update on public.appointments for update to authenticated
  using (public.has_role('specialist') and employee_id = public.my_employee_id())
  with check (public.has_role('specialist') and employee_id = public.my_employee_id()
              and status in ('en_servicio','completado'));

create policy apsvc_read on public.appointment_services for select to authenticated using (
  exists (select 1 from public.appointments a where a.id = appointment_id));  -- hereda RLS de appointments
create policy apsvc_write on public.appointment_services for all to authenticated
  using (public.has_role('super_admin','manager','receptionist'))
  with check (public.has_role('super_admin','manager','receptionist'));

create policy hist_read on public.appointment_status_history for select to authenticated using (
  exists (select 1 from public.appointments a where a.id = appointment_id));
create policy anotes_read on public.appointment_notes for select to authenticated using (
  exists (select 1 from public.appointments a where a.id = appointment_id));
create policy anotes_write on public.appointment_notes for insert to authenticated
  with check (public.is_staff() and created_by = auth.uid());

-- ── ventas y pagos (sin acceso de especialistas)
create policy sales_read on public.sales for select to authenticated
  using (public.has_role('super_admin','manager','receptionist'));
create policy sale_items_read on public.sale_items for select to authenticated
  using (public.has_role('super_admin','manager','receptionist'));
create policy pay_read on public.payments for select to authenticated
  using (public.has_role('super_admin','manager','receptionist'));
-- Escrituras de ventas/pagos solo mediante RPC security definer (complete_appointment, record_payment, refund_payment)
create policy sales_update_notes on public.sales for update to authenticated
  using (public.has_role('super_admin','manager')) with check (public.has_role('super_admin','manager'));

-- ── promociones, galería, ajustes
create policy promo_read on public.promotions for select to anon, authenticated
  using ((active and (starts_on is null or starts_on <= current_date) and (ends_on is null or ends_on >= current_date))
         or public.is_staff());
create policy promo_write on public.promotions for all to authenticated
  using (public.has_role('super_admin','manager')) with check (public.has_role('super_admin','manager'));
create policy promosvc_read on public.promotion_services for select to anon, authenticated using (true);
create policy promosvc_write on public.promotion_services for all to authenticated
  using (public.has_role('super_admin','manager')) with check (public.has_role('super_admin','manager'));

create policy gallery_read on public.gallery for select to anon, authenticated using (active or public.is_staff());
create policy gallery_write on public.gallery for all to authenticated
  using (public.has_role('super_admin','manager')) with check (public.has_role('super_admin','manager'));

create policy settings_read on public.business_settings for select to anon, authenticated
  using (is_public or public.has_role('super_admin','manager'));
create policy settings_write on public.business_settings for all to authenticated
  using (public.has_role('super_admin','manager')) with check (public.has_role('super_admin','manager'));

-- ── notificaciones, auditoría, integraciones
create policy notif_read on public.notifications for select to authenticated
  using (public.has_role('super_admin','manager','receptionist'));
create policy notif_update on public.notifications for update to authenticated
  using (public.has_role('super_admin','manager','receptionist'))
  with check (public.has_role('super_admin','manager','receptionist'));
create policy audit_read on public.audit_logs for select to authenticated
  using (public.has_role('super_admin','manager'));
create policy calint_all on public.calendar_integrations for all to authenticated
  using (public.has_role('super_admin')) with check (public.has_role('super_admin'));

-- sale_counters: sin policies (solo funciones security definer)

-- ───────────── Storage ─────────────
insert into storage.buckets (id, name, public) values
  ('service-images','service-images',true),
  ('gallery','gallery',true),
  ('employee-avatars','employee-avatars',true),
  ('receipts','receipts',false)
on conflict (id) do nothing;

create policy "public read images" on storage.objects for select to anon, authenticated
  using (bucket_id in ('service-images','gallery','employee-avatars'));
create policy "staff upload images" on storage.objects for insert to authenticated
  with check (bucket_id in ('service-images','gallery','employee-avatars')
              and public.has_role('super_admin','manager'));
create policy "staff update images" on storage.objects for update to authenticated
  using (bucket_id in ('service-images','gallery','employee-avatars')
         and public.has_role('super_admin','manager'));
create policy "staff delete images" on storage.objects for delete to authenticated
  using (bucket_id in ('service-images','gallery','employee-avatars')
         and public.has_role('super_admin','manager'));
create policy "staff receipts" on storage.objects for all to authenticated
  using (bucket_id = 'receipts' and public.has_role('super_admin','manager','receptionist'))
  with check (bucket_id = 'receipts' and public.has_role('super_admin','manager','receptionist'));
