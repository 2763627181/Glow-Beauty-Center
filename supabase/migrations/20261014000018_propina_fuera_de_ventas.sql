-- Glow Beauty Center — la PROPINA no entra en la venta ni en la factura.
-- Antes el total de una venta era subtotal − descuento + propina: la propina inflaba las ventas, los reportes y lo que había que cobrar.
-- Ahora total = subtotal − descuento. La propina se sigue anotando aparte (sales.tip / appointments.tip) para repartirla en la Nómina, pero
-- no suma al total de la venta, no se cobra como parte de ella y no cuenta en los reportes de ventas.
--
--  • complete_appointment, create_quick_sale, record_payment y update_appointment calculan el total sin la propina.
--  • _exclude_tips_from_totals corrige las ventas que ya existían con la propina dentro del total (se puede volver a ejecutar sin riesgo:
--    solo toca ventas cuyo total todavía incluye la propina). Los pagos ya cobrados no se tocan.
-- Compatible hacia atrás y re-ejecutable.

create or replace function public.update_appointment(p_appointment uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.appointments; v_line jsonb; v_calc jsonb; v_new jsonb; v_id uuid; v_pos int := 0;
  v_start timestamptz; v_t timestamptz; v_t2 timestamptz; v_keep uuid[] := '{}'; v_row public.appointment_services;
  v_emp uuid; v_final numeric; v_qty int; v_sub numeric; v_discount numeric; v_tip numeric; v_first uuid; v_has_timed boolean := false;
  v_span int; v_bstart timestamptz; v_bend timestamptz; v_firstln boolean := true; v_par boolean;
  v_teams jsonb := '{}'::jsonb; v_tid uuid; v_tkey text;
begin
  if not public.has_role('super_admin', 'manager', 'receptionist') then raise exception 'forbidden'; end if;
  select * into a from public.appointments where id = p_appointment for update;
  if not found then raise exception 'appointment_not_found'; end if;
  if a.status in ('completado', 'cancelado', 'no_asistio') or exists (select 1 from public.sales where appointment_id = a.id) then
    raise exception 'appointment_closed';
  end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'no_services'; end if;

  v_start := coalesce(nullif(p->>'start_time', '')::timestamptz, a.start_time);
  update public.appointment_services set active = false where appointment_id = a.id;
  v_t := v_start;

  begin
    for v_line in select * from jsonb_array_elements(p->'lines') loop
      v_emp := nullif(v_line->>'employee_id', '')::uuid;
      v_final := nullif(v_line->>'final_price', '')::numeric;
      v_qty := coalesce(nullif(v_line->>'quantity', '')::int, 1);
      if v_qty < 1 or (v_final is not null and v_final < 0) then raise exception 'invalid_item'; end if;

      if nullif(v_line->>'id', '') is not null then
        v_id := (v_line->>'id')::uuid;
        select * into v_row from public.appointment_services where id = v_id and appointment_id = a.id;
        if not found then raise exception 'invalid_item'; end if;
        if v_line ? 'employee_id' then
          perform public._check_employee(v_emp, v_row.service_id, false);
        else
          v_emp := v_row.employee_id;
        end if;
        v_tid := v_row.team_id;
        if v_line ? 'team' then
          v_tkey := nullif(v_line->>'team', ''); v_tid := null;
          if v_tkey is null then v_tid := null;
          elsif v_tkey ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                and exists (select 1 from public.appointment_services where appointment_id = a.id and team_id = v_tkey::uuid) then v_tid := v_tkey::uuid;
          elsif v_teams ? v_tkey then v_tid := (v_teams->>v_tkey)::uuid;
          else v_tid := gen_random_uuid(); v_teams := v_teams || jsonb_build_object(v_tkey, v_tid); end if;
        end if;
        if v_row.start_time is not null then
          v_span := coalesce(v_row.span_minutes, v_row.duration_minutes);
          v_par := coalesce((v_line->>'parallel')::boolean, v_row.parallel);
          if v_firstln then v_t := v_start; v_bstart := v_t; v_bend := v_t + make_interval(mins => v_span); v_firstln := false; v_par := false;
          elsif v_par then v_t := v_bstart; v_bend := greatest(v_bend, v_t + make_interval(mins => v_span));
          else v_t := v_bend; v_bstart := v_t; v_bend := v_t + make_interval(mins => v_span); end if;
          v_t2 := v_t + make_interval(mins => v_span);
          update public.appointment_services set employee_id = v_emp, final_price = coalesce(v_final, final_price), quantity = v_qty,
                 position = v_pos, start_time = v_t, end_time = v_t2, parallel = v_par, team_id = v_tid where id = v_id;
          v_has_timed := true;
        else
          update public.appointment_services set employee_id = v_emp, final_price = coalesce(v_final, final_price), quantity = v_qty, position = v_pos, team_id = v_tid where id = v_id;
        end if;
        v_keep := v_keep || v_id;

      elsif nullif(v_line->>'service_id', '') is not null then
        v_calc := public._compute_items(jsonb_build_array(v_line));
        v_new := v_calc->'lines'->0;
        perform public._check_employee(v_emp, (v_new->>'service_id')::uuid, false);
        v_span := (v_new->>'span_minutes')::int;
        v_par := coalesce((v_line->>'parallel')::boolean, false);
        if v_firstln then v_t := v_start; v_bstart := v_t; v_bend := v_t + make_interval(mins => v_span); v_firstln := false; v_par := false;
        elsif v_par then v_t := v_bstart; v_bend := greatest(v_bend, v_t + make_interval(mins => v_span));
        else v_t := v_bend; v_bstart := v_t; v_bend := v_t + make_interval(mins => v_span); end if;
        v_t2 := v_t + make_interval(mins => v_span);
        v_tkey := nullif(v_line->>'team', ''); v_tid := null;
        if v_tkey is null then v_tid := null;
        elsif v_tkey ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              and exists (select 1 from public.appointment_services where appointment_id = a.id and team_id = v_tkey::uuid) then v_tid := v_tkey::uuid;
        elsif v_teams ? v_tkey then v_tid := (v_teams->>v_tkey)::uuid;
        else v_tid := gen_random_uuid(); v_teams := v_teams || jsonb_build_object(v_tkey, v_tid); end if;
        insert into public.appointment_services (appointment_id, service_id, variant_id, name, price, final_price, duration_minutes,
          span_minutes, quantity, addons, employee_id, commission_pct, position, start_time, end_time, active, parallel, team_id)
        values (a.id, (v_new->>'service_id')::uuid, nullif(v_new->>'variant_id', '')::uuid, v_new->>'name', (v_new->>'price')::numeric,
          coalesce(v_final, (v_new->>'price')::numeric), (v_new->>'duration_minutes')::int, v_span, v_qty, v_new->'addons', v_emp,
          nullif(v_new->>'commission_pct', '')::numeric, v_pos, v_t, v_t2, false, v_par, v_tid)
        returning id into v_id;
        v_keep := v_keep || v_id; v_has_timed := true;

      else
        if coalesce(trim(v_line->>'name'), '') = '' or v_final is null then raise exception 'invalid_item'; end if;
        insert into public.appointment_services (appointment_id, name, price, final_price, duration_minutes, quantity, employee_id, position, active)
        values (a.id, trim(v_line->>'name'), v_final, v_final, 0, v_qty, v_emp, v_pos, false)
        returning id into v_id;
        v_keep := v_keep || v_id;
      end if;
      v_pos := v_pos + 1;
    end loop;

    delete from public.appointment_services where appointment_id = a.id and id <> all (v_keep);
    update public.appointment_services set active = true where appointment_id = a.id;
  exception when exclusion_violation then
    raise exception 'slot_taken';
  end;

  select coalesce(sum(final_price * quantity), 0) into v_sub from public.appointment_services where appointment_id = a.id;
  v_discount := coalesce(nullif(p->>'discount', '')::numeric, a.discount);
  v_tip := coalesce(nullif(p->>'tip', '')::numeric, a.tip);
  if v_discount < 0 or v_tip < 0 then raise exception 'invalid_amount'; end if;
  if v_discount > v_sub then raise exception 'discount_exceeds_subtotal'; end if;
  select employee_id into v_first from public.appointment_services
   where appointment_id = a.id and start_time is not null order by position, id limit 1;

  update public.appointments set
    start_time = v_start,
    end_time = case when v_has_timed then v_bend else v_start + interval '15 minutes' end,
    appointment_date = (v_start at time zone 'America/Santo_Domingo')::date,
    employee_id = v_first,
    notes = case when p ? 'notes' then nullif(trim(p->>'notes'), '') else notes end,
    source = coalesce(nullif(p->>'source', '')::public.appointment_source, source),
    discount = v_discount, tip = v_tip, estimated_total = v_sub - v_discount
  where id = a.id;
  return jsonb_build_object('id', a.id, 'total', v_sub - v_discount);
end $$;

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

  if public.has_role('specialist') and not exists (
       select 1 from public.appointment_services s where s.appointment_id = a.id and s.employee_id = public.my_employee_id()) then
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
  v_total := v_sub - a.discount; -- la propina NO entra en la venta
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
                                 unit_price, total, commission_pct, team_id)
  select v_sale.id, s.service_id, sv.category_id, coalesce(s.employee_id, v_emp), s.name, s.quantity,
         s.final_price, s.final_price * s.quantity, s.commission_pct, s.team_id
  from public.appointment_services s left join public.services sv on sv.id = s.service_id
  where s.appointment_id = a.id;

  update public.payments set sale_id = v_sale.id where appointment_id = a.id and sale_id is null;
  perform public.refresh_sale_payment_status(v_sale.id);

  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
  values (public.actor_id(), 'complete_appointment', 'appointments', a.id,
          jsonb_build_object('sale_id', v_sale.id, 'sale_number', v_sale.sale_number, 'total', v_total));

  return jsonb_build_object('sale_id', v_sale.id, 'sale_number', v_sale.sale_number, 'already_completed', false);
end $$;

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
    select coalesce(sum(final_price * quantity), 0) - a.discount into v_due from public.appointment_services where appointment_id = a.id;
  end if;
  select coalesce(sum(amount), 0) into v_paid from public.payments where appointment_id = a.id and status = 'pagado';
  if v_paid + p_amount > v_due and not p_allow_overpay then raise exception 'overpayment'; end if;
  insert into public.payments (sale_id, appointment_id, amount, method, reference, tendered, created_by, is_demo)
  values (v_sale.id, a.id, p_amount, p_method, nullif(trim(p_reference), ''), round(p_tendered, 2), public.actor_id(), a.is_demo) returning id into v_pid;
  if v_sale.id is not null then perform public.refresh_sale_payment_status(v_sale.id); end if;
  return jsonb_build_object('payment_id', v_pid, 'pending', greatest(v_due - v_paid - p_amount, 0));
end $$;

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
  v_total := v_sub - v_disc; -- la propina NO entra en la venta
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

create or replace function public._exclude_tips_from_totals() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record;
begin
  for r in select id from public.sales where tip > 0 and total = subtotal - discount + tip loop
    update public.sales set total = subtotal - discount where id = r.id;
    v_n := v_n + 1;
    perform public.refresh_sale_payment_status(r.id); -- el estado de pago se recalcula con el total nuevo (las anuladas no cambian)
  end loop;
  update public.appointments a set final_total = s.total
    from public.sales s
   where s.appointment_id = a.id and a.tip > 0 and a.final_total is not null and a.final_total is distinct from s.total;
  return v_n;
end $$;
revoke execute on function public._exclude_tips_from_totals() from public, anon, authenticated;
select public._exclude_tips_from_totals();
