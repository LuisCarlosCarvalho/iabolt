// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SUPABASE_STUB } from './supabaseStub';

/**
 * Consumo do Assistente IA (reserva, limites, orçamento, acerto) num Postgres local (PGlite), com as
 * migrações reais. Os limites vêm da configuração CENTRAL (ai_settings). Não substitui o teste no
 * projeto Supabase real, nem prova concorrência real (PGlite tem uma só ligação: o bloqueio
 * `pg_advisory_xact_lock` só se demonstra no Postgres do servidor).
 */
const USER_A = '00000000-0000-4000-8000-0000000000a1';
const USER_B = '00000000-0000-4000-8000-0000000000b1';
const MODEL = 'claude-sonnet-5-5';
const PRICES = JSON.stringify({ input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 });
let db: PGlite;
let wsA = '';

/** Configuração central para o teste (como superutilizador: equivale a um administrador). */
async function configure(patch: Record<string, number | boolean> = {}) {
  const base: Record<string, number | boolean> = { enabled: true, requests_per_user_day: 3, requests_per_workspace_day: 10, max_concurrent_per_user: 1, max_concurrent_per_workspace: 4, monthly_budget_usd: 0.05, ...patch };
  // Chave Anthropic reconhecida (a regra «só ativa com chave válida» é verificada pelo gatilho).
  await db.query(`update public.ai_provider_keys set key_secret_id = coalesce(key_secret_id, gen_random_uuid()), key_status = 'valid' where provider = 'anthropic'`);
  await db.query(
    `update public.ai_settings set enabled = $1,
       requests_per_user_day = $2, requests_per_workspace_day = $3, max_concurrent_per_user = $4, max_concurrent_per_workspace = $5, monthly_budget_usd = $6 where id = 1`,
    [base.enabled ?? true, base.requests_per_user_day, base.requests_per_workspace_day, base.max_concurrent_per_user, base.max_concurrent_per_workspace, base.monthly_budget_usd],
  );
}

async function reserve(user: string, ws: string, usd: number, requestId: string = crypto.randomUUID(), model = MODEL): Promise<{ reservation_id: string | null; reason: string | null }> {
  const r = await db.query<{ reservation_id: string | null; reason: string | null }>(`select * from public.ai_reserve($1, $2, $3, null, $4, $5, $6::jsonb)`, [requestId, user, ws, usd, model, PRICES]);
  const row = r.rows[0];
  if (!row) throw new Error('sem linha');
  return row;
}

async function settle(id: string, confirmed: number, unknown = 0, status = 'done', unknownAttempts = 0) {
  await db.query(`select public.ai_settle($1, $2, 100, 50, 0, 0, $3, $4, 1, $5, 900, null)`, [id, status, confirmed, unknown, unknownAttempts]);
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUB);
  const dir = join(process.cwd(), 'supabase', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(join(dir, file), 'utf8'));
  await db.query(`insert into auth.users (id, email) values ($1, 'a@exemplo.pt'), ($2, 'b@exemplo.pt')`, [USER_A, USER_B]);
  const ws = await db.query<{ workspace_id: string }>(`select workspace_id from public.workspace_members where user_id = $1`, [USER_A]);
  wsA = ws.rows[0]?.workspace_id ?? '';
}, 60_000);

beforeEach(async () => {
  await db.exec('delete from public.ai_usage');
  await configure();
});

describe('Assistente IA · reserva, limites e orçamento (PGlite)', () => {
  it('reserva antes da chamada com instantâneo de modelo e preços; acerto separa confirmado e desconhecido', async () => {
    const r = await reserve(USER_A, wsA, 0.02);
    expect(r.reason).toBeNull();
    await settle(r.reservation_id ?? '', 0.011, 0.004, 'done', 1);
    const row = (await db.query<{ status: string; cost_usd: string; confirmed_cost_usd: string; unknown_cost_usd: string; model: string; prices: { output: number } }>(`select * from public.ai_usage`)).rows[0];
    expect(row).toMatchObject({ status: 'done', model: MODEL, prices: { output: 10 } });
    expect(Number(row?.confirmed_cost_usd)).toBeCloseTo(0.011);
    expect(Number(row?.unknown_cost_usd)).toBeCloseTo(0.004);
    expect(Number(row?.cost_usd)).toBeCloseTo(0.015);
  });

  it('desativado na configuração central (ou modelo mudou entretanto): recusa antes de qualquer chamada', async () => {
    await configure({ enabled: false });
    expect((await reserve(USER_A, wsA, 0.001)).reason).toBe('disabled');
    await configure();
    expect((await reserve(USER_A, wsA, 0.001, crypto.randomUUID(), 'claude-opus-5-5')).reason).toBe('config_changed');
  });

  it('um pedido em curso por utilizador: o segundo simultâneo é recusado até o primeiro acabar', async () => {
    const first = await reserve(USER_A, wsA, 0.01);
    expect((await reserve(USER_A, wsA, 0.01)).reason).toBe('user_concurrency');
    await settle(first.reservation_id ?? '', 0.005);
    expect((await reserve(USER_A, wsA, 0.01)).reason).toBeNull();
  });

  it('orçamento mensal conta reservas por acertar (capacidade reservada antes da chamada)', async () => {
    await configure({ max_concurrent_per_user: 5 });
    const a = await reserve(USER_A, wsA, 0.03);
    expect(a.reason).toBeNull();
    expect((await reserve(USER_A, wsA, 0.03)).reason).toBe('budget');
    await settle(a.reservation_id ?? '', 0.01);
    expect((await reserve(USER_A, wsA, 0.03)).reason).toBeNull();
  });

  it('limite diário por utilizador; reservas libertadas (sem chamada) não contam', async () => {
    await configure({ max_concurrent_per_user: 5, monthly_budget_usd: 100 });
    const r1 = await reserve(USER_A, wsA, 0.001);
    await db.query('select public.ai_release($1)', [r1.reservation_id]);
    for (let i = 0; i < 3; i += 1) expect((await reserve(USER_A, wsA, 0.001)).reason).toBeNull();
    expect((await reserve(USER_A, wsA, 0.001)).reason).toBe('user_day');
  });

  it('limite diário e concorrência por workspace', async () => {
    await configure({ max_concurrent_per_user: 5, max_concurrent_per_workspace: 2, monthly_budget_usd: 100 });
    await reserve(USER_A, wsA, 0.001);
    await reserve(USER_A, wsA, 0.001);
    expect((await reserve(USER_A, wsA, 0.001)).reason).toBe('workspace_concurrency');
    await db.exec(`update public.ai_usage set status = 'done'`);
    await configure({ max_concurrent_per_user: 5, requests_per_workspace_day: 2, monthly_budget_usd: 100 });
    expect((await reserve(USER_A, wsA, 0.001)).reason).toBe('workspace_day');
  });

  it('quem não é editor do workspace não reserva; pedido repetido é recusado', async () => {
    expect((await reserve(USER_B, wsA, 0.001)).reason).toBe('forbidden');
    await configure({ max_concurrent_per_user: 5 });
    const id = crypto.randomUUID();
    expect((await reserve(USER_A, wsA, 0.001, id)).reason).toBeNull();
    expect((await reserve(USER_A, wsA, 0.001, id)).reason).toBe('duplicate');
  });

  it('consumo desconhecido nunca vale zero: libertação só sem tentativas; reserva sem acerto expira pelo reservado', async () => {
    await configure({ max_concurrent_per_user: 5, monthly_budget_usd: 1 });
    const b = await reserve(USER_A, wsA, 0.07);
    await db.query(`update public.ai_usage set created_at = now() - interval '1 hour', attempts = 1 where id = $1`, [b.reservation_id]);
    await db.query('select public.ai_release($1)', [b.reservation_id]);
    expect((await db.query<{ n: number }>('select public.ai_expire_stale(900) as n')).rows[0]?.n).toBe(1);
    const expired = (await db.query<{ status: string; cost_usd: string; unknown_cost_usd: string; reserved_usd: string }>(`select * from public.ai_usage where id = $1`, [b.reservation_id])).rows[0];
    expect(expired?.status).toBe('expired');
    expect(Number(expired?.cost_usd)).toBeCloseTo(Number(expired?.reserved_usd));
    expect(Number(expired?.unknown_cost_usd)).toBeCloseTo(Number(expired?.reserved_usd));
  });

  it('reserva por fornecedor e tipo: edição confirma o fornecedor; imagens exigem uso ativo, chave do fornecedor e limite diário próprio', async () => {
    await configure({ max_concurrent_per_user: 5, monthly_budget_usd: 100, requests_per_user_day: 50 });
    const reserve9 = async (provider: string, model: string, kind: string, usd = 0.067) =>
      (await db.query<{ reservation_id: string | null; reason: string | null }>('select * from public.ai_reserve($1, $2, $3, null, $4, $5, $6, $7::jsonb, $8)', [crypto.randomUUID(), USER_A, wsA, usd, provider, model, PRICES, kind])).rows[0];
    expect((await reserve9('anthropic', MODEL, 'edit', 0.001))?.reason).toBeNull();
    expect((await reserve9('openai', MODEL, 'edit', 0.001))?.reason).toBe('config_changed');
    // Imagens desativadas por omissão.
    expect((await reserve9('google', 'gemini-3.1-flash-image', 'image'))?.reason).toBe('disabled');
    await db.query(`update public.ai_provider_keys set key_secret_id = gen_random_uuid(), key_status = 'valid' where provider = 'google'`);
    await db.query(`update public.ai_settings set image_provider = 'google', image_model = 'gemini-3.1-flash-image', image_enabled = true, image_requests_per_user_day = 2`);
    expect((await reserve9('google', 'gemini-3-pro-image', 'image'))?.reason).toBe('config_changed');
    expect((await reserve9('google', 'gemini-3.1-flash-image', 'image'))?.reason).toBeNull();
    expect((await reserve9('google', 'gemini-3.1-flash-image', 'image'))?.reason).toBeNull();
    expect((await reserve9('google', 'gemini-3.1-flash-image', 'image'))?.reason).toBe('user_day');
    const rows = (await db.query<{ provider: string; kind: string }>(`select provider, kind from public.ai_usage order by created_at`)).rows;
    expect(rows).toEqual([{ provider: 'anthropic', kind: 'edit' }, { provider: 'google', kind: 'image' }, { provider: 'google', kind: 'image' }]);
    await db.query(`update public.ai_settings set image_enabled = false`);
  });

  it('utilizadores não chamam as funções de consumo nem escrevem na tabela; só leem o próprio consumo', async () => {
    const r = await reserve(USER_A, wsA, 0.001);
    await settle(r.reservation_id ?? '', 0.001);
    const as = async (user: string, sql: string) => {
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user]);
      await db.exec('set role authenticated');
      try {
        return await db.query(sql);
      } finally {
        await db.exec('reset role');
      }
    };
    await expect(as(USER_A, `select * from public.ai_reserve('${crypto.randomUUID()}', '${USER_A}', '${wsA}', null, 0, '${MODEL}', '{}'::jsonb)`)).rejects.toThrow(/permission denied/);
    await expect(as(USER_A, `select * from public.ai_reserve('${crypto.randomUUID()}', '${USER_A}', '${wsA}', null, 0, 'anthropic', '${MODEL}', '{}'::jsonb, 'edit')`)).rejects.toThrow(/permission denied/);
    await expect(as(USER_A, `select public.ai_provider_key_for('anthropic')`)).rejects.toThrow(/permission denied/);
    await expect(as(USER_A, `select public.ai_release('${r.reservation_id ?? ''}')`)).rejects.toThrow(/permission denied/);
    await expect(as(USER_A, 'select public.ai_expire_stale(60)')).rejects.toThrow(/permission denied/);
    await expect(as(USER_A, `insert into public.ai_usage (request_id, user_id, workspace_id, reserved_usd) values ('${crypto.randomUUID()}', '${USER_A}', '${wsA}', 0)`)).rejects.toThrow(/permission denied/);
    expect((await as(USER_A, 'select id from public.ai_usage')).rows).toHaveLength(1);
    expect((await as(USER_B, 'select id from public.ai_usage')).rows).toHaveLength(0);
  });
});
