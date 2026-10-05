-- Glow Beauty Center — funciones, triggers y RPCs

-- ───────────── Helpers de rol ─────────────
create or replace function public.current_role_key() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.has_role(variadic roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_key() = any(roles), false)
$$;

create or replace function public.my_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select employee_id from public.profiles where id = auth.uid() and active
$$;

-- El primer usuario que se registra es super_admin; el resto NO recibe perfil
-- (sin perfil = sin acceso al panel). Desactiva el registro público en Supabase Auth.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles) then
    insert into public.profiles (id, full_name, role)
    values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'super_admin');
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────── Historial de estados ─────────────
create or replace function public.actor_id() returns uuid
language sql stable as $$
  select coalesce(auth.uid(), nullif(current_setting('app.user_id', true), '')::uuid)
$$;

create or replace function public.log_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.appointment_status_history (appointment_id, old_status, new_status, changed_by)
    values (new.id, null, new.status, public.actor_id());
  elsif new.status is distinct from old.status then
    insert into public.appointment_status_history (appointment_id, old_status, new_status, changed_by)
    values (new.id, old.status, new.status, public.actor_id());
  end if;
  return new;
end $$;
create trigger t_appt_status after insert or update on public.appointments
  for each row execute function public.log_status_change();

-- ───────────── Auditoría genérica ─────────────
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  v_id := coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id'))::uuid;
  insert into public.audit_logs (user_id, action, entity, entity_id, before_data, after_data)
  values (public.actor_id(), lower(tg_op), tg_table_name, v_id,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger t_audit_appts after insert or update or delete on public.appointments
  for each row execute function public.audit_row();
create trigger t_audit_appt_services after insert or update or delete on public.appointment_services
  for each row execute function public.audit_row();
create trigger t_audit_payments after insert or update or delete on public.payments
  for each row execute function public.audit_row();
create trigger t_audit_sales after insert or update or delete on public.sales
  for each row execute function public.audit_row();
create trigger t_audit_services after update on public.services
  for each row execute function public.audit_row();

-- ───────────── Notificaciones internas ─────────────
create or replace function public.notify_appointment() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select first_name || ' ' || last_name into v_name from public.clients where id = new.client_id;
  if tg_op = 'INSERT' and new.status = 'solicitud' then
    insert into public.notifications (type, title, body, appointment_id)
    values ('nueva_reservacion', 'Nueva solicitud de ' || trim(v_name),
            to_char(new.start_time at time zone 'America/Santo_Domingo', 'DD/MM HH12:MI AM'), new.id);
  elsif tg_op = 'UPDATE' and new.status = 'cancelado' and old.status <> 'cancelado' then
    insert into public.notifications (type, title, body, appointment_id)
    values ('cita_cancelada', 'Cita cancelada: ' || trim(v_name),
            to_char(new.start_time at time zone 'America/Santo_Domingo', 'DD/MM HH12:MI AM'), new.id);
  elsif tg_op = 'UPDATE' and (new.start_time <> old.start_time or new.employee_id is distinct from old.employee_id) then
    insert into public.notifications (type, title, body, appointment_id)
    values ('cita_modificada', 'Cita modificada: ' || trim(v_name),
            to_char(new.start_time at time zone 'America/Santo_Domingo', 'DD/MM HH12:MI AM'), new.id);
  end if;
  return new;
end $$;
create trigger t_notify_appt after insert or update on public.appointments
  for each row execute function public.notify_appointment();

-- ───────────── Numeración de ventas: GBC-YYYYMM-00001 ─────────────
create or replace function public.next_sale_number() returns text
language plpgsql security definer set search_path = public as $$
declare v_period text := to_char(now() at time zone 'America/Santo_Domingo', 'YYYYMM'); v_n int;
begin
  insert into public.sale_counters (period, last_value) values (v_period, 1)
  on conflict (period) do update set last_value = public.sale_counters.last_value + 1
  returning last_value into v_n;
  return 'GBC-' || v_period || '-' || lpad(v_n::text, 5, '0');
end $$;

-- ───────────── Estado de pago ─────────────
create or replace function public.compute_payment_status(p_total numeric, p_paid numeric, p_refunded numeric)
returns public.payment_status language sql immutable as $$
  select case
    when p_refunded > 0 and p_paid <= 0 then 'reembolsado'::public.payment_status
    when p_paid <= 0 then 'pendiente'
    when p_paid < p_total then 'parcial'
    else 'pagado' end
$$;

create or replace function public.refresh_sale_payment_status(p_sale uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_paid numeric; v_ref numeric;
begin
  select total into v_total from public.sales where id = p_sale;
  select coalesce(sum(amount) filter (where status='pagado'),0),
         coalesce(sum(amount) filter (where status='reembolsado'),0)
    into v_paid, v_ref from public.payments where sale_id = p_sale;
  update public.sales set payment_status = public.compute_payment_status(v_total, v_paid, v_ref)
  where id = p_sale;
end $$;

-- ───────────── Crear reserva (solo servidor / service_role) ─────────────
-- p: { first_name,last_name,phone,email,notes,source,employee_id,start_time,status,created_by,
--      services:[{service_id,variant_id,addon_ids:[]}] }
create or replace function public.create_booking(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid; v_appt uuid; v_start timestamptz; v_end timestamptz;
  v_emp uuid := nullif(p->>'employee_id','')::uuid;
  v_status public.appointment_status := coalesce(nullif(p->>'status',''),'solicitud')::public.appointment_status;
  v_source public.appointment_source := coalesce(nullif(p->>'source',''),'website')::public.appointment_source;
  v_item jsonb; v_svc public.services; v_var public.service_variants;
  v_price numeric; v_dur int; v_total numeric := 0; v_minutes int := 0;
  v_addons jsonb; v_addon public.service_addons; v_aid text; v_req text;
  v_phone text := public.normalize_phone(p->>'phone');
begin
  if length(v_phone) <> 10 then raise exception 'invalid_phone'; end if;
  if coalesce(trim(p->>'first_name'),'') = '' then raise exception 'invalid_name'; end if;
  if jsonb_array_length(coalesce(p->'services','[]'::jsonb)) = 0 then raise exception 'no_services'; end if;
  v_start := (p->>'start_time')::timestamptz;
  if v_source not in ('walk_in') and v_start < now() - interval '5 minutes' then raise exception 'past_date'; end if;

  -- cliente por teléfono normalizado
  insert into public.clients (first_name, last_name, phone, email)
  values (trim(p->>'first_name'), trim(coalesce(p->>'last_name','')), v_phone, nullif(trim(p->>'email'),''))
  on conflict (phone_normalized) do update
    set email = coalesce(public.clients.email, excluded.email)
  returning id into v_client;

  -- primero calcular duración total
  for v_item in select * from jsonb_array_elements(p->'services') loop
    select * into v_svc from public.services where id = (v_item->>'service_id')::uuid;
    if not found or not v_svc.active or v_svc.pending_review then raise exception 'service_unavailable'; end if;
    v_dur := v_svc.duration_minutes;
    if nullif(v_item->>'variant_id','') is not null then
      select * into v_var from public.service_variants
      where id = (v_item->>'variant_id')::uuid and service_id = v_svc.id and active;
      if not found then raise exception 'variant_unavailable'; end if;
      v_dur := v_var.duration_minutes;
    end if;
    for v_aid in select jsonb_array_elements_text(coalesce(v_item->'addon_ids','[]'::jsonb)) loop
      select * into v_addon from public.service_addons where id = v_aid::uuid and service_id = v_svc.id and active;
      if not found then raise exception 'addon_unavailable'; end if;
      v_dur := v_dur + v_addon.duration_minutes;
    end loop;
    v_minutes := v_minutes + v_dur + v_svc.buffer_before_minutes + v_svc.buffer_after_minutes;
    if v_emp is not null and exists (select 1 from public.employee_services where service_id = v_svc.id)
       and not exists (select 1 from public.employee_services where service_id = v_svc.id and employee_id = v_emp)
    then raise exception 'employee_cannot_perform'; end if;
  end loop;
  v_end := v_start + make_interval(mins => v_minutes);

  if v_emp is not null and not exists (select 1 from public.employees where id = v_emp and active)
  then raise exception 'employee_unavailable'; end if;

  begin
    insert into public.appointments (client_id, employee_id, status, appointment_date, start_time, end_time,
      notes, source, created_by)
    values (v_client, v_emp, v_status, (v_start at time zone 'America/Santo_Domingo')::date, v_start, v_end,
      nullif(trim(p->>'notes'),''), v_source, nullif(p->>'created_by','')::uuid)
    returning id into v_appt;
  exception when exclusion_violation then
    raise exception 'slot_taken';
  end;

  for v_item in select * from jsonb_array_elements(p->'services') loop
    select * into v_svc from public.services where id = (v_item->>'service_id')::uuid;
    v_price := v_svc.price; v_dur := v_svc.duration_minutes; v_var := null;
    if nullif(v_item->>'variant_id','') is not null then
      select * into v_var from public.service_variants where id = (v_item->>'variant_id')::uuid;
      v_price := v_var.price; v_dur := v_var.duration_minutes;
    end if;
    v_addons := '[]'::jsonb;
    for v_aid in select jsonb_array_elements_text(coalesce(v_item->'addon_ids','[]'::jsonb)) loop
      select * into v_addon from public.service_addons where id = v_aid::uuid;
      v_price := v_price + v_addon.price; v_dur := v_dur + v_addon.duration_minutes;
      v_addons := v_addons || jsonb_build_object('id', v_addon.id, 'name', v_addon.name,
                    'price', v_addon.price, 'duration_minutes', v_addon.duration_minutes);
    end loop;
    insert into public.appointment_services (appointment_id, service_id, variant_id, name, price, final_price,
      duration_minutes, addons, employee_id, commission_pct)
    values (v_appt, v_svc.id, v_var.id,
      v_svc.name || case when v_var.id is not null then ' – ' || v_var.name else '' end,
      v_price, v_price, v_dur, v_addons, v_emp, v_svc.commission_pct);
    v_total := v_total + v_price;
  end loop;

  update public.appointments set estimated_total = v_total where id = v_appt;
  select request_number into v_req from public.appointments where id = v_appt;
  return jsonb_build_object('id', v_appt, 'request_number', v_req, 'client_id', v_client,
                            'estimated_total', v_total, 'end_time', v_end);
end $$;
revoke all on function public.create_booking(jsonb) from public, anon, authenticated;
grant execute on function public.create_booking(jsonb) to service_role;

-- ───────────── Completar cita → venta (idempotente) ─────────────
create or replace function public.complete_appointment(p_appointment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.appointments; v_sale public.sales; v_sub numeric; v_total numeric;
  v_paid numeric; v_ref numeric; v_emp uuid;
begin
  if not public.has_role('super_admin','manager','receptionist','specialist') then
    raise exception 'forbidden';
  end if;
  select * into a from public.appointments where id = p_appointment for update;
  if not found then raise exception 'appointment_not_found'; end if;

  if public.has_role('specialist') and a.employee_id is distinct from public.my_employee_id() then
    raise exception 'forbidden';
  end if;

  -- idempotencia: si ya existe venta, devolverla sin duplicar
  select * into v_sale from public.sales where appointment_id = a.id;
  if found then
    return jsonb_build_object('sale_id', v_sale.id, 'sale_number', v_sale.sale_number, 'already_completed', true);
  end if;

  if a.status in ('cancelado','no_asistio') then raise exception 'appointment_not_completable'; end if;
  if not exists (select 1 from public.appointment_services where appointment_id = a.id) then
    raise exception 'no_services';
  end if;

  select coalesce(sum(final_price * quantity),0) into v_sub from public.appointment_services where appointment_id = a.id;
  if a.discount > v_sub then raise exception 'discount_exceeds_subtotal'; end if;
  v_total := v_sub - a.discount + a.tip;
  v_emp := a.employee_id;

  update public.appointments
    set status = 'completado', final_total = v_total, completed_at = now()
    where id = a.id;

  insert into public.sales (sale_number, appointment_id, client_id, employee_id, subtotal, discount, tip, total,
                            is_demo, completed_at, created_by)
  values (public.next_sale_number(), a.id, a.client_id, v_emp, v_sub, a.discount, a.tip, v_total,
          a.is_demo, now(), public.actor_id())
  returning * into v_sale;

  insert into public.sale_items (sale_id, service_id, category_id, employee_id, description, quantity,
                                 unit_price, total, commission_pct)
  select v_sale.id, s.service_id, sv.category_id, coalesce(s.employee_id, v_emp), s.name, s.quantity,
         s.final_price, s.final_price * s.quantity, s.commission_pct
  from public.appointment_services s left join public.services sv on sv.id = s.service_id
  where s.appointment_id = a.id;

  update public.payments set sale_id = v_sale.id where appointment_id = a.id and sale_id is null;
  perform public.refresh_sale_payment_status(v_sale.id);

  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
  values (public.actor_id(), 'complete_appointment', 'appointments', a.id,
          jsonb_build_object('sale_id', v_sale.id, 'sale_number', v_sale.sale_number, 'total', v_total));

  return jsonb_build_object('sale_id', v_sale.id, 'sale_number', v_sale.sale_number, 'already_completed', false);
end $$;
grant execute on function public.complete_appointment(uuid) to authenticated;

-- ───────────── Registrar pago ─────────────
create or replace function public.record_payment(
  p_appointment uuid, p_amount numeric, p_method public.payment_method,
  p_reference text default null, p_allow_overpay boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.appointments; v_sale public.sales; v_due numeric; v_paid numeric; v_pid uuid;
begin
  if not public.has_role('super_admin','manager','receptionist') then raise exception 'forbidden'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  select * into a from public.appointments where id = p_appointment for update;
  if not found then raise exception 'appointment_not_found'; end if;
  select * into v_sale from public.sales where appointment_id = a.id;

  if found then v_due := v_sale.total;
  else
    select coalesce(sum(final_price*quantity),0) - a.discount + a.tip into v_due
    from public.appointment_services where appointment_id = a.id;
  end if;
  select coalesce(sum(amount),0) into v_paid from public.payments
    where appointment_id = a.id and status = 'pagado';
  if v_paid + p_amount > v_due and not p_allow_overpay then raise exception 'overpayment'; end if;

  insert into public.payments (sale_id, appointment_id, amount, method, reference, created_by, is_demo)
  values (v_sale.id, a.id, p_amount, p_method, p_reference, public.actor_id(), a.is_demo)
  returning id into v_pid;
  if v_sale.id is not null then perform public.refresh_sale_payment_status(v_sale.id); end if;
  return jsonb_build_object('payment_id', v_pid, 'pending', greatest(v_due - v_paid - p_amount, 0));
end $$;
grant execute on function public.record_payment(uuid, numeric, public.payment_method, text, boolean) to authenticated;

create or replace function public.refund_payment(p_payment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pay public.payments;
begin
  if not public.has_role('super_admin','manager') then raise exception 'forbidden'; end if;
  update public.payments set status = 'reembolsado' where id = p_payment and status = 'pagado'
  returning * into pay;
  if not found then raise exception 'payment_not_refundable'; end if;
  if pay.sale_id is not null then perform public.refresh_sale_payment_status(pay.sale_id); end if;
end $$;
grant execute on function public.refund_payment(uuid) to authenticated;

-- ───────────── Realtime ─────────────
alter publication supabase_realtime add table public.appointments, public.notifications;
