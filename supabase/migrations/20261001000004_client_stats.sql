-- Estadísticas por cliente. security_invoker => respeta RLS del usuario que consulta.
create or replace view public.client_stats with (security_invoker = true) as
select
  c.id as client_id,
  coalesce(a.visits, 0)::int as visits,
  coalesce(a.cancellations, 0)::int as cancellations,
  coalesce(a.no_shows, 0)::int as no_shows,
  a.last_visit,
  a.next_appointment,
  coalesce(s.total_spent, 0) as total_spent
from public.clients c
left join (
  select client_id,
    count(*) filter (where status = 'completado') as visits,
    count(*) filter (where status = 'cancelado') as cancellations,
    count(*) filter (where status = 'no_asistio') as no_shows,
    max(start_time) filter (where status = 'completado') as last_visit,
    min(start_time) filter (where start_time > now() and status not in ('cancelado','no_asistio','completado')) as next_appointment
  from public.appointments group by client_id
) a on a.client_id = c.id
left join (
  select client_id, sum(total) filter (where payment_status <> 'reembolsado') as total_spent
  from public.sales group by client_id
) s on s.client_id = c.id;

create index if not exists clients_phone_trgm_idx on public.clients (phone_normalized text_pattern_ops);
create index if not exists sales_client_completed_idx on public.sales (client_id, completed_at desc);
create index if not exists appointments_status_start_idx on public.appointments (status, start_time);
grant select on public.client_stats to authenticated;
