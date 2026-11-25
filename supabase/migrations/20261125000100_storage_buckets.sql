-- Private storage buckets. Originals and generated outputs are kept in separate buckets.
-- No storage policies are created for anon/authenticated: files are only served through the
-- app's /api/assets route (which checks access) or short-lived signed URLs created server-side.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('source-documents',     'source-documents',     false, 209715200, array['application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'image/jpeg', 'image/png', 'image/webp']),
  ('reference-images',     'reference-images',     false, 52428800,  array['image/jpeg', 'image/png', 'image/webp']),
  ('reference-thumbnails', 'reference-thumbnails', false, 5242880,   array['image/webp']),
  ('floor-plans',          'floor-plans',          false, 52428800,  null),
  ('generated-images',     'generated-images',     false, 52428800,  array['image/jpeg', 'image/png', 'image/webp']),
  ('supporting-assets',    'supporting-assets',    false, 52428800,  null)
on conflict (id) do nothing;
