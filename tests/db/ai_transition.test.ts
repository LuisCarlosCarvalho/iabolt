// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AdminDeps } from '../../supabase/functions/_shared/ai/admin.ts';
import { AdminView as AdminViewV1, type AdminDeps as AdminDepsV1 } from '../../supabase/functions/_shared/ai/adminV1.ts';
import { handleAdminAny } from '../../supabase/functions/_shared/ai/compatV1.ts';
import { SUPABASE_STUB } from './supabaseStub';

/**
 * TRANSIÇÃO sem quebra (PGlite, migrações reais, Vault simulado): depois da migração 20261001120000,
 *  1. as funções SQL que as funções JÁ PUBLICADAS usam (nomes, argumentos e formato v1) continuam a
 *     funcionar, e o painel v1 (lógica congelada adminV1.ts, igual à do frontend em produção) faz o
 *     ciclo completo da chave Anthropic;
 *  2. o painel v2 (pedidos com api: 2) funciona sobre o mesmo estado;
 *  3. o que um faz, o outro vê (uma só fonte: ai_provider_keys).
 * O fornecedor é simulado (checkKey); nada sai para a rede.
 */
const NEW = '20261001120000_ia_fornecedores.sql';
const ADMIN = '00000000-0000-4000-8000-00000000ad01';
const USER = '00000000-0000-4000-8000-00000000c001';
const KEY_OLD = 'sk-teste-chave-existente-000000000EXST';
const KEY_V1 = 'sk-teste-chave-pelo-painel-v1-00000V1V1';
const KEY_G = 'AIza-teste-chave-google-pelo-v2-0000GGGG';
let db: PGlite;

async function service<T>(sql: string, params: unknown[] = []) {
  await db.exec('set role service_role');
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec('reset role');
  }
}

/** Chama uma função SQL pelo papel de serviço, como as funções Edge (argumentos com nome). */
async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const keys = Object.keys(args);
  const r = await service<{ r: unknown }>(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, Object.values(args));
  return r.rows[0]?.r;
}

const common = { getUser: async (h: string | null) => (h === 'Bearer admin' ? { id: ADMIN } : h === 'Bearer comum' ? { id: USER } : null), isAdmin: async (id: string) => id === ADMIN };

/** As mesmas chamadas que a função ai-admin publicada (v1) faz. */
const v1: AdminDepsV1 = {
  ...common,
  get: (actor) => rpc('ai_admin_get', { p_actor: actor }),
  update: (actor, version, patch) => rpc('ai_admin_update', { p_actor: actor, p_expected_version: version, p_patch: JSON.stringify(patch) }),
  stageKey: async (actor, key, last4, fp) => String(await rpc('ai_admin_stage_key', { p_actor: actor, p_key: key, p_last4: last4, p_fingerprint: fp })),
  activateKey: (actor, id) => rpc('ai_admin_activate_key', { p_actor: actor, p_secret_id: id }),
  discardKey: async (actor, id, reason) => {
    await rpc('ai_admin_discard_key', { p_actor: actor, p_secret_id: id, p_reason: reason });
  },
  removeKey: (actor, version) => rpc('ai_admin_remove_key', { p_actor: actor, p_expected_version: version }),
  recordTest: (actor, ok, detail) => rpc('ai_admin_record_test', { p_actor: actor, p_ok: ok, p_detail: detail }),
  providerKey: async () => {
    const k = await service<{ k: string | null }>('select public.ai_provider_key() as k');
    return k.rows[0]?.k ?? null;
  },
  checkKey: async (_p, _m, key) => (key.includes('invalida') ? { ok: false, definitive: true, reason: 'O fornecedor recusou a chave.' } : { ok: true }),
  usage: (actor) => rpc('ai_admin_usage', { p_actor: actor }),
  audit: (actor) => rpc('ai_admin_audit', { p_actor: actor, p_limit: 50 }),
};

/** As chamadas da função ai-admin nova (v2). */
const v2: AdminDeps = {
  ...common,
  get: (actor) => rpc('ai_admin_get_v2', { p_actor: actor }),
  update: (actor, version, patch) => rpc('ai_admin_update_v2', { p_actor: actor, p_expected_version: version, p_patch: JSON.stringify(patch) }),
  stageKey: async (actor, provider, key, last4, fp) => String(await rpc('ai_admin_stage_key_v2', { p_actor: actor, p_provider: provider, p_key: key, p_last4: last4, p_fingerprint: fp })),
  activateKey: (actor, provider, id) => rpc('ai_admin_activate_key_v2', { p_actor: actor, p_provider: provider, p_secret_id: id }),
  discardKey: async (actor, provider, id, reason) => {
    await rpc('ai_admin_discard_key_v2', { p_actor: actor, p_provider: provider, p_secret_id: id, p_reason: reason });
  },
  removeKey: (actor, provider, version) => rpc('ai_admin_remove_key_v2', { p_actor: actor, p_provider: provider, p_expected_version: version }),
  recordTest: (actor, provider, ok, detail) => rpc('ai_admin_record_test_v2', { p_actor: actor, p_provider: provider, p_ok: ok, p_detail: detail }),
  providerKey: async (provider) => {
    const k = await service<{ k: string | null }>('select public.ai_provider_key_for($1) as k', [provider]);
    return k.rows[0]?.k ?? null;
  },
  checkKey: async () => ({ ok: true, formatChecked: false }),
  usage: (actor) => rpc('ai_admin_usage', { p_actor: actor }),
  generation: (actor) => rpc('ai_admin_generation', { p_actor: actor }),
  audit: (actor) => rpc('ai_admin_audit', { p_actor: actor, p_limit: 50 }),
};

const sendV1 = (req: Record<string, unknown>) => handleAdminAny('Bearer admin', JSON.stringify(req), v2, v1);
const sendV2 = (command: Record<string, unknown>) => handleAdminAny('Bearer admin', JSON.stringify({ api: 2, command }), v2, v1);
const viewV1 = (body: unknown) => AdminViewV1.parse(z.object({ view: z.unknown() }).parse(body).view);

/** Configuração em tempo de execução tal como a função ai-propose PUBLICADA a lê (esquema v1). */
const RuntimeV1 = z.object({
  enabled: z.boolean(),
  provider: z.enum(['anthropic']),
  model: z.string(),
  model_label: z.string(),
  key_status: z.enum(['none', 'valid', 'invalid']),
  max_output_tokens: z.coerce.number(),
  max_operations: z.coerce.number(),
  prices: z.object({ input: z.coerce.number(), output: z.coerce.number(), cacheRead: z.coerce.number(), cacheWrite: z.coerce.number() }),
});

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUB);
  const dir = join(process.cwd(), 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files.filter((x) => x < NEW)) await db.exec(readFileSync(join(dir, f), 'utf8'));
  await db.query(`insert into auth.users (id, email) values ($1, 'dono@exemplo.pt'), ($2, 'comum@exemplo.pt')`, [ADMIN, USER]);
  await db.query(`insert into public.platform_admins (user_id, note) values ($1, 'administrador inicial')`, [ADMIN]);
  // Estado de produção: chave Anthropic e assistente ativo (API v1).
  const id = await rpc('ai_admin_stage_key', { p_actor: ADMIN, p_key: KEY_OLD, p_last4: 'EXST', p_fingerprint: 'fp' });
  await rpc('ai_admin_activate_key', { p_actor: ADMIN, p_secret_id: id });
  const v = (await db.query<{ version: number }>('select version from public.ai_settings')).rows[0]?.version ?? 0;
  await rpc('ai_admin_update', { p_actor: ADMIN, p_expected_version: v, p_patch: JSON.stringify({ enabled: true, monthly_budget_usd: 30, requests_per_user_day: 40 }) });
  await db.exec(readFileSync(join(dir, NEW), 'utf8'));
}, 60_000);

describe('Transição para vários fornecedores, sem quebra (PGlite)', () => {
  it('funções publicadas (v1): configuração em tempo de execução, chave e estado legíveis como antes', async () => {
    const rt = RuntimeV1.parse((await service<{ r: unknown }>('select public.ai_runtime_settings() as r')).rows[0]?.r);
    expect(rt).toMatchObject({ enabled: true, provider: 'anthropic', model: 'claude-sonnet-5-5', key_status: 'valid' });
    expect((await service<{ k: string }>('select public.ai_provider_key() as k')).rows[0]?.k).toBe(KEY_OLD);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [USER]);
    await db.exec('set role authenticated');
    try {
      const st = (await db.query<Record<string, unknown>>('select * from public.ai_status()')).rows[0];
      expect(st).toEqual({ enabled: true, provider: 'anthropic', model: 'claude-sonnet-5-5', model_label: 'Claude Sonnet 5.5' });
    } finally {
      await db.exec('reset role');
    }
  });

  it('painel v1 (em produção) funciona sobre o armazenamento novo: ver, limites, substituir, recusar, testar', async () => {
    const got = await sendV1({ action: 'get' });
    expect(got.status).toBe(200);
    const view = viewV1(got.body);
    expect(view.settings).toMatchObject({ enabled: true, monthly_budget_usd: 30, requests_per_user_day: 40, key: { configured: true, last4: 'EXST', status: 'valid' } });
    // Só os modelos que o painel v1 conhece (Anthropic de edição).
    expect(view.models.every((m) => m.provider === 'anthropic')).toBe(true);
    const upd = await sendV1({ action: 'update', expectedVersion: view.settings.version, patch: { monthly_budget_usd: 35 } });
    expect(viewV1(upd.body).settings.monthly_budget_usd).toBe(35);
    const bad = await sendV1({ action: 'setKey', key: 'sk-teste-chave-invalida-0000000000XXXX' });
    expect(bad.status).toBe(422);
    expect(viewV1(bad.body).settings.key.last4).toBe('EXST');
    const set = await sendV1({ action: 'setKey', key: KEY_V1 });
    expect(set.status).toBe(200);
    expect(viewV1(set.body).settings.key).toMatchObject({ last4: 'V1V1', status: 'valid' });
    expect((await sendV1({ action: 'test' })).status).toBe(200);
    expect((await sendV1({ action: 'usage' })).status).toBe(200);
    expect(JSON.stringify(await sendV1({ action: 'audit' }))).not.toContain(KEY_V1);
    expect((await service<{ k: string }>(`select public.ai_provider_key_for('anthropic') as k`)).rows[0]?.k).toBe(KEY_V1);
    // Utilizador comum: recusado nos dois caminhos.
    expect((await handleAdminAny('Bearer comum', JSON.stringify({ action: 'get' }), v2, v1)).status).toBe(403);
    expect((await handleAdminAny('Bearer comum', JSON.stringify({ api: 2, command: { action: 'get' } }), v2, v1)).status).toBe(403);
  });

  it('painel v2 sobre o mesmo estado: vê a chave posta pelo v1, acrescenta Google sem tocar na Anthropic; o v1 continua coerente', async () => {
    const got = await sendV2({ action: 'get' });
    expect(got.status).toBe(200);
    expect(JSON.stringify(got.body)).toContain('"last4":"V1V1"');
    const g = await sendV2({ action: 'setKey', provider: 'google', key: KEY_G });
    expect(g.status).toBe(200);
    expect((await service<{ k: string }>(`select public.ai_provider_key_for('anthropic') as k`)).rows[0]?.k).toBe(KEY_V1);
    expect((await service<{ k: string }>(`select public.ai_provider_key_for('google') as k`)).rows[0]?.k).toBe(KEY_G);
    // O v1 continua a ver só a Anthropic, ativa.
    const v1view = viewV1((await sendV1({ action: 'get' })).body);
    expect(v1view.settings).toMatchObject({ enabled: true, provider: 'anthropic', key: { last4: 'V1V1', status: 'valid' } });
    // O consumo/limites definidos antes mantêm-se.
    expect(v1view.settings).toMatchObject({ monthly_budget_usd: 35, requests_per_user_day: 40 });
    const secrets = (await db.query<{ n: number }>('select count(*)::int as n from vault.secrets')).rows[0]?.n;
    // A chave original (EXST) saiu do cofre quando o v1 a substituiu (como antes); ficam V1V1 e Google.
    expect(secrets).toBe(2);
  });
});
