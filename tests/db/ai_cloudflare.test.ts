// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { SUPABASE_STUB } from './supabaseStub';

/**
 * Cloudflare Workers AI como fornecedor de imagens (migração 20261008120000), num Postgres local
 * (PGlite) com as migrações reais e o Vault simulado. Parte de um estado como o de PRODUÇÃO a
 * 08/10/2026 (Google ativa: edição e imagens) e verifica que nada muda até a Cloudflare ser
 * ativada, e que depois as imagens passam para ela sozinhas.
 */
const NEW = '20261008120000_ia_cloudflare.sql';
const ADMIN = '00000000-0000-4000-8000-00000000ad01';
const FLUX = '@cf/black-forest-labs/flux-1-schnell';
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
const setEnabled = (provider: string, on: boolean) => rpc('ai_admin_set_provider_enabled_v2', { p_actor: ADMIN, p_provider: provider, p_enabled: on });
const settings = async () =>
  (await db.query<{ enabled: boolean; provider: string; model: string; image_enabled: boolean; image_provider: string | null; image_model: string | null }>(
    'select enabled, provider, model, image_enabled, image_provider, image_model from public.ai_settings where id = 1',
  )).rows[0];

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUB);
  const dir = join(process.cwd(), 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files.filter((x) => x < NEW)) await db.exec(readFileSync(join(dir, f), 'utf8'));
  await db.query(`insert into auth.users (id, email) values ($1, 'dono@exemplo.pt')`, [ADMIN]);
  await db.query(`insert into public.platform_admins (user_id, note) values ($1, 'administrador inicial')`, [ADMIN]);
  // Estado como o de produção a 08/10: só a Google ativa (edição Gemini 3.8 Flash e imagens).
  await setKey('google', 'AIza-teste-google-00000000000000GOOG');
  await setEnabled('google', true);
  await db.exec(readFileSync(join(dir, NEW), 'utf8'));
}, 60_000);

describe('Cloudflare Workers AI: imagens automáticas (PGlite)', () => {
  it('a migração não muda nada em produção: Cloudflare sem chave e inativa; edição e imagens continuam na Google', async () => {
    expect(await settings()).toMatchObject({ enabled: true, provider: 'google', model: 'gemini-3.8-flash', image_enabled: true, image_provider: 'google', image_model: 'gemini-3.1-flash-image' });
    const view = (await rpc('ai_admin_get_v2', { p_actor: ADMIN })) as {
      settings: { keys: Record<string, { configured: boolean; enabled: boolean; status: string }> };
      models: Array<{ provider: string; model: string; capability: string; price_image: number | null; preference: number | null }>;
    };
    expect(view.settings.keys.cloudflare).toMatchObject({ configured: false, enabled: false, status: 'none' });
    const flux = view.models.find((m) => m.model === FLUX);
    expect(flux).toMatchObject({ provider: 'cloudflare', capability: 'image', preference: 1 });
    expect(Number(flux?.price_image)).toBe(0.001);
    // Só imagens: nenhum modelo de edição da Cloudflare.
    expect(view.models.filter((m) => m.provider === 'cloudflare').every((m) => m.capability === 'image')).toBe(true);
  });

  it('chave guardada e Cloudflare ativa: as imagens passam para o FLUX sozinhas; a edição fica na Google', async () => {
    await setKey('cloudflare', '0123456789abcdef0123456789abcdef:token-de-teste-cloudflare-000CFTK');
    await setEnabled('cloudflare', true);
    expect(await settings()).toMatchObject({ enabled: true, provider: 'google', model: 'gemini-3.8-flash', image_enabled: true, image_provider: 'cloudflare', image_model: FLUX });
    // A função ai-image lê a mesma configuração: fornecedor, chave reconhecida e teto por imagem.
    const rt = (await service<{ r: Record<string, unknown> }>('select public.ai_runtime_settings() as r')).rows[0]?.r;
    expect(rt).toMatchObject({ image_enabled: true, image_provider: 'cloudflare', image_model: FLUX, image_key_status: 'valid' });
    const prices: unknown = rt?.image_prices;
    expect(Number(prices && typeof prices === 'object' ? Reflect.get(prices, 'image') : null)).toBe(0.001);
    // A credencial fica no cofre e só o papel de serviço a lê.
    const key = await rpc('ai_provider_key_for', { p_provider: 'cloudflare' });
    expect(key).toBe('0123456789abcdef0123456789abcdef:token-de-teste-cloudflare-000CFTK');
  });

  it('Cloudflare desativada ou com a chave recusada: as imagens voltam ao Gemini, sem passo manual', async () => {
    await setEnabled('cloudflare', false);
    expect(await settings()).toMatchObject({ image_provider: 'google', image_model: 'gemini-3.1-flash-image' });
    await setEnabled('cloudflare', true);
    expect(await settings()).toMatchObject({ image_provider: 'cloudflare' });
    await rpc('ai_admin_record_test_v2', { p_actor: ADMIN, p_provider: 'cloudflare', p_ok: false, p_detail: 'recusada' });
    expect(await settings()).toMatchObject({ image_enabled: true, image_provider: 'google' });
  });
});
