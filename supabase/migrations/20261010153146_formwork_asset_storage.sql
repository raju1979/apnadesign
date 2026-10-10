insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'formwork-assets',
  'formwork-assets',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy formwork_assets_project_read
on storage.objects for select to authenticated
using (
  bucket_id = 'formwork-assets'
  and (select formwork_private.project_role((storage.foldername(name))[1])) is not null
);

create policy formwork_assets_editor_upload
on storage.objects for insert to authenticated
with check (
  bucket_id = 'formwork-assets'
  and (select formwork_private.project_role((storage.foldername(name))[1])) in ('owner', 'editor')
);
