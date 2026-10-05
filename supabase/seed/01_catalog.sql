-- Catálogo real de Glow Beauty Center. Duraciones = valores iniciales editables en /admin/services.
insert into public.service_categories (name, slug, description, display_order) values
  ('Cabello','cabello','Lavado, secado, color y cuidado capilar',1),
  ('Uñas','unas','Manicure, gel, soft gel y builder',2),
  ('Pies & Spa','pies-spa','Pedicure spa y complementos de bienestar',3),
  ('Tratamientos','tratamientos','Redken, keratinas y tratamientos profundos',4)
on conflict (slug) do nothing;

with c as (select slug, id from public.service_categories)
insert into public.services (category_id, name, slug, short_description, price, price_from, duration_minutes, featured, display_order, active, pending_review)
select c.id, v.name, v.slug, v.descr, v.price, v.price_from, v.dur, v.featured, v.ord, v.active, v.pending
from (values
 -- Cabello
 ('cabello','Lavado y Secado','lavado-y-secado','Lavado y secado profesional según el largo de tu cabello.',600,true,45,true,1,true,false),
 ('cabello','Tinte','tinte','Color profesional para tu cabello.',4000,false,150,true,2,true,false),
 -- Tratamientos
 ('tratamientos','Tratamiento con línea Redken','tratamiento-redken','Tratamiento capilar con productos Redken.',3500,false,90,true,1,true,false),
 ('tratamientos','Ritual Redken','ritual-redken','Ritual de cuidado capilar Redken.',3000,false,75,false,2,true,false),
 ('tratamientos','Keratina Nano','keratina-nano','Alisado y nutrición con keratina nano.',3500,false,150,true,3,true,false),
 -- Uñas
 ('unas','Manicure','manicure','Limpieza, forma e hidratación de manos.',600,false,45,true,1,true,false),
 ('unas','Pedicure','pedicure','Limpieza, forma e hidratación de pies.',700,false,60,true,2,true,false),
 ('unas','Pintura de manos','pintura-de-manos','Esmalte tradicional en manos.',400,false,20,false,3,true,false),
 ('unas','Pintura de pies','pintura-de-pies','Esmalte tradicional en pies.',450,false,20,false,4,true,false),
 ('unas','Pintura de manos Gel','pintura-de-manos-gel','Esmalte gel de larga duración en manos.',700,false,40,true,5,true,false),
 ('unas','Pintura de pies Gel','pintura-de-pies-gel','Esmalte gel de larga duración en pies.',800,false,40,false,6,true,false),
 ('unas','Pedicure hombre','pedicure-hombre','Pedicure para caballeros.',1000,false,60,false,7,true,false),
 ('unas','Manicure hombre','manicure-hombre','Manicure para caballeros.',800,false,45,false,8,true,false),
 ('unas','Retiro de Gel','retiro-de-gel','Retiro seguro de esmalte gel.',200,false,20,false,9,true,false),
 ('unas','Bolas hidratantes','bolas-hidratantes','Complemento hidratante para manos.',300,false,15,false,10,true,false),
 ('unas','Soft Gel','soft-gel','Extensión de uñas con soft gel.',1500,false,90,true,11,true,false),
 ('unas','Builder','builder','Refuerzo y estructura con builder gel.',1500,false,90,true,12,true,false),
 ('unas','Retiro de acrílico, resina y otros','retiro-acrilico-resina','Retiro de acrílico, resina u otros materiales.',500,false,30,false,13,true,false),
 -- Pies & Spa
 ('pies-spa','Spa Feet Calm','spa-feet-calm','Experiencia spa relajante para tus pies.',2800,false,75,true,1,true,false),
 ('pies-spa','Jelly Spa','jelly-spa','Spa en gelatina para manos o pies.',600,false,20,false,2,true,false),
 ('pies-spa','Velaterapia','velaterapia','Masaje con cera tibia aromática.',700,false,20,false,3,true,false),
 ('pies-spa','Botas de colágeno','botas-de-colageno','Tratamiento de colágeno para pies.',600,false,20,false,4,true,false),
 ('pies-spa','Guantes de colágeno','guantes-de-colageno','Tratamiento de colágeno para manos.',600,false,20,false,5,true,false),
 ('pies-spa','Aceite para cutículas','aceite-para-cuticulas','Nutrición para cutículas.',200,false,5,false,6,true,false),
 ('pies-spa','Retoque de Builder','retoque-de-builder','Mantenimiento de builder gel.',850,false,60,false,7,true,false),
 -- PENDIENTES DE CONFIRMAR: no se publican hasta que el negocio confirme el nombre exacto
 ('tratamientos','[PENDIENTE] Keratina (RD$ 2,500) – nombre por confirmar','pendiente-keratina-2500','',2500,false,120,false,90,false,true),
 ('tratamientos','[PENDIENTE] Servicio RD$ 2,500 + secado RD$ 500 – nombre por confirmar','pendiente-servicio-2500-secado',
   'Anotado como RD$ 2,500 + secado RD$ 500 = RD$ 3,000',3000,false,150,false,91,false,true)
) as v(cat, name, slug, descr, price, price_from, dur, featured, ord, active, pending)
join c on c.slug = v.cat
on conflict (slug) do nothing;

-- Variantes de largo para Lavado y Secado
insert into public.service_variants (service_id, name, price, duration_minutes, display_order)
select s.id, v.name, v.price, v.dur, v.ord from public.services s,
 (values ('Pelo corto',600,40,1),('Pelo medio',700,45,2),('Pelo largo',900,55,3),('Pelo extra largo',1000,65,4)) as v(name,price,dur,ord)
where s.slug = 'lavado-y-secado'
  and not exists (select 1 from public.service_variants x where x.service_id = s.id);

-- Complemento de línea profesional para Tinte
insert into public.service_addons (service_id, name, price, duration_minutes)
select s.id, 'Línea profesional', 1500, 0 from public.services s
where s.slug = 'tinte'
  and not exists (select 1 from public.service_addons x where x.service_id = s.id);

-- Ajustes del negocio (editar en /admin/settings)
insert into public.business_settings (key, value, is_public) values
  ('business', '{"name":"Glow Beauty Center","phone":"","whatsapp":"","instagram":"","address":"","maps_url":"","email":"","tagline":"Tu momento. Tu belleza. Tu Glow."}', true),
  ('hours', '{"0":null,"1":{"open":"09:00","close":"18:00"},"2":{"open":"09:00","close":"18:00"},"3":{"open":"09:00","close":"18:00"},"4":{"open":"09:00","close":"18:00"},"5":{"open":"09:00","close":"18:00"},"6":{"open":"09:00","close":"16:00"}}', true),
  ('booking', '{"min_notice_hours":3,"max_advance_days":60,"slot_minutes":15,"cancellation_policy":"Cancelaciones con al menos 4 horas de anticipación."}', true),
  ('locale', '{"currency":"DOP","locale":"es-DO","timezone":"America/Santo_Domingo"}', true),
  ('policies', '{"text":""}', true)
on conflict (key) do nothing;
