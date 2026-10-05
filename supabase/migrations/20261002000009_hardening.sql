-- Glow Beauty Center — endurecimiento de seguridad (se aplica al final para cubrir todas las funciones)

-- 1. search_path fijo en funciones simples
alter function public.set_updated_at() set search_path = public;
alter function public.normalize_phone(text) set search_path = public;
alter function public.compute_payment_status(numeric, numeric, numeric) set search_path = public;
alter function public.actor_id() set search_path = public;

-- 2. El especialista solo puede avanzar SUS citas (confirmada/en espera → en servicio → completada)
--    y no puede alterar ninguna otra columna aunque llame a la API directamente.
create or replace function public.guard_specialist_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_skip text[] := array['status', 'updated_at', 'final_total', 'completed_at'];
begin
  if public.current_role_key() = 'specialist' then
    if (to_jsonb(new) - v_skip) <> (to_jsonb(old) - v_skip) then raise exception 'forbidden'; end if;
    if not (new.status = old.status
            or (old.status in ('confirmado', 'en_espera') and new.status = 'en_servicio')
            or (old.status = 'en_servicio' and new.status = 'completado')) then
      raise exception 'forbidden';
    end if;
  end if;
  return new;
end $$;
create trigger t_appt_guard before update on public.appointments
  for each row execute function public.guard_specialist_update();

-- 3. Privilegios de ejecución: nada interno queda expuesto por la API pública
revoke execute on function public.next_sale_number() from public, anon, authenticated;
revoke execute on function public.refresh_sale_payment_status(uuid) from public, anon, authenticated;
revoke execute on function public._payment_method_ok(text) from public, anon, authenticated;
revoke execute on function public._compute_items(jsonb) from public, anon, authenticated;
revoke execute on function public._check_employee(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.generate_reminders() from public, anon, authenticated;
revoke execute on function public.log_status_change() from public, anon, authenticated;
revoke execute on function public.audit_row() from public, anon, authenticated;
revoke execute on function public.notify_appointment() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.sync_lines_active() from public, anon, authenticated;
revoke execute on function public.guard_specialist_update() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- Funciones que usa el personal autenticado (cada una valida el rol internamente)
do $$ declare f text; begin
  foreach f in array array[
    'public.complete_appointment(uuid)',
    'public.record_payment(uuid, numeric, text, text, boolean)',
    'public.record_sale_payment(uuid, numeric, text, text, boolean)',
    'public.refund_payment(uuid)',
    'public.reschedule_appointment(uuid, timestamptz, uuid)',
    'public.update_appointment(uuid, jsonb)',
    'public.void_sale(uuid, text)',
    'public.update_sale_notes(uuid, text)',
    'public.create_quick_sale(jsonb)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Las funciones nuevas nacen privadas
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;

-- 4. El rol anónimo nunca escribe directamente; nadie vacía tablas por la API
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges for role postgres in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon;

-- 5. Equipo público sin vista SECURITY DEFINER: columnas mínimas + RLS
drop view if exists public.public_employees;
revoke select on public.employees from anon;
grant select (id, full_name, avatar_url, specialty, bio, display_order, active, accepts_online_booking) on public.employees to anon;
drop policy if exists emp_read_public on public.employees;
create policy emp_read_public on public.employees for select to anon using (active and accepts_online_booking);

-- 6. Storage: las imágenes públicas se sirven por URL pública; no se permite listarlas por API
drop policy if exists "public read images" on storage.objects;
drop policy if exists "staff read images" on storage.objects;
create policy "staff read images" on storage.objects for select to authenticated
  using (bucket_id in ('service-images', 'gallery', 'employee-avatars') and public.has_role('super_admin', 'manager'));
