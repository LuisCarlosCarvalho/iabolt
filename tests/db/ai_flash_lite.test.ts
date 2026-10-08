// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { SUPABASE_STUB } from './supabaseStub';

/**
 * Gemini 3.5 Flash-Lite como modelo de edição da Google (migração 20261008130000), em PGlite com as
 * migrações reais. Parte do estado de PRODUÇÃO a 08/10/2026 (Google ativa com o 3.8 Flash; imagens
 * na Cloudflare) e verifica que a edição passa ao Flash-Lite sem mexer nas imagens.
 */
const NEW = '20261008130000_ia_flash_lite_edicao.sql';
const ADMIN = '00000000-0000-4000-8000-00000000ad01';
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
  (await db.query<{ enabled: boolean; provider: string; model: string; image_provider: string | null }>('select enabled, provider, model, image_provider from public.ai_settings where id = 1')).rows[0];

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUB);
  const dir = join(process.cwd(), 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files.filter((x) => x < NEW)) await db.exec(readFileSync(join(dir, f), 'utf8'));
  await db.query(`insert into auth.users (id, email) values ($1, 'dono@exemplo.pt')`, [ADMIN]);
  await db.query(`insert into public.platform_admins (user_id, note) values ($1, 'administrador inicial')`, [ADMIN]);
  // Estado de produção a 08/10: Google ativa (edição 3.8 Flash) e imagens na Cloudflare.
  await setKey('google', 'AIza-teste-google-00000000000000GOOG');
  await setEnabled('google', true);
  await setKey('cloudflare', '0123456789abcdef0123456789abcdef:token-de-teste-cloudflare-000CFTK');
  await setEnabled('cloudflare', true);
}, 60_000);

describe('Gemini 3.5 Flash-Lite na edição (PGlite)', () => {
  it('antes da migração: edição com o 3.8 Flash; depois: Flash-Lite, já aplicado; as imagens ficam na Cloudflare', async () => {
    expect(await settings()).toMatchObject({ enabled: true, provider: 'google', model: 'gemini-3.8-flash', image_provider: 'cloudflare' });
    await db.exec(readFileSync(join(process.cwd(), 'supabase', 'migrations', NEW), 'utf8'));
    expect(await settings()).toMatchObject({ enabled: true, provider: 'google', model: 'gemini-3.5-flash-lite', image_provider: 'cloudflare' });
    const rt = (await service<{ r: Record<string, unknown> }>('select public.ai_runtime_settings() as r')).rows[0]?.r;
    expect(rt).toMatchObject({ enabled: true, provider: 'google', model: 'gemini-3.5-flash-lite', key_status: 'valid' });
  });

  it('o Claude, se for ativado com chave reconhecida, continua à frente na edição', async () => {
    await setKey('anthropic', 'sk-teste-anthropic-000000000000ANTH');
    await setEnabled('anthropic', true);
    expect(await settings()).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5', image_provider: 'cloudflare' });
    await setEnabled('anthropic', false);
    expect(await settings()).toMatchObject({ provider: 'google', model: 'gemini-3.5-flash-lite' });
  });
});
