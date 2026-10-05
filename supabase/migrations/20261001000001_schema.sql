-- Glow Beauty Center — esquema principal
create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ───────────── Tipos ─────────────
create type public.appointment_status as enum (
  'solicitud','contactando','contactado','confirmado','en_espera',
  'en_servicio','completado','cancelado','no_asistio'
);
create type public.appointment_source as enum (
  'website','admin','whatsapp','phone','walk_in','instagram'
);
create type public.payment_status as enum ('pendiente','parcial','pagado','reembolsado');
create type public.payment_method as enum ('efectivo','tarjeta','transferencia','otro');

-- ───────────── Utilidades ─────────────
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- Normaliza teléfonos dominicanos a 10 dígitos (8095555555).
create or replace function public.normalize_phone(p text) returns text
language plpgsql immutable as $$
declare d text;
begin
  d := regexp_replace(coalesce(p,''), '\D', '', 'g');
  if length(d) = 11 and left(d,1) = '1' then d := substr(d,2); end if;
  return d;
end $$;

-- ───────────── Roles y perfiles ─────────────
create table public.roles (
  key text primary key,
  label text not null,
  description text
);
insert into public.roles (key,label,description) values
  ('super_admin','Super administrador','Acceso completo'),
  ('manager','Gerente','Dashboard, ventas, reportes, clientes, servicios, agenda'),
  ('receptionist','Recepción','Citas, clientes, reservaciones y cobros'),
  ('specialist','Especialista','Sus propias citas y clientes asignados');

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  avatar_url text,
  phone text,
  email text,
  specialty text,
  bio text,
  commission_pct numeric(5,2) check (commission_pct between 0 and 100),
  active boolean not null default true,
  accepts_online_booking boolean not null default true,
  display_order int not null default 0,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'receptionist' references public.roles(key),
  employee_id uuid references public.employees(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.employee_schedules (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = domingo
  start_time time not null,
  end_time time not null,
  break_start time,
  break_end time,
  check (end_time > start_time),
  unique (employee_id, weekday)
);

create table public.employee_time_off (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  check (ends_at > starts_at)
);

-- ───────────── Servicios ─────────────
create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  display_order int not null default 0,
  active boolean not null default true
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.service_categories(id),
  name text not null,
  slug text not null unique,
  short_description text,
  description text,
  price numeric(10,2) not null check (price >= 0),
  price_from boolean not null default false,
  duration_minutes int not null check (duration_minutes > 0),
  buffer_before_minutes int not null default 0 check (buffer_before_minutes >= 0),
  buffer_after_minutes int not null default 0 check (buffer_after_minutes >= 0),
  commission_pct numeric(5,2) check (commission_pct between 0 and 100),
  requires_consultation boolean not null default false,
  image_url text,
  featured boolean not null default false,
  active boolean not null default true,
  pending_review boolean not null default false, -- nombre sin confirmar: nunca se publica
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index services_category_idx on public.services(category_id, display_order);
create index services_active_idx on public.services(active) where active;

create table public.service_variants (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null check (price >= 0),
  duration_minutes int not null check (duration_minutes > 0),
  display_order int not null default 0,
  active boolean not null default true
);
create index service_variants_service_idx on public.service_variants(service_id);

create table public.service_addons (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null default 0 check (price >= 0),
  duration_minutes int not null default 0 check (duration_minutes >= 0),
  active boolean not null default true
);
create index service_addons_service_idx on public.service_addons(service_id);

create table public.employee_services (
  employee_id uuid not null references public.employees(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  primary key (employee_id, service_id)
);

-- ───────────── Clientes ─────────────
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null default '',
  phone text not null,
  phone_normalized text generated always as (public.normalize_phone(phone)) stored,
  email text,
  internal_notes text,
  active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index clients_phone_uidx on public.clients(phone_normalized);
create index clients_name_idx on public.clients using gin (
  to_tsvector('simple', first_name || ' ' || last_name));

-- ───────────── Citas ─────────────
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique default
    ('SOL-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  client_id uuid not null references public.clients(id),
  employee_id uuid references public.employees(id),
  status public.appointment_status not null default 'solicitud',
  appointment_date date not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  estimated_total numeric(10,2) not null default 0 check (estimated_total >= 0),
  discount numeric(10,2) not null default 0 check (discount >= 0),
  tip numeric(10,2) not null default 0 check (tip >= 0),
  final_total numeric(10,2) check (final_total >= 0),
  notes text,
  source public.appointment_source not null default 'website',
  google_calendar_event_id text,
  completed_at timestamptz,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time),
  -- Nunca dos citas activas cruzadas para el mismo especialista
  constraint appointments_no_overlap exclude using gist (
    employee_id with =,
    tstzrange(start_time, end_time) with &&
  ) where (employee_id is not null and status not in ('cancelado','no_asistio'))
);
create index appointments_date_idx on public.appointments(appointment_date, status);
create index appointments_client_idx on public.appointments(client_id);
create index appointments_employee_idx on public.appointments(employee_id, start_time);

create table public.appointment_services (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  variant_id uuid references public.service_variants(id) on delete set null,
  name text not null,                       -- snapshot del nombre
  price numeric(10,2) not null check (price >= 0),
  final_price numeric(10,2) not null check (final_price >= 0),
  duration_minutes int not null check (duration_minutes >= 0),
  quantity int not null default 1 check (quantity > 0),
  addons jsonb not null default '[]'::jsonb,
  employee_id uuid references public.employees(id),
  commission_pct numeric(5,2)
);
create index appointment_services_appt_idx on public.appointment_services(appointment_id);

create table public.appointment_status_history (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  old_status public.appointment_status,
  new_status public.appointment_status not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);
create index appt_history_idx on public.appointment_status_history(appointment_id, changed_at);

create table public.appointment_notes (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  note text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade, -- null = todo el negocio
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null default 'manual' check (kind in ('manual','feriado','almuerzo','especial')),
  reason text,
  created_by uuid references auth.users(id),
  check (ends_at > starts_at)
);
create index schedule_blocks_range_idx on public.schedule_blocks(starts_at, ends_at);

-- ───────────── Ventas y pagos ─────────────
create table public.sale_counters (
  period text primary key, -- YYYYMM
  last_value int not null default 0
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  sale_number text not null unique,
  appointment_id uuid unique references public.appointments(id),
  client_id uuid references public.clients(id),
  employee_id uuid references public.employees(id),
  subtotal numeric(10,2) not null default 0,
  discount numeric(10,2) not null default 0,
  tip numeric(10,2) not null default 0,
  tax numeric(10,2) not null default 0,
  total numeric(10,2) not null check (total >= 0),
  payment_status public.payment_status not null default 'pendiente',
  notes text,
  is_demo boolean not null default false,
  completed_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index sales_completed_idx on public.sales(completed_at desc);
create index sales_client_idx on public.sales(client_id);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  category_id uuid references public.service_categories(id) on delete set null,
  employee_id uuid references public.employees(id),
  description text not null,
  quantity int not null default 1,
  unit_price numeric(10,2) not null,
  total numeric(10,2) not null,
  commission_pct numeric(5,2)
);
create index sale_items_sale_idx on public.sale_items(sale_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references public.sales(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  amount numeric(10,2) not null check (amount > 0),
  method public.payment_method not null,
  reference text,
  status text not null default 'pagado' check (status in ('pagado','reembolsado')),
  is_demo boolean not null default false,
  paid_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index payments_sale_idx on public.payments(sale_id);
create index payments_appt_idx on public.payments(appointment_id);

-- ───────────── Promociones, galería, ajustes ─────────────
create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  original_price numeric(10,2) check (original_price >= 0),
  promo_price numeric(10,2) not null check (promo_price >= 0),
  starts_on date,
  ends_on date,
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.promotion_services (
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  primary key (promotion_id, service_id)
);

create table public.gallery (
  id uuid primary key default gen_random_uuid(),
  title text,
  category text not null default 'glow' check (category in ('unas','cabello','pedicure','tratamientos','glow')),
  image_url text not null,
  storage_path text,
  is_cover boolean not null default false,
  display_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.business_settings (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  title text not null,
  body text,
  appointment_id uuid references public.appointments(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_unread_idx on public.notifications(created_at desc) where read_at is null;

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index audit_entity_idx on public.audit_logs(entity, entity_id, created_at desc);

create table public.calendar_integrations (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'google',
  calendar_id text,
  enabled boolean not null default false,
  last_sync_at timestamptz,
  last_error text
);

-- updated_at
create trigger t_employees_u before update on public.employees for each row execute function public.set_updated_at();
create trigger t_services_u before update on public.services for each row execute function public.set_updated_at();
create trigger t_clients_u before update on public.clients for each row execute function public.set_updated_at();
create trigger t_appts_u before update on public.appointments for each row execute function public.set_updated_at();
