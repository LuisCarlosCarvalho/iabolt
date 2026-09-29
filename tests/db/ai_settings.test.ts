// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { SUPABASE_STUB } from './supabaseStub';

/**
 * Configurações de IA: autorização administrativa e proteção da chave, com as migrações reais num
 * Postgres local (PGlite). O Vault é SIMULADO (sem cifra; ver supabaseStub): prova-se o acesso
 * restrito e o ciclo da chave, não a cifra, que só existe no Supabase.
 */
const ADMIN = '00000000-0000-4000-8000-00000000ad01';
const USER = '00000000-0000-4000-8000-00000000c001';
const EVIL = '00000000-0000-4000-8000-00000000e001'; // tem email admin@… e é owner do seu workspace
const KEY_1 = 'sk-teste-primeira-chave-0000000000AAAA';
const KEY_2 = 'sk-teste-segunda-chave-0000000000BBBB';
let db: PGlite;

async function as<T>(user: string, sql: string, params: unknown[] = []) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user]);
  await db.exec('set role authenticated');
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec('reset role');
  }
}

/** Como o papel de serviço (a função ai-admin), depois de ela identificar o utilizador. */
async function service<T>(sql: string, params: unknown[] = []) {
  await db.exec('set role service_role');
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec('reset role');
  }
}

const version = async () => (await db.query<{ version: number }>('select version from public.ai_settings')).rows[0]?.version ?? 0;
const dump = async () => JSON.stringify((await db.query('select * from public.ai_settings_audit')).rows) + JSON.stringify((await db.query('select * from public.ai_settings')).rows);

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUB);
  const dir = join(process.cwd(), 'supabase', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(join(dir, file), 'utf8'));
  await db.query(`insert into auth.users (id, email) values ($1, 'dono@exemplo.pt'), ($2, 'comum@exemplo.pt'), ($3, 'admin@exemplo.pt')`, [ADMIN, USER, EVIL]);
  // Primeira atribuição: feita fora da interface (SQL Editor), como documentado.
  await db.query(`insert into public.platform_admins (user_id, note) values ($1, 'administrador inicial')`, [ADMIN]);
}, 60_000);

describe('Configurações de IA · autorização (PGlite)', () => {
  it('por omissão: assistente desativado, sem chave, modelo suportado', async () => {
    const s = (await db.query<{ enabled: boolean; key_status: string; model: string }>('select enabled, key_status, model from public.ai_settings')).rows[0];
    expect(s).toEqual({ enabled: false, key_status: 'none', model: 'claude-sonnet-5-5' });
  });

  it('owner de workspace ou email admin@… não é administrador; ai_whoami só é verdadeiro para o administrador', async () => {
    expect((await as<{ ai_whoami: boolean }>(EVIL, 'select public.ai_whoami()')).rows[0]?.ai_whoami).toBe(false);
    expect((await as<{ ai_whoami: boolean }>(USER, 'select public.ai_whoami()')).rows[0]?.ai_whoami).toBe(false);
    expect((await as<{ ai_whoami: boolean }>(ADMIN, 'select public.ai_whoami()')).rows[0]?.ai_whoami).toBe(true);
  });

  it('utilizador comum: sem autoatribuição, sem leitura da configuração, sem funções administrativas', async () => {
    await expect(as(EVIL, `insert into public.platform_admins (user_id) values ('${EVIL}')`)).rejects.toThrow(/permission denied/);
    await expect(as(EVIL, 'select * from public.ai_settings')).rejects.toThrow(/permission denied/);
    await expect(as(EVIL, 'select * from public.ai_settings_audit')).rejects.toThrow(/permission denied/);
    await expect(as(EVIL, 'update public.ai_settings set enabled = true')).rejects.toThrow(/permission denied/);
    await expect(as(EVIL, 'select * from vault.decrypted_secrets')).rejects.toThrow(/permission denied/);
    for (const call of [
      `select public.ai_admin_get('${EVIL}')`,
      `select public.ai_admin_update('${EVIL}', 1, '{"enabled": true}'::jsonb)`,
      `select public.ai_admin_stage_key('${EVIL}', '${KEY_1}', 'AAAA', 'x')`,
      `select public.ai_admin_grant('${EVIL}', '${EVIL}')`,
      `select public.ai_provider_key()`,
      `select public.ai_runtime_settings()`,
      `select public.is_platform_admin('${ADMIN}')`,
    ]) {
      await expect(as(EVIL, call)).rejects.toThrow(/permission denied/);
    }
    // Só vê a própria linha de administração (nenhuma).
    expect((await as(EVIL, 'select * from public.platform_admins')).rows).toHaveLength(0);
    // Estado público sem segredos.
    const status = (await as<Record<string, unknown>>(USER, 'select * from public.ai_status()')).rows[0];
    expect(Object.keys(status ?? {}).sort()).toEqual(['enabled', 'model', 'model_label', 'provider']);
  });

  it('mesmo pelo papel de serviço, um ator que não é administrador é recusado', async () => {
    await expect(service(`select public.ai_admin_get($1)`, [USER])).rejects.toThrow(/not_admin/);
    await expect(service(`select public.ai_admin_update($1, 1, '{"monthly_budget_usd": 1}'::jsonb)`, [EVIL])).rejects.toThrow(/not_admin/);
    await expect(service(`select public.ai_admin_grant($1, $1)`, [EVIL])).rejects.toThrow(/not_admin/);
    // Nem o papel de serviço lê o cofre diretamente: só através de ai_provider_key().
    await expect(service('select * from vault.decrypted_secrets')).rejects.toThrow(/permission denied/);
  });
});

describe('Configurações de IA · chave, versões e auditoria (PGlite)', () => {
  it('não se ativa sem chave válida; campos desconhecidos e versão antiga recusados', async () => {
    await expect(service(`select public.ai_admin_update($1, $2, '{"enabled": true}'::jsonb)`, [ADMIN, await version()])).rejects.toThrow(/check constraint/);
    await expect(service(`select public.ai_admin_update($1, $2, '{"key_status": "valid"}'::jsonb)`, [ADMIN, await version()])).rejects.toThrow(/invalid_field/);
    await expect(service(`select public.ai_admin_update($1, 999, '{"monthly_budget_usd": 5}'::jsonb)`, [ADMIN])).rejects.toThrow(/version_conflict/);
    const r = await service<{ ai_admin_update: { settings: { monthly_budget_usd: number } } }>(`select public.ai_admin_update($1, $2, '{"monthly_budget_usd": 30}'::jsonb)`, [ADMIN, await version()]);
    expect(Number(r.rows[0]?.ai_admin_update.settings.monthly_budget_usd)).toBe(30);
  });

  it('chave: pendente → ativa; substituição recusada mantém a anterior; resposta nunca traz a chave', async () => {
    const staged = await service<{ ai_admin_stage_key: string }>(`select public.ai_admin_stage_key($1, $2, 'AAAA', 'fp-aaaa')`, [ADMIN, KEY_1]);
    const id1 = staged.rows[0]?.ai_admin_stage_key ?? '';
    const view = await service<{ ai_admin_activate_key: { settings: { key: { configured: boolean; last4: string; status: string } } } }>(`select public.ai_admin_activate_key($1, $2)`, [ADMIN, id1]);
    expect(view.rows[0]?.ai_admin_activate_key.settings.key).toMatchObject({ configured: true, last4: 'AAAA', status: 'valid' });
    expect(JSON.stringify(view.rows)).not.toContain(KEY_1);
    expect((await service<{ ai_provider_key: string }>('select public.ai_provider_key()')).rows[0]?.ai_provider_key).toBe(KEY_1);

    // Substituição que falha no teste: descartada; a ativa mantém-se.
    const id2 = (await service<{ ai_admin_stage_key: string }>(`select public.ai_admin_stage_key($1, $2, 'BBBB', 'fp-bbbb')`, [ADMIN, KEY_2])).rows[0]?.ai_admin_stage_key ?? '';
    await service('select public.ai_admin_discard_key($1, $2, $3)', [ADMIN, id2, 'HTTP 401']);
    expect((await service<{ ai_provider_key: string }>('select public.ai_provider_key()')).rows[0]?.ai_provider_key).toBe(KEY_1);
    expect((await db.query('select id from vault.secrets')).rows).toHaveLength(1);

    // Substituição aceite: a anterior sai do cofre.
    const id3 = (await service<{ ai_admin_stage_key: string }>(`select public.ai_admin_stage_key($1, $2, 'BBBB', 'fp-bbbb')`, [ADMIN, KEY_2])).rows[0]?.ai_admin_stage_key ?? '';
    await service('select public.ai_admin_activate_key($1, $2)', [ADMIN, id3]);
    expect((await service<{ ai_provider_key: string }>('select public.ai_provider_key()')).rows[0]?.ai_provider_key).toBe(KEY_2);
    expect((await db.query('select id from vault.secrets')).rows).toHaveLength(1);

    // Ativar e confirmar o estado público.
    await service(`select public.ai_admin_update($1, $2, '{"enabled": true}'::jsonb)`, [ADMIN, await version()]);
    expect((await as<{ enabled: boolean }>(USER, 'select * from public.ai_status()')).rows[0]?.enabled).toBe(true);

    // Teste definitivo que falha: desativa (a configuração não fica a apontar para uma chave má).
    await service(`select public.ai_admin_record_test($1, false, 'HTTP 401')`, [ADMIN]);
    expect((await as<{ enabled: boolean }>(USER, 'select * from public.ai_status()')).rows[0]?.enabled).toBe(false);

    // Remover: desativa e apaga do cofre.
    await service('select public.ai_admin_remove_key($1, $2)', [ADMIN, await version()]);
    expect((await db.query('select id from vault.secrets')).rows).toHaveLength(0);
    expect((await db.query<{ key_status: string; enabled: boolean }>('select key_status, enabled from public.ai_settings')).rows[0]).toEqual({ key_status: 'none', enabled: false });

    // Auditoria: quem e quando, sem segredos.
    const audit = (await service<{ ai_admin_audit: Array<{ action: string; actor_email: string }> }>('select public.ai_admin_audit($1, 50)', [ADMIN])).rows[0]?.ai_admin_audit ?? [];
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['update', 'key_set', 'key_rejected', 'key_replaced', 'key_tested', 'key_removed']));
    expect(audit.every((a) => a.actor_email === 'dono@exemplo.pt')).toBe(true);
    const everything = await dump();
    expect(everything).not.toContain(KEY_1);
    expect(everything).not.toContain(KEY_2);
  });

  it('administradores seguintes só por um administrador; o último não é removido', async () => {
    await expect(service('select public.ai_admin_revoke($1, $1)', [ADMIN])).rejects.toThrow(/last_admin/);
    await service('select public.ai_admin_grant($1, $2)', [ADMIN, USER]);
    expect((await as<{ ai_whoami: boolean }>(USER, 'select public.ai_whoami()')).rows[0]?.ai_whoami).toBe(true);
    await service('select public.ai_admin_revoke($1, $2)', [ADMIN, USER]);
    expect((await as<{ ai_whoami: boolean }>(USER, 'select public.ai_whoami()')).rows[0]?.ai_whoami).toBe(false);
  });

  it('consumo do mês separado: confirmado, desconhecido e reservado', async () => {
    const u = (await service<{ ai_admin_usage: Record<string, unknown> }>('select public.ai_admin_usage($1)', [ADMIN])).rows[0]?.ai_admin_usage;
    expect(Object.keys(u ?? {}).sort()).toEqual(['budget_usd', 'confirmed_usd', 'in_flight', 'month', 'requests', 'reserved_usd', 'unknown_attempts', 'unknown_usd']);
  });
});
