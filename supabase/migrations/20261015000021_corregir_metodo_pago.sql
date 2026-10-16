-- Glow Beauty Center — corregir el método de un cobro ya registrado.
-- Pasa cuando un cobro con tarjeta o transferencia se guardó como «efectivo» (o al revés): sin esto, el efectivo que debe haber en la caja
-- no cuadra y el cobro aparece en el método equivocado. Solo gerente y super administrador. Reglas:
--   • solo cobros pagados (no reembolsados) y a un método activo distinto del actual;
--   • no se puede si el cobro cayó dentro de una caja ya cerrada (su cierre quedó guardado: primero hay que reabrirlo);
--   • si el método nuevo es efectivo, queda recibido exacto (sin vuelto); si no, se borra el «recibido».
-- Queda en Auditoría (método anterior y nuevo, y el motivo). No agrega tablas ni columnas; re-ejecutable.

create or replace function public.change_payment_method(p_payment uuid, p_method text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.payments; m public.payment_methods; v_was_cash boolean;
begin
  if not public.has_role('super_admin', 'manager') then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(hashtext('glow-cash-session'));
  select * into p from public.payments where id = p_payment for update;
  if not found then raise exception 'payment_not_found'; end if;
  if p.status <> 'pagado' then raise exception 'payment_not_paid'; end if;
  select * into m from public.payment_methods where key = p_method and active;
  if not found then raise exception 'invalid_method'; end if;
  if p.method = p_method then raise exception 'same_method'; end if;
  if exists (select 1 from public.cash_sessions cs where cs.closed_at is not null and p.paid_at >= cs.opened_at and p.paid_at < cs.closed_at) then
    raise exception 'payment_in_closed_cash';
  end if;
  select coalesce(is_cash, false) into v_was_cash from public.payment_methods where key = p.method;
  insert into public.audit_logs (user_id, action, entity, entity_id, before_data, after_data)
  values (public.actor_id(), 'change_payment_method', 'payments', p.id,
          jsonb_build_object('method', p.method, 'tendered', p.tendered, 'amount', p.amount),
          jsonb_build_object('method', p_method, 'reason', nullif(trim(left(coalesce(p_reason, ''), 300)), ''), 'sale_id', p.sale_id));
  update public.payments set method = p_method, tendered = case when m.is_cash then p.amount else null end where id = p.id;
  return jsonb_build_object('id', p.id, 'amount', p.amount, 'method', p_method, 'was_cash', coalesce(v_was_cash, false), 'is_cash', m.is_cash);
end $$;

revoke execute on function public.change_payment_method(uuid, text, text) from public, anon;
grant execute on function public.change_payment_method(uuid, text, text) to authenticated;
