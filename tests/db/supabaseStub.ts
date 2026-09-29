/**
 * Mínimo equivalente ao schema do Supabase (auth, storage e papéis) para correr as migrações reais
 * num Postgres local (PGlite). auth.uid() lê o claim `sub`, como no Supabase.
 */
export const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable
    as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant usage on schema storage to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
  -- Supabase Vault (simulado: SEM cifra; só a interface create_secret / decrypted_secrets e o
  -- acesso restrito). O cofre real cifra em repouso com uma chave fora da base de dados.
  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text, secret text not null);
  create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid
    language sql as $$ insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id $$;
  create view vault.decrypted_secrets as select id, name, description, secret as decrypted_secret from vault.secrets;
  revoke all on schema vault from public;
`;
