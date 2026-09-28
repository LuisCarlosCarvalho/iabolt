-- Bolt IA · imagens dos projetos no Supabase Storage.
-- Bucket PRIVADO. Caminho: <workspace_id>/<project_id>/<ficheiro>.
-- Ler (e obter URLs assinados): membros do workspace. Escrever/substituir/apagar: owner e editor.
-- O documento guarda `bolt-asset:<caminho>`; o editor pede URLs assinados temporários para mostrar.
-- A publicação (fase 5) copiará as imagens usadas para um destino público.
-- SVG excluído: pode transportar scripts.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-assets',
  'project-assets',
  false,
  8388608,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- O primeiro segmento do caminho tem de ser um UUID; outro formato é simplesmente recusado.
create or replace function public.asset_workspace(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return ((storage.foldername(p_name))[1])::uuid;
exception when others then
  return null;
end;
$$;

grant execute on function public.asset_workspace(text) to authenticated;

create policy project_assets_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-assets'
    and public.is_workspace_member(public.asset_workspace(name))
  );

create policy project_assets_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-assets'
    and public.is_workspace_member(public.asset_workspace(name), array['owner', 'editor'])
  );

create policy project_assets_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'project-assets'
    and public.is_workspace_member(public.asset_workspace(name), array['owner', 'editor'])
  )
  with check (
    bucket_id = 'project-assets'
    and public.is_workspace_member(public.asset_workspace(name), array['owner', 'editor'])
  );

create policy project_assets_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-assets'
    and public.is_workspace_member(public.asset_workspace(name), array['owner', 'editor'])
  );
