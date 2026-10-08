-- Glow Beauty Center — eliminar clientes, citas/solicitudes, ventas y notificaciones desde el panel.
-- Solo super administrador y gerencia (notificaciones: también recepción). Cada borrado queda en Auditoría con los datos
-- que tenía (los triggers de auditoría guardan la fila completa). Compatible hacia atrás.
--
--  • delete_appointments: borra citas (o solicitudes) con su venta y sus pagos, aunque ya estén completadas.
--  • delete_sales: borra ventas con sus artículos y pagos; la cita de la venta se elimina también o se reabre como «confirmada».
--  • delete_clients: borra clientes; con historial solo si se pide expresamente (se llevan sus citas, ventas y pagos).
--  • clear_notifications: borra avisos (solo los leídos o todos).
--  • describe_deletion: cuenta lo que se borraría, para mostrarlo antes de confirmar. No modifica nada.

-- Borra citas junto con su venta y sus pagos. Devuelve cuántas filas se fueron y los eventos de Google Calendar a quitar.
create or replace function public._purge_appointments(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sales uuid[]; v_events jsonb; v_a int := 0; v_s int := 0; v_p int := 0;
begin
  select coalesce(jsonb_agg(google_calendar_event_id), '[]'::jsonb) into v_events
    from public.appointments where id = any(p_ids) and google_calendar_event_id is not null;
  select coalesce(array_agg(id), '{}') into v_sales from public.sales where appointment_id = any(p_ids);
  delete from public.payments where appointment_id = any(p_ids) or sale_id = any(v_sales);
  get diagnostics v_p = row_count;
  delete from public.sales where id = any(v_sales);
  get diagnostics v_s = row_count;
  delete from public.appointments where id = any(p_ids);
  get diagnostics v_a = row_count;
  return jsonb_build_object('appointments', v_a, 'sales', v_s, 'payments', v_p, 'calendar_events', v_events);
end $$;
revoke execute on function public._purge_appointments(uuid[]) from public, anon, authenticated;

create or replace function public.delete_appointments(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('super_admin', 'manager') then raise exception 'forbidden'; end if;
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'nothing_selected'; end if;
  if cardinality(p_ids) > 300 then raise exception 'too_many_selected'; end if;
  return public._purge_appointments(p_ids);
end $$;

create or replace function public.delete_sales(p_ids uuid[], p_with_appointment boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; v_pay int := 0; v_n int := 0; v_p int; v_appts uuid[] := '{}'; v_events jsonb := '[]'::jsonb; v_reopened int := 0; v_ad jsonb;
begin
  if not public.has_role('super_admin', 'manager') then raise exception 'forbidden'; end if;
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'nothing_selected'; end if;
  if cardinality(p_ids) > 300 then raise exception 'too_many_selected'; end if;
  for s in select id, appointment_id from public.sales where id = any(p_ids) loop
    delete from public.payments where sale_id = s.id;
    get diagnostics v_p = row_count; v_pay := v_pay + v_p;
    delete from public.sales where id = s.id;
    v_n := v_n + 1;
    if s.appointment_id is not null then
      if p_with_appointment then v_appts := v_appts || s.appointment_id;
      else
        -- la cita vuelve a «confirmada» para poder cobrarla de nuevo
        update public.appointments set status = 'confirmado', final_total = null, completed_at = null
         where id = s.appointment_id and status = 'completado';
        if found then v_reopened := v_reopened + 1; end if;
      end if;
    end if;
  end loop;
  if cardinality(v_appts) > 0 then
    v_ad := public._purge_appointments(v_appts);
    v_events := v_ad->'calendar_events';
    v_pay := v_pay + (v_ad->>'payments')::int;
  end if;
  return jsonb_build_object('sales', v_n, 'payments', v_pay, 'appointments', coalesce((v_ad->>'appointments')::int, 0), 'reopened', v_reopened, 'calendar_events', v_events);
end $$;

create or replace function public.delete_clients(p_ids uuid[], p_with_history boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid; v_appts uuid[]; v_sales uuid[]; v_deleted int := 0; v_skipped int := 0; v_a int := 0; v_s int := 0; v_p int := 0; v_n int;
        v_events jsonb := '[]'::jsonb; v_ad jsonb;
begin
  if not public.has_role('super_admin', 'manager') then raise exception 'forbidden'; end if;
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'nothing_selected'; end if;
  if cardinality(p_ids) > 300 then raise exception 'too_many_selected'; end if;
  foreach c in array p_ids loop
    select coalesce(array_agg(id), '{}') into v_appts from public.appointments where client_id = c;
    select coalesce(array_agg(id), '{}') into v_sales from public.sales where client_id = c;
    if (cardinality(v_appts) > 0 or cardinality(v_sales) > 0) then
      if not p_with_history then v_skipped := v_skipped + 1; continue; end if;
      delete from public.payments where sale_id = any(v_sales);
      get diagnostics v_n = row_count; v_p := v_p + v_n;
      delete from public.sales where id = any(v_sales);
      get diagnostics v_n = row_count; v_s := v_s + v_n;
      if cardinality(v_appts) > 0 then
        v_ad := public._purge_appointments(v_appts);
        v_a := v_a + (v_ad->>'appointments')::int; v_s := v_s + (v_ad->>'sales')::int; v_p := v_p + (v_ad->>'payments')::int;
        v_events := v_events || (v_ad->'calendar_events');
      end if;
    end if;
    delete from public.clients where id = c;
    get diagnostics v_n = row_count; v_deleted := v_deleted + v_n;
  end loop;
  return jsonb_build_object('clients', v_deleted, 'skipped', v_skipped, 'appointments', v_a, 'sales', v_s, 'payments', v_p, 'calendar_events', v_events);
end $$;

create or replace function public.clear_notifications(p_only_read boolean default true) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.has_role('super_admin', 'manager', 'receptionist') then raise exception 'forbidden'; end if;
  delete from public.notifications where (not p_only_read) or read_at is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Cuenta lo que se borraría (no modifica nada). kind: 'appointments' | 'clients' | 'sales'
create or replace function public.describe_deletion(p_kind text, p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_appts uuid[]; v_sales uuid[]; v_total numeric; v_paid numeric; v_linked int := 0; v_hist int := 0; v_clean int := 0;
begin
  if not public.has_role('super_admin', 'manager') then raise exception 'forbidden'; end if;
  if p_ids is null or cardinality(p_ids) = 0 then return jsonb_build_object('appointments', 0, 'sales', 0, 'payments', 0, 'sales_total', 0, 'paid_total', 0); end if;
  if p_kind = 'appointments' then
    v_appts := p_ids;
    select coalesce(array_agg(id), '{}') into v_sales from public.sales where appointment_id = any(v_appts);
  elsif p_kind = 'sales' then
    v_sales := p_ids;
    select coalesce(array_agg(appointment_id), '{}') into v_appts from public.sales where id = any(p_ids) and appointment_id is not null;
    v_linked := cardinality(v_appts);
  elsif p_kind = 'clients' then
    select coalesce(array_agg(id), '{}') into v_appts from public.appointments where client_id = any(p_ids);
    select coalesce(array_agg(id), '{}') into v_sales from public.sales where client_id = any(p_ids) or appointment_id = any(v_appts);
    select count(*) into v_hist from public.clients c where c.id = any(p_ids)
       and (exists (select 1 from public.appointments a where a.client_id = c.id) or exists (select 1 from public.sales s where s.client_id = c.id));
    v_clean := cardinality(p_ids) - v_hist;
  else raise exception 'invalid_kind'; end if;
  select coalesce(sum(total), 0) into v_total from public.sales where id = any(v_sales);
  select coalesce(sum(amount) filter (where status = 'pagado'), 0) into v_paid from public.payments where sale_id = any(v_sales) or appointment_id = any(v_appts);
  return jsonb_build_object(
    'appointments', case when p_kind = 'sales' then 0 else cardinality(v_appts) end,
    'sales', cardinality(v_sales), 'sales_total', v_total,
    'payments', (select count(*) from public.payments where sale_id = any(v_sales) or (p_kind <> 'sales' and appointment_id = any(v_appts))),
    'paid_total', v_paid, 'linked_appointments', v_linked, 'clients_with_history', v_hist, 'clients_clean', v_clean);
end $$;

-- Solo personal autenticado (cada función valida el rol por dentro)
do $$ declare f text; begin
  foreach f in array array['public.delete_appointments(uuid[])', 'public.delete_sales(uuid[], boolean)', 'public.delete_clients(uuid[], boolean)',
                           'public.clear_notifications(boolean)', 'public.describe_deletion(text, uuid[])'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
