-- Glow Beauty Center — modelo de agenda por línea de servicio.
-- Cada línea (servicio) tiene su propio especialista y horario. Así un combo
-- (p. ej. uñas con Ana + cabello con Carla) se agenda en secuencia y la
-- restricción anti-solapes protege a CADA especialista, no solo al principal.

-- 0. Extensión fuera del esquema public (evita exponer funciones gbt_* por la API)
do $$ begin
  create schema if not exists extensions;
  alter extension btree_gist set schema extensions;
exception when others then
  raise notice 'btree_gist no se pudo mover: %', sqlerrm;
end $$;

-- 1. Columnas de agenda por línea
alter table public.appointment_services
  add column if not exists position int not null default 0,
  add column if not exists span_minutes int,
  add column if not exists start_time timestamptz,
  add column if not exists end_time timestamptz,
  add column if not exists active boolean not null default true;

alter table public.appointments
  add column if not exists promotion_id uuid references public.promotions(id) on delete set null;

-- 2. Relleno de las citas existentes: líneas en secuencia desde el inicio de la cita
with ordered as (
  select s.id, s.appointment_id,
         row_number() over (partition by s.appointment_id order by s.id) - 1 as pos,
         coalesce(sum(s.duration_minutes) over (partition by s.appointment_id order by s.id
                  rows between unbounded preceding and 1 preceding), 0) as offs
  from public.appointment_services s
)
update public.appointment_services s
set position = o.pos,
    span_minutes = s.duration_minutes,
    start_time = a.start_time + make_interval(mins => o.offs::int),
    end_time = a.start_time + make_interval(mins => (o.offs + s.duration_minutes)::int),
    employee_id = coalesce(s.employee_id, a.employee_id),
    active = a.status not in ('cancelado', 'no_asistio')
from ordered o join public.appointments a on a.id = o.appointment_id
where o.id = s.id;

alter table public.appointment_services
  add constraint appt_lines_range_ck check (start_time is null or end_time is null or end_time >= start_time);

-- 3. Anti-solapes por especialista a nivel de línea (reemplaza el de la cita)
alter table public.appointments drop constraint if exists appointments_no_overlap;
alter table public.appointment_services
  add constraint appt_lines_no_overlap exclude using gist (
    employee_id with =, tstzrange(start_time, end_time) with &&
  ) where (active and employee_id is not null and start_time is not null and end_time is not null and end_time > start_time);

create index if not exists appt_lines_emp_time_idx on public.appointment_services (employee_id, start_time) where active;
create index if not exists appt_lines_pos_idx on public.appointment_services (appointment_id, position);

-- 4. Al cancelar / reabrir una cita, sus líneas liberan / reocupan el horario
create or replace function public.sync_lines_active() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    update public.appointment_services
       set active = (new.status not in ('cancelado', 'no_asistio'))
     where appointment_id = new.id
       and active is distinct from (new.status not in ('cancelado', 'no_asistio'));
  end if;
  return new;
end $$;
create trigger t_appt_lines_active after update of status on public.appointments
  for each row execute function public.sync_lines_active();

-- 5. Visibilidad de especialistas (SECURITY DEFINER para evitar recursión de RLS)
create or replace function public.specialist_sees(p_appt uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.appointments a
    where a.id = p_appt and (
      a.employee_id = public.my_employee_id()
      or exists (select 1 from public.appointment_services s where s.appointment_id = a.id and s.employee_id = public.my_employee_id())
    )
  )
$$;

create or replace function public.specialist_sees_client(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.appointments a where a.client_id = p_client and public.specialist_sees(a.id))
$$;

drop policy if exists appt_read on public.appointments;
create policy appt_read on public.appointments for select to authenticated using (
  public.has_role('super_admin','manager','receptionist')
  or (public.has_role('specialist') and public.specialist_sees(id)));

drop policy if exists appt_specialist_update on public.appointments;
create policy appt_specialist_update on public.appointments for update to authenticated
  using (public.has_role('specialist') and public.specialist_sees(id))
  with check (public.has_role('specialist') and public.specialist_sees(id) and status in ('en_servicio','completado'));

drop policy if exists clients_read on public.clients;
create policy clients_read on public.clients for select to authenticated using (
  public.has_role('super_admin','manager','receptionist')
  or (public.has_role('specialist') and public.specialist_sees_client(id)));

-- 6. Funciones auxiliares de cálculo y validación (internas)
create or replace function public._compute_items(p_items jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_item jsonb; v_svc public.services; v_var public.service_variants; v_addon public.service_addons;
  v_lines jsonb := '[]'::jsonb; v_price numeric; v_dur int; v_addons jsonb; v_aid text;
  v_total numeric := 0; v_minutes int := 0; v_span int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'no_services';
  end if;
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
    v_lines := v_lines || jsonb_build_object(
      'service_id', v_svc.id, 'variant_id', v_var.id,
      'name', v_svc.name || case when v_var.id is not null then ' – ' || v_var.name else '' end,
      'price', v_price, 'duration_minutes', v_dur, 'span_minutes', v_span, 'addons', v_addons,
      'commission_pct', v_svc.commission_pct, 'employee_id', nullif(v_item->>'employee_id', ''),
      'category_id', v_svc.category_id);
    v_total := v_total + v_price; v_minutes := v_minutes + v_span;
  end loop;
  return jsonb_build_object('lines', v_lines, 'total', v_total, 'minutes', v_minutes);
end $$;

create or replace function public._check_employee(p_emp uuid, p_service uuid) returns void
language plpgsql stable set search_path = public as $$
begin
  if p_emp is null then return; end if;
  if not exists (select 1 from public.employees where id = p_emp and active) then raise exception 'employee_unavailable'; end if;
  if exists (select 1 from public.employee_services where service_id = p_service)
     and not exists (select 1 from public.employee_services where service_id = p_service and employee_id = p_emp) then
    raise exception 'employee_cannot_perform';
  end if;
end $$;

-- 7. Crear reserva (solo servidor / service_role)
-- p: { first_name,last_name,phone,email,notes,source,start_time,status,created_by,promotion_id,employee_id (por defecto),
--      services:[{service_id,variant_id,addon_ids:[],employee_id}] }  — las líneas se agendan en el orden recibido.
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
  if v_source <> 'walk_in' and v_start < now() - interval '5 minutes' then raise exception 'past_date'; end if;

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
    perform public._check_employee(nullif(v_line->>'employee_id', '')::uuid, (v_line->>'service_id')::uuid);
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
revoke all on function public.create_booking(jsonb) from public, anon, authenticated;
grant execute on function public.create_booking(jsonb) to service_role;

-- 8. Reprogramar: desplaza todas las líneas cronometradas conservando orden y especialistas
create or replace function public.reschedule_appointment(p_appointment uuid, p_start timestamptz, p_employee uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.appointments; v_t timestamptz; v_line public.appointment_services; v_first uuid;
begin
  if not public.has_role('super_admin', 'manager', 'receptionist') then raise exception 'forbidden'; end if;
  select * into a from public.appointments where id = p_appointment for update;
  if not found then raise exception 'appointment_not_found'; end if;
  if a.status in ('completado', 'cancelado', 'no_asistio') then raise exception 'appointment_closed'; end if;
  if p_start < now() - interval '5 minutes' then raise exception 'past_date'; end if;

  update public.appointment_services set active = false where appointment_id = a.id;
  v_t := p_start;
  begin
    for v_line in select * from public.appointment_services where appointment_id = a.id and start_time is not null order by position, id loop
      if p_employee is not null then perform public._check_employee(p_employee, v_line.service_id); end if;
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
grant execute on function public.reschedule_appointment(uuid, timestamptz, uuid) to authenticated;

-- 9. Editar cita: líneas (precio final, cantidad, especialista, altas y bajas), horario, notas, descuento y propina.
-- p: { start_time?, notes?, source?, discount?, tip?, lines:[
--        {id}                       -> conserva la línea (puede traer employee_id, final_price, quantity)
--        {service_id,variant_id,addon_ids,employee_id,final_price?,quantity?} -> servicio nuevo (cronometrado)
--        {name,final_price,quantity} -> concepto libre / producto (sin horario) ] }
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
          perform public._check_employee(v_emp, v_row.service_id);
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
        perform public._check_employee(v_emp, (v_new->>'service_id')::uuid);
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
grant execute on function public.update_appointment(uuid, jsonb) to authenticated;
