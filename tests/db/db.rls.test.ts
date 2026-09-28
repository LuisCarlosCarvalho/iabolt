// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Executa as migrações reais num Postgres (PGlite, WASM) e prova a RLS com dois
 * utilizadores. O schema `auth`/`storage` do Supabase é substituído por um mínimo
 * equivalente (auth.uid() lê o claim `sub`, como no Supabase).
 * Não substitui o teste contra o projeto Supabase real (docs/06).
 */
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
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
`;

const USER_A = '00000000-0000-4000-8000-00000000000a';
const USER_B = '00000000-0000-4000-8000-00000000000b';
const DATA = (label: string) => JSON.stringify({ pages: [{ frames: [{ component: { type: 'wrapper', attributes: { id: 'root' }, components: [{ type: 'text', content: label }] } }] }] });

let db: PGlite;

async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? '']);
  await db.exec(user ? 'set role authenticated' : 'set role anon');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}

async function createProject(key: string, label: string, workspace: string | null = null): Promise<{ id: string; current_revision: number; workspace_id: string }> {
  const res = await db.query<{ id: string; current_revision: number; workspace_id: string }>(
    `select id, current_revision, workspace_id from public.create_project($1, $2, 'nimbus', 1, 'grapesjs', '0.23.6', $3::jsonb, $4)`,
    [key, `Projeto ${label}`, DATA(label), workspace],
  );
  const row = res.rows[0];
  if (!row) throw new Error('create_project não devolveu linha');
  return row;
}

async function save(projectId: string, base: number, label: string): Promise<{ status: string; revision: number }> {
  const res = await db.query<{ status: string; revision: number }>(`select * from public.save_project($1, $2, $3::jsonb)`, [projectId, base, DATA(label)]);
  const row = res.rows[0];
  if (!row) throw new Error('save_project não devolveu linha');
  return row;
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUB);
  const dir = join(process.cwd(), 'supabase', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, file), 'utf8'));
  }
  await db.query(`insert into auth.users (id, email) values ($1, 'a@exemplo.pt'), ($2, 'b@exemplo.pt')`, [USER_A, USER_B]);
}, 60_000);

describe('Base de dados · migrações e RLS (PGlite)', () => {
  it('cada conta nova recebe um workspace pessoal como owner', async () => {
    const res = await db.query<{ n: number }>(`select count(*)::int as n from public.workspace_members where role = 'owner'`);
    expect(res.rows[0]?.n).toBe(2);
  });

  it('criar é idempotente e começa na revisão 0 com histórico', async () => {
    await as(USER_A, async () => {
      const a = await createProject('11111111-1111-4111-8111-111111111111', 'A1');
      const again = await createProject('11111111-1111-4111-8111-111111111111', 'A1');
      expect(again.id).toBe(a.id);
      expect(a.current_revision).toBe(0);
      const revs = await db.query<{ n: number }>(`select count(*)::int as n from public.project_revisions where project_id = $1`, [a.id]);
      expect(revs.rows[0]?.n).toBe(1);
    });
  });

  it('gravar exige a revisão atual: conflito não sobrescreve', async () => {
    await as(USER_A, async () => {
      const p = await createProject('22222222-2222-4222-8222-222222222222', 'A2');
      expect(await save(p.id, 0, 'v1')).toEqual({ status: 'saved', revision: 1 });
      expect(await save(p.id, 0, 'atrasada')).toEqual({ status: 'conflict', revision: 1 });
      const cur = await db.query<{ data: string }>(`select project_data::text as data from public.projects where id = $1`, [p.id]);
      expect(cur.rows[0]?.data).toContain('v1');
      expect(cur.rows[0]?.data).not.toContain('atrasada');
    });
  });

  it('o cliente não escreve o documento por fora das funções', async () => {
    await as(USER_A, async () => {
      const p = await createProject('33333333-3333-4333-8333-333333333333', 'A3');
      await expect(db.query(`update public.projects set project_data = '{}'::jsonb where id = $1`, [p.id])).rejects.toThrow(/permission denied/);
      await expect(db.query(`update public.projects set current_revision = 99 where id = $1`, [p.id])).rejects.toThrow(/permission denied/);
      await expect(
        db.query(`insert into public.project_revisions (project_id, revision, project_data, created_by) values ($1, 5, '{}'::jsonb, $2)`, [p.id, USER_A]),
      ).rejects.toThrow(/permission denied/);
      const renamed = await db.query(`update public.projects set name = 'Novo nome' where id = $1`, [p.id]);
      expect(renamed.affectedRows).toBe(1);
    });
  });

  it('documento inválido é recusado', async () => {
    await as(USER_A, async () => {
      await expect(
        db.query(`select * from public.create_project('44444444-4444-4444-8444-444444444444', 'x', null, 1, 'grapesjs', '0.23.6', '{"pages": []}'::jsonb)`),
      ).rejects.toThrow(/invalid_project_data/);
    });
  });

  it('outro utilizador não vê, não grava, não renomeia e não cria no workspace alheio', async () => {
    const aProject = await as(USER_A, () => createProject('55555555-5555-4555-8555-555555555555', 'privado'));
    await as(USER_B, async () => {
      const visible = await db.query<{ n: number }>(`select count(*)::int as n from public.projects`);
      expect(visible.rows[0]?.n).toBe(0);
      const revs = await db.query<{ n: number }>(`select count(*)::int as n from public.project_revisions`);
      expect(revs.rows[0]?.n).toBe(0);
      await expect(save(aProject.id, 0, 'intruso')).rejects.toThrow(/project_not_found/);
      const renamed = await db.query(`update public.projects set name = 'hack' where id = $1`, [aProject.id]);
      expect(renamed.affectedRows).toBe(0);
      await expect(createProject('66666666-6666-4666-8666-666666666666', 'intruso', aProject.workspace_id)).rejects.toThrow(/forbidden/);
    });
    await as(USER_A, async () => {
      const cur = await db.query<{ name: string; data: string }>(`select name, project_data::text as data from public.projects where id = $1`, [aProject.id]);
      expect(cur.rows[0]?.name).toBe('Projeto privado');
      expect(cur.rows[0]?.data).not.toContain('intruso');
    });
  });

  it('sem sessão (anon) não há acesso', async () => {
    await as(null, async () => {
      await expect(db.query(`select * from public.projects`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`select * from public.save_project('00000000-0000-4000-8000-000000000000', 0, '{}'::jsonb)`)).rejects.toThrow(/permission denied/);
    });
  });

  it('projeto arquivado deixa de aceitar gravações', async () => {
    await as(USER_A, async () => {
      const p = await createProject('77777777-7777-4777-8777-777777777777', 'arquivar');
      await db.query(`update public.projects set archived_at = now() where id = $1`, [p.id]);
      await expect(save(p.id, 0, 'depois')).rejects.toThrow(/project_not_found/);
    });
  });

  it('imagens: bucket privado; só membros leem e só editores escrevem na pasta do workspace', async () => {
    const bucket = await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'project-assets'`);
    expect(bucket.rows[0]?.public).toBe(false);
    const ws = await as(USER_A, async () => (await createProject('88888888-8888-4888-8888-888888888888', 'imgs')).workspace_id);
    await as(USER_A, async () => {
      const ok = await db.query(`insert into storage.objects (bucket_id, name) values ('project-assets', $1)`, [`${ws}/p/logo.png`]);
      expect(ok.affectedRows).toBe(1);
      const own = await db.query(`select name from storage.objects where bucket_id = 'project-assets'`);
      expect(own.rows).toHaveLength(1);
      // Caminho sem workspace válido: recusado sem erro interno.
      await expect(db.query(`insert into storage.objects (bucket_id, name) values ('project-assets', 'sem-uuid/x.png')`)).rejects.toThrow(/row-level security/);
    });
    await as(USER_B, async () => {
      await expect(db.query(`insert into storage.objects (bucket_id, name) values ('project-assets', $1)`, [`${ws}/p/intruso.png`])).rejects.toThrow(/row-level security/);
      const visible = await db.query(`select name from storage.objects where bucket_id = 'project-assets'`);
      expect(visible.rows).toHaveLength(0);
      const del = await db.query(`delete from storage.objects where bucket_id = 'project-assets'`);
      expect(del.affectedRows).toBe(0);
    });
  });
});
