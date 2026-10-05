-- Glow Beauty Center — fusión de clientes, autoservicio del cliente y fecha local en promociones

-- ───────────── Fecha de hoy en Santo Domingo (las promociones vencen a medianoche local, no en UTC) ─────────────
create or replace function public.dr_today() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'America/Santo_Domingo')::date
$$;
grant execute on function public.dr_today() to anon, authenticated, service_role;

drop policy if exists promo_read on public.promotions;
create policy promo_read on public.promotions for select to anon, authenticated using (
  (active and (starts_on is null or starts_on <= public.dr_today()) and (ends_on is null or ends_on >= public.dr_today()))
  or public.is_staff()
);

-- ───────────── Fusionar clientes duplicados (gerencia) ─────────────
create or replace function public.merge_clients(p_keep uuid, p_remove uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k public.clients; r public.clients; v_appts int; v_sales int;
begin
  if not public.has_role('super_admin', 'manager') then raise exception 'forbidden'; end if;
  if p_keep = p_remove then raise exception 'invalid_item'; end if;
  select * into k from public.clients where id = p_keep for update;
  select * into r from public.clients where id = p_remove for update;
  if k.id is null or r.id is null then raise exception 'client_not_found'; end if;
  update public.appointments set client_id = k.id where client_id = r.id;
  get diagnostics v_appts = row_count;
  update public.sales set client_id = k.id where client_id = r.id;
  get diagnostics v_sales = row_count;
  update public.clients set
    email = coalesce(k.email, r.email),
    internal_notes = nullif(trim(both E'\n' from concat_ws(E'\n', k.internal_notes, case when r.internal_notes is not null then '[Fusionado de ' || r.first_name || ' ' || r.last_name || '] ' || r.internal_notes end)), '')
  where id = k.id;
  delete from public.clients where id = r.id;
  insert into public.audit_logs (user_id, action, entity, entity_id, before_data, after_data)
  values (public.actor_id(), 'update', 'clients', k.id, to_jsonb(r), jsonb_build_object('merged_into', k.id, 'appointments_moved', v_appts, 'sales_moved', v_sales));
  return jsonb_build_object('appointments', v_appts, 'sales', v_sales);
end $$;
revoke execute on function public.merge_clients(uuid, uuid) from public, anon;
grant execute on function public.merge_clients(uuid, uuid) to authenticated;

-- ───────────── Autoservicio del cliente: consultar y cancelar con número de solicitud + teléfono (solo servidor) ─────────────
create or replace function public.lookup_booking_public(p_request text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.appointments; c public.clients; v_hours int; v_lines jsonb;
begin
  select * into c from public.clients where phone_normalized = public.normalize_phone(p_phone);
  if c.id is null then raise exception 'booking_not_found'; end if;
  select * into a from public.appointments where upper(request_number) = upper(trim(p_request)) and client_id = c.id;
  if a.id is null then raise exception 'booking_not_found'; end if;
  select coalesce((value->>'cancel_hours')::int, 4) into v_hours from public.business_settings where key = 'booking';
  select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'price', s.final_price, 'quantity', s.quantity) order by s.position), '[]'::jsonb)
    into v_lines from public.appointment_services s where s.appointment_id = a.id;
  return jsonb_build_object('id', a.id, 'request_number', a.request_number, 'status', a.status, 'start_time', a.start_time, 'end_time', a.end_time,
    'first_name', c.first_name, 'total', a.estimated_total, 'lines', v_lines,
    'cancellable', a.status in ('solicitud', 'contactando', 'contactado', 'confirmado') and a.start_time > now() + make_interval(hours => coalesce(v_hours, 4)),
    'cancel_hours', coalesce(v_hours, 4));
end $$;

create or replace function public.cancel_booking_public(p_request text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_id uuid;
begin
  v := public.lookup_booking_public(p_request, p_phone);
  if (v->>'status') not in ('solicitud', 'contactando', 'contactado', 'confirmado') then raise exception 'booking_not_cancellable'; end if;
  if not (v->>'cancellable')::boolean then raise exception 'booking_too_late'; end if;
  v_id := (v->>'id')::uuid;
  update public.appointments set status = 'cancelado', notes = concat_ws(E'\n', notes, 'Cancelada por el cliente desde la web.') where id = v_id;
  return jsonb_build_object('id', v_id);
end $$;

revoke execute on function public.lookup_booking_public(text, text), public.cancel_booking_public(text, text) from public, anon, authenticated;
grant execute on function public.lookup_booking_public(text, text), public.cancel_booking_public(text, text) to service_role;
