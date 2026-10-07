-- Glow Beauty Center — sin límites para quien agenda desde el panel, y la web sin tope por defecto.
-- Compatible hacia atrás.
--
-- 1. Reserva en línea: «Citas al mismo tiempo por especialista» pasa a 0–10, donde 0 = SIN LÍMITE, y ese es el valor por defecto
--    (antes: 1–10, por defecto 2). Quien ya lo había guardado con un número conserva su número.
-- 2. Panel (recepción, gerencia): se puede asignar a CUALQUIER especialista activa a cualquier servicio (antes solo a las que lo
--    tenían marcado) y se pueden registrar o mover citas a horas que ya pasaron (por ejemplo, una cita atendida hace un rato).
--    Las solicitudes que llegan desde la web siguen exigiendo una especialista que haga el servicio y una fecha futura.

-- Validación de la especialista; `p_strict` = además exigir que tenga marcado el servicio (solo para la web).
create or replace function public._check_employee(p_emp uuid, p_service uuid, p_strict boolean) returns void
language plpgsql stable set search_path = public as $$
begin
  if p_emp is null then return; end if;
  if not exists (select 1 from public.employees where id = p_emp and active) then raise exception 'employee_unavailable'; end if;
  if p_strict
     and exists (select 1 from public.employee_services where service_id = p_service)
     and not exists (select 1 from public.employee_services where service_id = p_service and employee_id = p_emp) then
    raise exception 'employee_cannot_perform';
  end if;
end $$;
revoke execute on function public._check_employee(uuid, uuid, boolean) from public, anon, authenticated;

-- Tope de la reserva en línea (0 = sin límite)
create or replace function public.enforce_web_capacity() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_source public.appointment_source; v_max int; v_depth int; v_raw text;
begin
  if not new.active or new.employee_id is null or new.start_time is null or new.end_time is null or new.end_time <= new.start_time then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.active and new.employee_id is not distinct from old.employee_id
     and new.start_time is not distinct from old.start_time and new.end_time is not distinct from old.end_time then
    return new;
  end if;
  if auth.uid() is not null then return new; end if; -- cambios hechos por el personal desde el panel: sin tope
  select source into v_source from public.appointments where id = new.appointment_id;
  if v_source is distinct from 'website' then return new; end if;

  select value->>'max_simultaneous' into v_raw from public.business_settings where key = 'booking';
  v_max := case when v_raw ~ '^\d{1,2}$' then v_raw::int else 0 end;
  if v_max = 0 then return new; end if; -- 0 = sin límite (valor por defecto)
  perform pg_advisory_xact_lock(hashtextextended(new.employee_id::text, 0));

  -- Máximo de citas que ya coinciden en un mismo instante dentro del tramo pedido
  select coalesce(max(c.n), 0) into v_depth from (
    select (select count(*) from public.appointment_services x
             where x.active and x.employee_id = new.employee_id and x.id <> new.id
               and x.start_time is not null and x.end_time > x.start_time
               and x.start_time <= p.t and x.end_time > p.t) as n
    from (select greatest(l.start_time, new.start_time) as t from public.appointment_services l
           where l.active and l.employee_id = new.employee_id and l.id <> new.id
             and l.start_time is not null and l.end_time > l.start_time
             and l.start_time < new.end_time and l.end_time > new.start_time) p
  ) c;
  if v_depth >= v_max then raise exception 'slot_taken'; end if;
  return new;
end $$;

-- Crear reserva (servidor): la web exige especialista que haga el servicio y fecha futura; recepción y gerencia no
create or replace function public.create_booking(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := public.normalize_phone(p->>'phone');
  v_default_emp uuid := nullif(p->>'employee_id', '')::uuid;
  v_status public.appointment_status := coalesce(nullif(p->>'status', ''), 'solicitud')::public.appointment_status;
  v_source public.appointment_source := coalesce(nullif(p->>'source', ''), 'website')::public.appointment_source;
  v_start timestamptz; v_items jsonb; v_calc jsonb; v_lines jsonb; v_line jsonb;
  v_client uuid; v_appt uuid; v_t timestamptz; v_t2 timestamptz; v_end timestamptz; v_total numeric;
  v_first_emp uuid; v_pos int := 0; v_req text; v_discount numeric := 0; v_promo public.promotions; v_n int;
  v_today date := (now() at time zone 'America/Santo_Domingo')::date;
begin
  if length(v_phone) <> 10 then raise exception 'invalid_phone'; end if;
  if coalesce(trim(p->>'first_name'), '') = '' then raise exception 'invalid_name'; end if;
  v_start := (p->>'start_time')::timestamptz;
  if v_source = 'website' and v_start < now() - interval '5 minutes' then raise exception 'past_date'; end if;

  -- anti-spam: máximo 4 solicitudes abiertas y futuras por teléfono desde la web
  if v_source = 'website' then
    select count(*) into v_n from public.appointments a join public.clients c on c.id = a.client_id
     where c.phone_normalized = v_phone and a.status in ('solicitud', 'contactando', 'contactado') and a.start_time > now();
    if v_n >= 4 then raise exception 'too_many_requests'; end if;
  end if;

  -- empleado por defecto para las líneas que no traen uno
  select jsonb_agg(case when nullif(i->>'employee_id', '') is null and v_default_emp is not null
                        then i || jsonb_build_object('employee_id', v_default_emp) else i end order by ord)
    into v_items from jsonb_array_elements(coalesce(p->'services', '[]'::jsonb)) with ordinality as t(i, ord);
  v_calc := public._compute_items(v_items);
  v_lines := v_calc->'lines';
  v_total := (v_calc->>'total')::numeric;
  for v_line in select * from jsonb_array_elements(v_lines) loop
    perform public._check_employee(nullif(v_line->>'employee_id', '')::uuid, (v_line->>'service_id')::uuid, v_source = 'website');
  end loop;
  v_first_emp := nullif(v_lines->0->>'employee_id', '')::uuid;
  v_end := v_start + make_interval(mins => (v_calc->>'minutes')::int);

  -- promoción (opcional): descuento = lista - precio promocional, solo si está vigente e incluye sus servicios
  if nullif(p->>'promotion_id', '') is not null then
    select * into v_promo from public.promotions
     where id = (p->>'promotion_id')::uuid and active
       and (starts_on is null or starts_on <= v_today) and (ends_on is null or ends_on >= v_today);
    if not found or exists (
      select 1 from public.promotion_services ps
       where ps.promotion_id = v_promo.id
         and ps.service_id not in (select (l->>'service_id')::uuid from jsonb_array_elements(v_lines) l)
    ) then raise exception 'promotion_invalid'; end if;
    v_discount := greatest(v_total - v_promo.promo_price, 0);
  end if;

  insert into public.clients (first_name, last_name, phone, email)
  values (trim(p->>'first_name'), trim(coalesce(p->>'last_name', '')), v_phone, nullif(trim(p->>'email'), ''))
  on conflict (phone_normalized) do update set email = coalesce(public.clients.email, excluded.email)
  returning id into v_client;

  insert into public.appointments (client_id, employee_id, status, appointment_date, start_time, end_time,
    notes, source, created_by, discount, promotion_id, estimated_total)
  values (v_client, v_first_emp, v_status, (v_start at time zone 'America/Santo_Domingo')::date, v_start, v_end,
    nullif(trim(p->>'notes'), ''), v_source, nullif(p->>'created_by', '')::uuid, v_discount, v_promo.id, v_total - v_discount)
  returning id, request_number into v_appt, v_req;

  begin
    v_t := v_start;
    for v_line in select * from jsonb_array_elements(v_lines) loop
      v_t2 := v_t + make_interval(mins => (v_line->>'span_minutes')::int);
      insert into public.appointment_services (appointment_id, service_id, variant_id, name, price, final_price,
        duration_minutes, span_minutes, addons, employee_id, commission_pct, position, start_time, end_time)
      values (v_appt, (v_line->>'service_id')::uuid, nullif(v_line->>'variant_id', '')::uuid, v_line->>'name',
        (v_line->>'price')::numeric, (v_line->>'price')::numeric, (v_line->>'duration_minutes')::int,
        (v_line->>'span_minutes')::int, v_line->'addons', nullif(v_line->>'employee_id', '')::uuid,
        nullif(v_line->>'commission_pct', '')::numeric, v_pos, v_t, v_t2);
      v_t := v_t2; v_pos := v_pos + 1;
    end loop;
  exception when exclusion_violation then
    raise exception 'slot_taken';
  end;

  return jsonb_build_object('id', v_appt, 'request_number', v_req, 'client_id', v_client,
                            'estimated_total', v_total - v_discount, 'end_time', v_end);
end $$;

-- Reprogramar (personal): también a horas que ya pasaron
create or replace function public.reschedule_appointment(p_appointment uuid, p_start timestamptz, p_employee uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.appointments; v_t timestamptz; v_line public.appointment_services; v_first uuid;
begin
  if not public.has_role('super_admin', 'manager', 'receptionist') then raise exception 'forbidden'; end if;
  select * into a from public.appointments where id = p_appointment for update;
  if not found then raise exception 'appointment_not_found'; end if;
  if a.status in ('completado', 'cancelado', 'no_asistio') then raise exception 'appointment_closed'; end if;

  update public.appointment_services set active = false where appointment_id = a.id;
  v_t := p_start;
  begin
    for v_line in select * from public.appointment_services where appointment_id = a.id and start_time is not null order by position, id loop
      if p_employee is not null then perform public._check_employee(p_employee, v_line.service_id, false); end if;
      update public.appointment_services
         set start_time = v_t, end_time = v_t + make_interval(mins => coalesce(span_minutes, duration_minutes)),
             employee_id = coalesce(p_employee, employee_id)
       where id = v_line.id;
      v_t := v_t + make_interval(mins => coalesce(v_line.span_minutes, v_line.duration_minutes));
    end loop;
    update public.appointment_services set active = true where appointment_id = a.id;
  exception when exclusion_violation then
    raise exception 'slot_taken';
  end;
  select employee_id into v_first from public.appointment_services
   where appointment_id = a.id and start_time is not null order by position, id limit 1;
  update public.appointments
     set start_time = p_start, end_time = greatest(v_t, p_start + interval '15 minutes'),
         appointment_date = (p_start at time zone 'America/Santo_Domingo')::date,
         employee_id = coalesce(v_first, case when p_employee is not null then p_employee else employee_id end)
   where id = a.id;
  return jsonb_build_object('id', a.id);
end $$;

-- Editar cita (personal): cualquier especialista activa en cualquier línea
create or replace function public.update_appointment(p_appointment uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.appointments; v_line jsonb; v_calc jsonb; v_new jsonb; v_id uuid; v_pos int := 0;
  v_start timestamptz; v_t timestamptz; v_t2 timestamptz; v_keep uuid[] := '{}'; v_row public.appointment_services;
  v_emp uuid; v_final numeric; v_qty int; v_sub numeric; v_discount numeric; v_tip numeric; v_first uuid; v_has_timed boolean := false;
  v_span int;
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
        if v_row.start_time is not null then
          v_span := coalesce(v_row.span_minutes, v_row.duration_minutes); v_t2 := v_t + make_interval(mins => v_span);
          update public.appointment_services set employee_id = v_emp, final_price = coalesce(v_final, final_price), quantity = v_qty,
                 position = v_pos, start_time = v_t, end_time = v_t2 where id = v_id;
          v_t := v_t2; v_has_timed := true;
        else
          update public.appointment_services set employee_id = v_emp, final_price = coalesce(v_final, final_price), quantity = v_qty, position = v_pos where id = v_id;
        end if;
        v_keep := v_keep || v_id;

      elsif nullif(v_line->>'service_id', '') is not null then
        v_calc := public._compute_items(jsonb_build_array(v_line));
        v_new := v_calc->'lines'->0;
        perform public._check_employee(v_emp, (v_new->>'service_id')::uuid, false);
        v_span := (v_new->>'span_minutes')::int; v_t2 := v_t + make_interval(mins => v_span);
        insert into public.appointment_services (appointment_id, service_id, variant_id, name, price, final_price, duration_minutes,
          span_minutes, quantity, addons, employee_id, commission_pct, position, start_time, end_time, active)
        values (a.id, (v_new->>'service_id')::uuid, nullif(v_new->>'variant_id', '')::uuid, v_new->>'name', (v_new->>'price')::numeric,
          coalesce(v_final, (v_new->>'price')::numeric), (v_new->>'duration_minutes')::int, v_span, v_qty, v_new->'addons', v_emp,
          nullif(v_new->>'commission_pct', '')::numeric, v_pos, v_t, v_t2, false)
        returning id into v_id;
        v_keep := v_keep || v_id; v_t := v_t2; v_has_timed := true;

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
    end_time = case when v_has_timed then v_t else v_start + interval '15 minutes' end,
    appointment_date = (v_start at time zone 'America/Santo_Domingo')::date,
    employee_id = v_first,
    notes = case when p ? 'notes' then nullif(trim(p->>'notes'), '') else notes end,
    source = coalesce(nullif(p->>'source', '')::public.appointment_source, source),
    discount = v_discount, tip = v_tip, estimated_total = v_sub - v_discount
  where id = a.id;
  return jsonb_build_object('id', a.id, 'total', v_sub - v_discount + v_tip);
end $$;
