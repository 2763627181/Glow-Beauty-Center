-- DATOS DEMO — solo desarrollo. Todo marcado is_demo = true.
-- Para eliminar:  supabase/seed/99_remove_demo.sql
insert into public.employees (full_name, specialty, bio, is_demo, display_order) values
  ('Ana (demo)','Uñas y pedicure','Especialista en manicure, builder y soft gel.',true,1),
  ('Carla (demo)','Cabello','Especialista en lavado, color y keratina.',true,2)
on conflict do nothing;

insert into public.employee_schedules (employee_id, weekday, start_time, end_time, break_start, break_end)
select e.id, d, '09:00'::time, (case when d = 6 then '16:00' else '18:00' end)::time, '13:00'::time, '14:00'::time
from public.employees e, generate_series(1,6) d where e.is_demo
on conflict do nothing;

insert into public.employee_services (employee_id, service_id)
select e.id, s.id from public.employees e join public.services s on true
join public.service_categories c on c.id = s.category_id
where e.is_demo and (
  (e.full_name like 'Ana%' and c.slug in ('unas','pies-spa')) or
  (e.full_name like 'Carla%' and c.slug in ('cabello','tratamientos')))
on conflict do nothing;

insert into public.clients (first_name, last_name, phone, is_demo) values
  ('María','Pérez','809-555-0101',true),
  ('Laura','Gómez','829-555-0102',true),
  ('Sofía','Rodríguez','849-555-0103',true)
on conflict do nothing;

-- Citas demo en distintos estados (usa create_booking como lo haría la web)
do $$
declare r jsonb; ana uuid; carla uuid; mpl uuid; man uuid; lav uuid;
  day0 timestamptz := date_trunc('day', now() at time zone 'America/Santo_Domingo') at time zone 'America/Santo_Domingo' + interval '1 day';
begin
  select id into ana from public.employees where full_name like 'Ana%' and is_demo limit 1;
  select id into carla from public.employees where full_name like 'Carla%' and is_demo limit 1;
  select id into man from public.services where slug='manicure';
  select id into mpl from public.services where slug='pintura-de-manos-gel';
  select id into lav from public.services where slug='lavado-y-secado';

  r := public.create_booking(jsonb_build_object('first_name','María','last_name','Pérez','phone','8095550101',
    'employee_id',ana,'start_time',day0 + interval '10 hours','status','confirmado',
    'services',jsonb_build_array(jsonb_build_object('service_id',man),jsonb_build_object('service_id',mpl))));
  r := public.create_booking(jsonb_build_object('first_name','Laura','last_name','Gómez','phone','8295550102',
    'employee_id',carla,'start_time',day0 + interval '11 hours','status','solicitud',
    'services',jsonb_build_array(jsonb_build_object('service_id',lav,
      'variant_id',(select id from public.service_variants where service_id=lav and name='Pelo largo')))));
  r := public.create_booking(jsonb_build_object('first_name','Sofía','last_name','Rodríguez','phone','8495550103',
    'employee_id',ana,'start_time',day0 + interval '15 hours','status','contactando',
    'services',jsonb_build_array(jsonb_build_object('service_id',man))));
  update public.appointments set is_demo = true where client_id in (select id from public.clients where is_demo);
end $$;
