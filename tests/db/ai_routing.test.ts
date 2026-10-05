// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { SUPABASE_STUB } from './supabaseStub';

/**
 * Fornecedores ATIVOS e escolha automática do melhor por função (migração 20261005120000), num
 * Postgres local (PGlite) com as migrações reais e o Vault simulado. Parte do estado de PRODUÇÃO
 * antes desta migração (chave Anthropic, assistente ativo) e verifica que se mantém.
 */
const NEW = '20261005120000_ia_fornecedores_ativos.sql';
const ADMIN = '00000000-0000-4000-8000-00000000ad01';
const USER = '00000000-0000-4000-8000-00000000c001';
let db: PGlite;

async function service<T>(sql: string, params: unknown[] = []) {
  await db.exec('set role service_role');
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec('reset role');
  }
}

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const keys = Object.keys(args);
  const r = await service<{ r: unknown }>(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, Object.values(args));
  return r.rows[0]?.r;
}

async function setKey(provider: string, key: string) {
  const id = await rpc('ai_admin_stage_key_v2', { p_actor: ADMIN, p_provider: provider, p_key: key, p_last4: key.slice(-4), p_fingerprint: 'fp' });
  await rpc('ai_admin_activate_key_v2', { p_actor: ADMIN, p_provider: provider, p_secret_id: id });
}

const settings = async () =>
  (await db.query<{ enabled: boolean; provider: string; model: string; image_enabled: boolean; image_provider: string | null; image_model: string | null }>(
    'select enabled, provider, model, image_enabled, image_provider, image_model from public.ai_settings where id = 1',
  )).rows[0];
const enabled = async () => Object.fromEntries((await db.query<{ provider: string; enabled: boolean }>('select provider, enabled from public.ai_provider_keys order by provider')).rows.map((r) => [r.provider, r.enabled]));
const setEnabled = (provider: string, on: boolean, actor = ADMIN) => rpc('ai_admin_set_provider_enabled_v2', { p_actor: actor, p_provider: provider, p_enabled: on });

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUB);
  const dir = join(process.cwd(), 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files.filter((x) => x < NEW)) await db.exec(readFileSync(join(dir, f), 'utf8'));
  await db.query(`insert into auth.users (id, email) values ($1, 'dono@exemplo.pt'), ($2, 'comum@exemplo.pt')`, [ADMIN, USER]);
  await db.query(`insert into public.platform_admins (user_id, note) values ($1, 'administrador inicial')`, [ADMIN]);
  // Estado de produção antes desta migração: chave Anthropic reconhecida e assistente ativo.
  await setKey('anthropic', 'sk-teste-anthropic-000000000000ANTH');
  const v = (await db.query<{ version: number }>('select version from public.ai_settings')).rows[0]?.version ?? 0;
  await rpc('ai_admin_update_v2', { p_actor: ADMIN, p_expected_version: v, p_patch: JSON.stringify({ enabled: true }) });
  await db.exec(readFileSync(join(dir, NEW), 'utf8'));
}, 60_000);

describe('Fornecedores ativos e escolha automática por função (PGlite)', () => {
  it('a migração mantém o que está em produção: Anthropic ativo, edição com o Claude Sonnet 5.5, imagens desligadas', async () => {
    expect(await enabled()).toEqual({ anthropic: true, google: false, openai: false });
    expect(await settings()).toMatchObject({ enabled: true, provider: 'anthropic', model: 'claude-sonnet-5-5', image_enabled: false });
    const view = (await rpc('ai_admin_get_v2', { p_actor: ADMIN })) as { settings: { keys: Record<string, { enabled: boolean }> }; models: Array<{ model: string; preference: number | null }> };
    expect(view.settings.keys.anthropic?.enabled).toBe(true);
    expect(view.models.find((m) => m.model === 'claude-sonnet-5-5')?.preference).toBe(10);
  });

  it('chave noutro fornecedor com o Claude configurado; ativar a Google liga as imagens sem tirar a edição ao Claude', async () => {
    await setKey('google', 'AIza-teste-google-00000000000000GOOG');
    expect(await enabled()).toMatchObject({ google: false }); // guardar a chave não ativa sozinho
    expect(await settings()).toMatchObject({ image_enabled: false });
    await setEnabled('google', true);
    expect(await settings()).toMatchObject({ enabled: true, provider: 'anthropic', model: 'claude-sonnet-5-5', image_enabled: true, image_provider: 'google', image_model: 'gemini-3.1-flash-image' });
    // As funções leem a mesma configuração de sempre.
    const rt = (await service<{ r: Record<string, unknown> }>('select public.ai_runtime_settings() as r')).rows[0]?.r;
    expect(rt).toMatchObject({ enabled: true, provider: 'anthropic', image_enabled: true, image_provider: 'google', image_key_status: 'valid' });
  });

  it('desativar o Claude passa a edição para o melhor ativo seguinte; reativar volta ao Claude', async () => {
    await setEnabled('anthropic', false);
    expect(await settings()).toMatchObject({ enabled: true, provider: 'google', model: 'gemini-3.8-flash', image_enabled: true });
    await setKey('openai', 'sk-teste-openai-0000000000000000OPEN');
    await setEnabled('openai', true);
    expect(await settings()).toMatchObject({ provider: 'openai', model: 'gpt-6.1-sol' });
    await setEnabled('anthropic', true);
    expect(await settings()).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
  });

  it('chave recusada ou removida tira o fornecedor da escolha; sem nenhum ativo, a função fica desligada', async () => {
    await rpc('ai_admin_record_test_v2', { p_actor: ADMIN, p_provider: 'google', p_ok: false, p_detail: 'recusada' });
    expect(await settings()).toMatchObject({ provider: 'anthropic', image_enabled: false });
    const v = (await db.query<{ version: number }>('select version from public.ai_settings')).rows[0]?.version ?? 0;
    await rpc('ai_admin_remove_key_v2', { p_actor: ADMIN, p_provider: 'anthropic', p_expected_version: v });
    expect(await settings()).toMatchObject({ enabled: true, provider: 'openai', model: 'gpt-6.1-sol' });
    await setEnabled('openai', false);
    expect(await settings()).toMatchObject({ enabled: false, image_enabled: false });
  });

  it('só se ativa com a chave reconhecida; só administradores; tudo fica na auditoria', async () => {
    await expect(setEnabled('google', true)).rejects.toThrow(/key_not_valid/); // recusada no teste anterior
    await expect(setEnabled('anthropic', true)).rejects.toThrow(/key_not_valid/); // removida
    await expect(setEnabled('openai', true, USER)).rejects.toThrow(/not_admin/);
    const audit = (await db.query<{ action: string }>(`select action from public.ai_settings_audit where action like 'provider_%' order by id`)).rows.map((r) => r.action);
    expect(audit).toContain('provider_enabled');
    expect(audit).toContain('provider_disabled');
    // Um utilizador comum não chama a função.
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [USER]);
    await db.exec('set role authenticated');
    try {
      await expect(db.query(`select public.ai_admin_set_provider_enabled_v2('${USER}', 'openai', true)`)).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec('reset role');
    }
  });

  it('painel anterior (ação «update»): ligar a edição marca o fornecedor como ativo e a escolha automática mantém-no', async () => {
    const v = (await db.query<{ version: number }>('select version from public.ai_settings')).rows[0]?.version ?? 0;
    await rpc('ai_admin_update_v2', { p_actor: ADMIN, p_expected_version: v, p_patch: JSON.stringify({ provider: 'openai', model: 'gpt-6.1-sol', enabled: true }) });
    expect(await enabled()).toMatchObject({ openai: true });
    expect(await settings()).toMatchObject({ enabled: true, provider: 'openai', model: 'gpt-6.1-sol' });
    // Uma mudança de chave seguinte não o desliga.
    await rpc('ai_admin_record_test_v2', { p_actor: ADMIN, p_provider: 'openai', p_ok: true, p_detail: 'aceite' });
    expect(await settings()).toMatchObject({ enabled: true, provider: 'openai' });
  });
});
