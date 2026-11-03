-- 0006_storage: private bucket for medical documents.
-- No storage.objects policy is created for end users on purpose: files are written and read ONLY by the web
-- server (service role), after it validated the bytes (type, size, magic number) and checked the caller's
-- patient access through RLS. Files are served through short-lived signed URLs, never public URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('medical-documents', 'medical-documents', false, 20971520,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
