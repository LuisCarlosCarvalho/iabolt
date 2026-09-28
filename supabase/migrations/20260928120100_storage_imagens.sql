-- Bolt IA · imagens dos projetos no Supabase Storage.
-- Caminho: <workspace_id>/<project_id>/<ficheiro>. Escrita só para editores do workspace.
-- Leitura pública por URL: as imagens aparecem nas páginas publicadas. Não guardar aqui
-- conteúdo privado. SVG excluído: num bucket público pode transportar scripts.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-assets',
  'project-assets',
  true,
  8388608,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do nothing;

create policy project_assets_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-assets'
    and public.is_workspace_member(((storage.foldername(name))[1])::uuid, array['owner', 'editor'])
  );

create policy project_assets_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'project-assets'
    and public.is_workspace_member(((storage.foldername(name))[1])::uuid, array['owner', 'editor'])
  );

create policy project_assets_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-assets'
    and public.is_workspace_member(((storage.foldername(name))[1])::uuid, array['owner', 'editor'])
  );
