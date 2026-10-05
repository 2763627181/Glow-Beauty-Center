-- Elimina TODOS los datos demo.
delete from public.payments where is_demo;
delete from public.sales where is_demo;
delete from public.appointments where is_demo;
delete from public.clients where is_demo;
delete from public.employees where is_demo;
