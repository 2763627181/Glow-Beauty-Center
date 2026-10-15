-- Glow Beauty Center — nombre del cliente en las ventas de mostrador.
-- Muchas ventas se hacen sin un cliente registrado (no hay teléfono): ahora se puede escribir el nombre de quien compra y sale en la
-- factura, en la lista de ventas y en los movimientos de la caja. Si la venta tiene un cliente registrado, manda su nombre.
-- Solo agrega una columna opcional; re-ejecutable.

alter table public.sales add column if not exists customer_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sales_customer_name_ck') then
    alter table public.sales add constraint sales_customer_name_ck check (customer_name is null or length(trim(customer_name)) between 1 and 80);
  end if;
end $$;

create or replace function public.create_quick_sale(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sub numeric := 0; v_item jsonb; v_disc numeric := coalesce(nullif(p->>'discount', '')::numeric, 0);
  v_tip numeric := coalesce(nullif(p->>'tip', '')::numeric, 0); v_total numeric; v_paid numeric := 0;
  v_sale public.sales; v_pay jsonb; v_qty int; v_price numeric; v_client uuid := nullif(p->>'client_id', '')::uuid;
  v_emp uuid := nullif(p->>'employee_id', '')::uuid; v_allow boolean := coalesce((p->>'allow_overpay')::boolean, false);
  v_cname text := nullif(trim(left(coalesce(p->>'customer_name', ''), 80)), ''); -- nombre de quien compra si no es un cliente registrado
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

  insert into public.sales (sale_number, client_id, customer_name, employee_id, subtotal, discount, tip, total, notes, created_by)
  values (public.next_sale_number(), v_client, case when v_client is null then v_cname end, v_emp, v_sub, v_disc, v_tip, v_total, nullif(trim(left(p->>'notes', 1000)), ''), public.actor_id())
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
           'client', coalesce(nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), sa.customer_name), 'by', pr.full_name,
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

create or replace function public.cash_unassigned() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_first timestamptz; v_n int; v_total numeric; v_items jsonb;
begin
  if not public.has_role('super_admin', 'manager', 'receptionist') then raise exception 'forbidden'; end if;
  select min(opened_at) into v_first from public.cash_sessions;
  if v_first is null then return jsonb_build_object('count', 0, 'total', 0, 'items', '[]'::jsonb); end if;
  with o as (
    select p.id, p.paid_at, p.amount, p.sale_id, sa.sale_number,
           coalesce(nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), sa.customer_name) as client
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
