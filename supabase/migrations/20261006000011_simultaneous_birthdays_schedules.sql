-- Glow Beauty Center — citas simultáneas, cumpleaños del personal y horarios por defecto.
-- Compatible hacia atrás: el código anterior sigue funcionando con esta migración aplicada.

-- ───────────── 1. Citas al mismo tiempo con la misma especialista ─────────────
-- El personal (recepción, gerencia) puede agendar todas las citas que quiera a la misma hora: se quita la
-- restricción que lo impedía. La agenda del panel las muestra una al lado de la otra.
alter table public.appointment_services drop constraint if exists appt_lines_no_overlap;

-- ───────────── 2. Reserva en línea: tope de citas simultáneas por especialista ─────────────
-- Las solicitudes que llegan desde la web (las crea el servidor, sin sesión de personal) respetan el tope
-- "max_simultaneous" de Configuración → Reservas (por defecto 2; 1 = una cita a la vez). Se comprueba aquí,
-- dentro de la misma transacción y con un candado por especialista, para que dos clientas no se pasen del tope.
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

  perform pg_advisory_xact_lock(hashtextextended(new.employee_id::text, 0));
  select value->>'max_simultaneous' into v_raw from public.business_settings where key = 'booking';
  v_max := case when v_raw ~ '^\d{1,2}$' then greatest(v_raw::int, 1) else 2 end;

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
revoke all on function public.enforce_web_capacity() from public, anon, authenticated;

drop trigger if exists t_appt_lines_capacity on public.appointment_services;
create trigger t_appt_lines_capacity before insert or update of employee_id, start_time, end_time, active
  on public.appointment_services for each row execute function public.enforce_web_capacity();

-- ───────────── 3. Cumpleaños del personal ─────────────
-- Día y mes (el año no hace falta): así se puede registrar aunque no se sepa la edad.
alter table public.employees add column if not exists birth_month smallint, add column if not exists birth_day smallint;
do $$ begin
  alter table public.employees add constraint employees_birthday_ck check (
    (birth_month is null and birth_day is null) or
    (birth_month is not null and birth_day is not null and birth_month between 1 and 12 and birth_day between 1 and
      case birth_month when 2 then 29 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end));
exception when duplicate_object then null; end $$;

alter table public.notifications
  add column if not exists employee_id uuid references public.employees(id) on delete cascade,
  add column if not exists event_date date;
create unique index if not exists notifications_birthday_uidx on public.notifications (employee_id, event_date) where type = 'cumpleanos';

-- generate_reminders (pg_cron, cada 5 min): cita próxima + pago pendiente + cumpleaños de hoy
create or replace function public.generate_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare
  n1 int := 0; n2 int := 0; n3 int := 0;
  v_today date := (now() at time zone 'America/Santo_Domingo')::date;
  v_year int := extract(year from (now() at time zone 'America/Santo_Domingo'))::int;
begin
  insert into public.notifications (type, title, body, appointment_id)
  select 'cita_proxima', 'Cita en menos de 1 hora: ' || trim(c.first_name || ' ' || c.last_name),
         to_char(a.start_time at time zone 'America/Santo_Domingo', 'HH12:MI AM'), a.id
  from public.appointments a join public.clients c on c.id = a.client_id
  where a.status in ('solicitud', 'contactando', 'contactado', 'confirmado') and a.start_time between now() and now() + interval '60 minutes'
  on conflict do nothing;
  get diagnostics n1 = row_count;
  insert into public.notifications (type, title, body, sale_id)
  select 'pago_pendiente', 'Pago pendiente: ' || s.sale_number, 'Saldo RD$ ' || (s.total - coalesce(p.paid, 0)), s.id
  from public.sales s
  left join lateral (select sum(amount) as paid from public.payments where sale_id = s.id and status = 'pagado') p on true
  where s.payment_status in ('pendiente', 'parcial') and s.voided_at is null and s.completed_at < now() - interval '2 hours'
  on conflict do nothing;
  get diagnostics n2 = row_count;
  -- Quien cumple el 29 de febrero se felicita el 28 en los años que no son bisiestos
  insert into public.notifications (type, title, body, employee_id, event_date)
  select 'cumpleanos', 'Hoy cumple años ' || e.full_name, 'No olvides felicitar a ' || split_part(trim(e.full_name), ' ', 1) || '.', e.id, v_today
  from public.employees e
  where e.active and e.birth_month is not null
    and ((e.birth_month = extract(month from v_today) and e.birth_day = extract(day from v_today))
      or (e.birth_month = 2 and e.birth_day = 29 and v_today = make_date(v_year, 2, 28)
          and extract(day from (make_date(v_year, 3, 1) - 1)) = 28))
  on conflict do nothing;
  get diagnostics n3 = row_count;
  return n1 + n2 + n3;
end $$;
revoke execute on function public.generate_reminders() from public, anon, authenticated;

-- ───────────── 4. Horarios por defecto ─────────────
-- Una especialista sin horario guardado no aparece en la reserva en línea ("No hay horarios disponibles").
-- A las activas que no tienen ninguno se les copia el horario del negocio (Configuración → Horarios); se puede
-- ajustar después en su ficha. Los días cerrados del negocio quedan como día libre.
insert into public.employee_schedules (employee_id, weekday, start_time, end_time)
select e.id, d.wd, (x.h->>'open')::time, (x.h->>'close')::time
from public.employees e
cross join generate_series(0, 6) as d(wd)
cross join lateral (select (select value from public.business_settings where key = 'hours') -> (d.wd::text) as h) x
where e.active and not e.is_demo
  and not exists (select 1 from public.employee_schedules s where s.employee_id = e.id)
  and jsonb_typeof(x.h) = 'object' and x.h ? 'open' and x.h ? 'close'
  and (x.h->>'close')::time > (x.h->>'open')::time
on conflict (employee_id, weekday) do nothing;
