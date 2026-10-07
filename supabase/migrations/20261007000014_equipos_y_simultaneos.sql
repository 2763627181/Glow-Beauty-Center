-- Glow Beauty Center — varias especialistas por servicio (equipos) y servicios al mismo tiempo.
-- Compatible hacia atrás: una cita sin equipos ni «al mismo tiempo» funciona exactamente igual que antes.
--
-- • Un servicio puede tener un EQUIPO de especialistas que lo atienden a la vez. Cada una queda con su propia línea de la
--   cita (misma hora), así la agenda, las ventas, las comisiones y la nómina siguen exactos; el precio del servicio se
--   reparte en partes iguales entre ellas (la primera recibe el centavo que sobre) y se puede ajustar.
-- • Una línea marcada «parallel» empieza junto con la anterior (por ejemplo, manicure con una especialista y pedicure con
--   otra a la vez). La cita dura lo que dure su bloque más largo.

alter table public.appointment_services add column if not exists parallel boolean not null default false;
alter table public.appointment_services add column if not exists team_id uuid;
alter table public.sale_items add column if not exists team_id uuid;
create index if not exists appt_lines_team_idx on public.appointment_services (team_id) where team_id is not null;

create or replace function public._compute_items(p_items jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_item jsonb; v_svc public.services; v_var public.service_variants; v_addon public.service_addons;
  v_lines jsonb := '[]'::jsonb; v_price numeric; v_dur int; v_addons jsonb; v_aid text;
  v_total numeric := 0; v_span int;
  v_k text; v_n int; v_j int; v_tsize jsonb; v_tseen jsonb := '{}'::jsonb; v_share numeric;
  v_par boolean; v_first boolean := true; v_bstart int := 0; v_bend int := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'no_services';
  end if;
  -- Cuántas especialistas tiene cada equipo (varias líneas con la misma clave "team")
  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into v_tsize
    from (select i->>'team' as k, count(*) as n from jsonb_array_elements(p_items) i where nullif(i->>'team', '') is not null group by 1) t;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_svc from public.services where id = (v_item->>'service_id')::uuid;
    if not found or not v_svc.active or v_svc.pending_review then raise exception 'service_unavailable'; end if;
    v_price := v_svc.price; v_dur := v_svc.duration_minutes; v_var := null;
    if nullif(v_item->>'variant_id', '') is not null then
      select * into v_var from public.service_variants
       where id = (v_item->>'variant_id')::uuid and service_id = v_svc.id and active;
      if not found then raise exception 'variant_unavailable'; end if;
      v_price := v_var.price; v_dur := v_var.duration_minutes;
    elsif exists (select 1 from public.service_variants where service_id = v_svc.id and active) then
      raise exception 'variant_required';
    end if;
    v_addons := '[]'::jsonb;
    for v_aid in select jsonb_array_elements_text(coalesce(v_item->'addon_ids', '[]'::jsonb)) loop
      select * into v_addon from public.service_addons where id = v_aid::uuid and service_id = v_svc.id and active;
      if not found then raise exception 'addon_unavailable'; end if;
      v_price := v_price + v_addon.price; v_dur := v_dur + v_addon.duration_minutes;
      v_addons := v_addons || jsonb_build_object('id', v_addon.id, 'name', v_addon.name, 'price', v_addon.price, 'duration_minutes', v_addon.duration_minutes);
    end loop;
    v_span := v_dur + v_svc.buffer_before_minutes + v_svc.buffer_after_minutes;

    -- Equipo: varias especialistas atienden el mismo servicio a la vez. El precio se reparte entre ellas
    -- (la primera recibe el centavo que sobre) y cada una queda con su propia línea para agenda, ventas y comisiones.
    v_k := nullif(v_item->>'team', ''); v_n := coalesce((v_tsize->>v_k)::int, 1); v_j := 0;
    if v_k is not null and v_n > 1 then
      v_j := coalesce((v_tseen->>v_k)::int, 0);
      v_tseen := v_tseen || jsonb_build_object(v_k, v_j + 1);
      v_share := trunc(v_price / v_n, 2);
      v_price := case when v_j = 0 then v_price - v_share * (v_n - 1) else v_share end;
    else
      v_k := null;
    end if;

    -- Bloques: una línea "al mismo tiempo" empieza junto con la anterior; el bloque dura lo que dure su servicio más largo
    v_par := (coalesce((v_item->>'parallel')::boolean, false) or v_j > 0) and not v_first;
    if v_first then v_bstart := 0; v_bend := v_span;
    elsif v_par then v_bend := greatest(v_bend, v_bstart + v_span);
    else v_bstart := v_bend; v_bend := v_bstart + v_span; end if;
    v_first := false;

    v_lines := v_lines || jsonb_build_object(
      'service_id', v_svc.id, 'variant_id', v_var.id,
      'name', v_svc.name || case when v_var.id is not null then ' – ' || v_var.name else '' end,
      'price', v_price, 'duration_minutes', v_dur, 'span_minutes', v_span, 'addons', v_addons,
      'commission_pct', v_svc.commission_pct, 'employee_id', nullif(v_item->>'employee_id', ''),
      'category_id', v_svc.category_id, 'parallel', v_par, 'team', v_k);
    v_total := v_total + v_price;
  end loop;
  return jsonb_build_object('lines', v_lines, 'total', v_total, 'minutes', v_bend);
end $$;

create or replace function public.create_booking(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := public.normalize_phone(p->>'phone');
  v_default_emp uuid := nullif(p->>'employee_id', '')::uuid;
  v_status public.appointment_status := coalesce(nullif(p->>'status', ''), 'solicitud')::public.appointment_status;
  v_source public.appointment_source := coalesce(nullif(p->>'source', ''), 'website')::public.appointment_source;
  v_start timestamptz; v_items jsonb; v_calc jsonb; v_lines jsonb; v_line jsonb;
  v_client uuid; v_appt uuid; v_t timestamptz; v_t2 timestamptz; v_end timestamptz; v_total numeric;
  v_span int; v_bstart timestamptz; v_bend timestamptz; v_firstln boolean := true; v_par boolean; v_teams jsonb := '{}'::jsonb; v_tid uuid; v_k text;
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
    for v_line in select * from jsonb_array_elements(v_lines) loop
      v_span := (v_line->>'span_minutes')::int;
      v_par := coalesce((v_line->>'parallel')::boolean, false) and not v_firstln;
      if v_firstln then v_t := v_start; v_bstart := v_t; v_bend := v_t + make_interval(mins => v_span); v_firstln := false;
      elsif v_par then v_t := v_bstart; v_bend := greatest(v_bend, v_t + make_interval(mins => v_span));
      else v_t := v_bend; v_bstart := v_t; v_bend := v_t + make_interval(mins => v_span); end if;
      v_t2 := v_t + make_interval(mins => v_span);
      v_k := nullif(v_line->>'team', ''); v_tid := null;
      if v_k is not null then
        if v_teams ? v_k then v_tid := (v_teams->>v_k)::uuid;
        else v_tid := gen_random_uuid(); v_teams := v_teams || jsonb_build_object(v_k, v_tid); end if;
      end if;
      insert into public.appointment_services (appointment_id, service_id, variant_id, name, price, final_price,
        duration_minutes, span_minutes, addons, employee_id, commission_pct, position, start_time, end_time, parallel, team_id)
      values (v_appt, (v_line->>'service_id')::uuid, nullif(v_line->>'variant_id', '')::uuid, v_line->>'name',
        (v_line->>'price')::numeric, (v_line->>'price')::numeric, (v_line->>'duration_minutes')::int,
        (v_line->>'span_minutes')::int, v_line->'addons', nullif(v_line->>'employee_id', '')::uuid,
        nullif(v_line->>'commission_pct', '')::numeric, v_pos, v_t, v_t2, v_par, v_tid);
      v_pos := v_pos + 1;
    end loop;
  exception when exclusion_violation then
    raise exception 'slot_taken';
  end;

  return jsonb_build_object('id', v_appt, 'request_number', v_req, 'client_id', v_client,
                            'estimated_total', v_total - v_discount, 'end_time', v_end);
end $$;

create or replace function public.reschedule_appointment(p_appointment uuid, p_start timestamptz, p_employee uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.appointments; v_t timestamptz; v_line public.appointment_services; v_first uuid;
  v_span int; v_bstart timestamptz; v_bend timestamptz; v_firstln boolean := true;
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
      v_span := coalesce(v_line.span_minutes, v_line.duration_minutes);
      if v_firstln then v_t := p_start; v_bstart := v_t; v_bend := v_t + make_interval(mins => v_span); v_firstln := false;
      elsif v_line.parallel then v_t := v_bstart; v_bend := greatest(v_bend, v_t + make_interval(mins => v_span));
      else v_t := v_bend; v_bstart := v_t; v_bend := v_t + make_interval(mins => v_span); end if;
      update public.appointment_services
         set start_time = v_t, end_time = v_t + make_interval(mins => v_span),
             employee_id = coalesce(p_employee, employee_id)
       where id = v_line.id;
    end loop;
    update public.appointment_services set active = true where appointment_id = a.id;
  exception when exclusion_violation then
    raise exception 'slot_taken';
  end;
  select employee_id into v_first from public.appointment_services
   where appointment_id = a.id and start_time is not null order by position, id limit 1;
  update public.appointments
     set start_time = p_start, end_time = greatest(v_bend, p_start + interval '15 minutes'),
         appointment_date = (p_start at time zone 'America/Santo_Domingo')::date,
         employee_id = coalesce(v_first, case when p_employee is not null then p_employee else employee_id end)
   where id = a.id;
  return jsonb_build_object('id', a.id);
end $$;

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
  return jsonb_build_object('id', a.id, 'total', v_sub - v_discount + v_tip);
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

create or replace function public.lookup_booking_public(p_request text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.appointments; c public.clients; v_hours int; v_lines jsonb;
begin
  select * into c from public.clients where phone_normalized = public.normalize_phone(p_phone);
  if c.id is null then raise exception 'booking_not_found'; end if;
  select * into a from public.appointments where upper(request_number) = upper(trim(p_request)) and client_id = c.id;
  if a.id is null then raise exception 'booking_not_found'; end if;
  select coalesce((value->>'cancel_hours')::int, 4) into v_hours from public.business_settings where key = 'booking';
  select coalesce(jsonb_agg(jsonb_build_object('name', g.name, 'price', g.price, 'quantity', g.quantity) order by g.pos), '[]'::jsonb)
    into v_lines
    from (select min(s.position) as pos, (array_agg(s.name order by s.position))[1] as name,
                 sum(s.final_price) as price, max(s.quantity) as quantity
            from public.appointment_services s where s.appointment_id = a.id group by coalesce(s.team_id, s.id)) g;
  return jsonb_build_object('id', a.id, 'request_number', a.request_number, 'status', a.status, 'start_time', a.start_time, 'end_time', a.end_time,
    'first_name', c.first_name, 'total', a.estimated_total, 'lines', v_lines,
    'cancellable', a.status in ('solicitud', 'contactando', 'contactado', 'confirmado') and a.start_time > now() + make_interval(hours => coalesce(v_hours, 4)),
    'cancel_hours', coalesce(v_hours, 4));
end $$;
