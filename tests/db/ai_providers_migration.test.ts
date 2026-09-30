// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { SUPABASE_STUB } from './supabaseStub';

/**
 * Migração 20261001120000 (vários fornecedores) sobre uma configuração EXISTENTE, como a do projeto
 * Supabase: as migrações anteriores já aplicadas, uma chave Anthropic configurada pela API antiga,
 * o assistente ativo e consumo registado. Prova que a chave e a configuração se preservam.
 * Vault simulado (sem cifra; ver supabaseStub).
 */
const NEW = '20261001120000_ia_fornecedores.sql';
const ADMIN = '00000000-0000-4000-8000-00000000ad01';
const KEY = 'sk-teste-chave-existente-000000000EXST';
let db: PGlite;
let secretBefore = '';
let wsId = '';

async function service<T>(sql: string, params: unknown[] = []) {
  await db.exec('set role service_role');
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec('reset role');
  }
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUB);
  const dir = join(process.cwd(), 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  expect(files).toContain(NEW);
  // 1. Estado atual do projeto: só as migrações anteriores.
  for (const f of files.filter((x) => x < NEW)) await db.exec(readFileSync(join(dir, f), 'utf8'));
  await db.query(`insert into auth.users (id, email) values ($1, 'dono@exemplo.pt')`, [ADMIN]);
  await db.query(`insert into public.platform_admins (user_id, note) values ($1, 'administrador inicial')`, [ADMIN]);
  wsId = (await db.query<{ workspace_id: string }>('select workspace_id from public.workspace_members where user_id = $1', [ADMIN])).rows[0]?.workspace_id ?? '';
  // Chave e ativação pela API ANTIGA (assinaturas de 20260930120000).
  const staged = await service<{ ai_admin_stage_key: string }>(`select public.ai_admin_stage_key($1, $2, 'EXST', 'fp-existente')`, [ADMIN, KEY]);
  await service('select public.ai_admin_activate_key($1, $2)', [ADMIN, staged.rows[0]?.ai_admin_stage_key]);
  const v = (await db.query<{ version: number }>('select version from public.ai_settings')).rows[0]?.version ?? 0;
  await service(`select public.ai_admin_update($1, $2, '{"enabled": true, "monthly_budget_usd": 30}'::jsonb)`, [ADMIN, v]);
  const r = await service<{ reservation_id: string }>(`select * from public.ai_reserve($1, $2, $3, null, 0.02, 'claude-sonnet-5-5', '{}'::jsonb)`, [crypto.randomUUID(), ADMIN, wsId]);
  await service(`select public.ai_settle($1, 'done', 100, 20, 0, 0, 0.001, 0, 1, 0, 800, null)`, [r.rows[0]?.reservation_id]);
  secretBefore = (await db.query<{ key_secret_id: string }>('select key_secret_id from public.ai_settings')).rows[0]?.key_secret_id ?? '';
  expect(secretBefore).not.toBe('');
  // 2. A migração nova.
  await db.exec(readFileSync(join(dir, NEW), 'utf8'));
}, 60_000);

describe('Migração de fornecedores sobre a configuração existente (PGlite)', () => {
  it('a chave Anthropic é o MESMO segredo do cofre (nada decifrado nem recriado); as outras começam vazias', async () => {
    const keys = (await db.query<{ provider: string; key_secret_id: string | null; key_last4: string | null; key_status: string }>('select provider, key_secret_id, key_last4, key_status from public.ai_provider_keys order by provider')).rows;
    expect(keys).toEqual([
      { provider: 'anthropic', key_secret_id: secretBefore, key_last4: 'EXST', key_status: 'valid' },
      { provider: 'google', key_secret_id: null, key_last4: null, key_status: 'none' },
      { provider: 'openai', key_secret_id: null, key_last4: null, key_status: 'none' },
    ]);
    expect((await db.query('select id from vault.secrets')).rows).toHaveLength(1);
    expect((await service<{ k: string }>(`select public.ai_provider_key_for('anthropic') as k`)).rows[0]?.k).toBe(KEY);
    // Compatibilidade com as funções publicadas antes da migração.
    expect((await service<{ k: string }>('select public.ai_provider_key() as k')).rows[0]?.k).toBe(KEY);
  });

  it('a configuração mantém-se (ativo, modelo, orçamento) e o estado público continua ativo', async () => {
    const s = (await db.query<{ enabled: boolean; provider: string; model: string; monthly_budget_usd: string; image_enabled: boolean }>('select enabled, provider, model, monthly_budget_usd, image_enabled from public.ai_settings')).rows[0];
    expect(s).toMatchObject({ enabled: true, provider: 'anthropic', model: 'claude-sonnet-5-5', image_enabled: false });
    expect(Number(s?.monthly_budget_usd)).toBe(30);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ADMIN]);
    await db.exec('set role authenticated');
    try {
      expect((await db.query<{ enabled: boolean; model_label: string }>('select enabled, model_label from public.ai_status()')).rows[0]).toEqual({ enabled: true, model_label: 'Claude Sonnet 5.5' });
    } finally {
      await db.exec('reset role');
    }
    // As colunas da chave única NÃO são apagadas: ficam congeladas com o valor anterior (reversão possível).
    const frozen = (await db.query<{ key_secret_id: string; key_last4: string }>('select key_secret_id, key_last4 from public.ai_settings')).rows[0];
    expect(frozen).toEqual({ key_secret_id: secretBefore, key_last4: 'EXST' });
    // O estado e a configuração em tempo de execução não expõem as colunas congeladas.
    const rt = (await service<{ ai_runtime_settings: Record<string, unknown> }>('select public.ai_runtime_settings()')).rows[0]?.ai_runtime_settings ?? {};
    expect(Object.keys(rt).filter((k) => /secret|last4|fingerprint|pending/.test(k))).toEqual([]);
    expect(rt.key_status).toBe('valid');
  });

  it('o consumo existente fica atribuído à Anthropic; a reserva antiga continua a funcionar (edição)', async () => {
    expect((await db.query<{ provider: string; kind: string }>('select provider, kind from public.ai_usage')).rows).toEqual([{ provider: 'anthropic', kind: 'edit' }]);
    const r = await service<{ reservation_id: string | null; reason: string | null }>(`select * from public.ai_reserve($1, $2, $3, null, 0.02, 'claude-sonnet-5-5', '{}'::jsonb)`, [crypto.randomUUID(), ADMIN, wsId]);
    expect(r.rows[0]?.reason).toBeNull();
    const row = (await db.query<{ provider: string; kind: string }>('select provider, kind from public.ai_usage where id = $1', [r.rows[0]?.reservation_id])).rows[0];
    expect(row).toEqual({ provider: 'anthropic', kind: 'edit' });
  });
});
