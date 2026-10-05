-- Límites de subida: solo imágenes, máx. 5 MB
update storage.buckets
set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp','image/avif']
where id in ('service-images','gallery','employee-avatars');
update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['application/pdf','image/jpeg','image/png'] where id = 'receipts';
