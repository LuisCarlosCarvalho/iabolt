import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GrapesProjectData } from '../../src/contract/boltDocument';
import { SupabaseRepository } from '../../src/persistence/supabaseRepository';
import { cleanupProjects, signedIn } from './testAccounts';

/**
 * Valores financeiros só para administradores, no SUPABASE REAL, com a conta de teste A (não é
 * administradora; contas admin@… são recusadas). SEM CHAMADAS PAGAS: `ai-propose` não é chamada; a
 * `ai-image` só é chamada nos casos em que recusa ANTES de reservar (separador antigo; geração
 * desativada). Precisa da migração 20261002120000 e das funções desta entrega publicadas.
 */
const page: GrapesProjectData = { pages: [{ frames: [{ component: { type: 'wrapper', attributes: { id: 'root' }, components: [] } }] }] };
let a: SupabaseClient;
let projectId = '';
const created: string[] = [];

/** Resposta de erro de uma função (corpo e estado). */
async function invokeError(client: SupabaseClient, fn: string, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data, error } = await client.functions.invoke(fn, { body });
  if (!error) return { status: 200, body: (data ?? {}) as Record<string, unknown> };
  const ctx: unknown = Reflect.get(error, 'context');
  if (ctx instanceof Response) return { status: ctx.status, body: ((await ctx.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  throw error;
}

beforeAll(async () => {
  a = await signedIn('A');
  const repo = new SupabaseRepository(a, '0.23.6');
  const r = await repo.create(crypto.randomUUID(), page, { name: '[teste automático] IA financeiro', templateId: 'em-branco' });
  projectId = r.projectId;
  created.push(projectId);
});

afterAll(async () => {
  await a?.auth.signOut();
  const problems = await cleanupProjects('A', created);
  if (problems.length) console.warn(`Limpeza incompleta:\n${problems.join('\n')}`);
});

describe('Supabase real · utilizador comum sem valores financeiros', () => {
  it('a conta de teste A não é administradora', async () => {
    const { data, error } = await a.rpc('ai_whoami');
    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  it('ai_status_v2: as mesmas colunas, sem preços', async () => {
    const { data, error } = await a.rpc('ai_status_v2');
    expect(error).toBeNull();
    const row: Record<string, unknown> = (Array.isArray(data) ? data[0] : data) ?? {};
    expect(Object.keys(row)).toContain('prices');
    expect(row.prices).toBeNull();
    expect(row.image_price_usd).toBeNull();
  });

  it('consumo, preços, configuração e chaves: sem acesso direto', async () => {
    const usage = await a.from('ai_usage').select('id, cost_usd, reserved_usd, prices');
    expect(usage.error).toBeNull();
    expect(usage.data).toEqual([]);
    for (const t of ['ai_models', 'ai_settings', 'ai_settings_audit', 'ai_provider_keys']) {
      const r = await a.from(t).select('*').limit(1);
      expect(r.error, t).not.toBeNull();
      expect(r.data ?? [], t).toEqual([]);
    }
  });

  it('ai-image: separador com o frontend anterior (sem «client») recusado ANTES de reservar, com instrução clara', async () => {
    const r = await invokeError(a, 'ai-image', { contract: 1, requestId: crypto.randomUUID(), projectId, prompt: 'teste sem custo', aspect: '16:9' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('client_outdated');
    expect(String(r.body.error)).toMatch(/recarregue a página/);
    expect(JSON.stringify(r.body)).not.toMatch(/usd|custo|orçamento/i);
  });

  it('ai-image com o frontend atual e a geração desativada: recusa sem custo e sem valores (só corre se as imagens estiverem desativadas)', async () => {
    const { data } = await a.rpc('ai_status_v2');
    const row: Record<string, unknown> = (Array.isArray(data) ? data[0] : data) ?? {};
    if (row.image_enabled === true) {
      // Com a geração ativa este pedido seria PAGO: não é feito aqui.
      console.warn('Geração de imagens ativa: o pedido real não é feito por este teste (teria custo).');
      return;
    }
    const r = await invokeError(a, 'ai-image', { contract: 1, client: 2, requestId: crypto.randomUUID(), projectId, prompt: 'teste sem custo', aspect: '16:9' });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('disabled');
    expect(JSON.stringify(r.body)).not.toMatch(/usd|custo|orçamento/i);
  });
});
