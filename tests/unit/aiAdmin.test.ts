import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAdmin, type AdminDeps, type AdminRequest, type AdminResult } from '../../supabase/functions/_shared/ai/admin.ts';
import { createLocalAiAdmin, LOCAL_ADMIN_AUTH } from '../../src/admin/localAiAdmin';

/**
 * [simulado] Função ai-admin (painel «Configurações de IA») com as dependências em memória
 * (as mesmas regras da base de dados; a autorização SQL está em tests/db/ai_settings.test.ts).
 * Sem rede nem fornecedor real.
 */
const KEY_A = 'sk-teste-chave-valida-000000000000AAAA';
const KEY_B = 'sk-teste-chave-valida-000000000000BBBB';
const KEY_BAD = 'sk-teste-chave-invalida-00000000000XXXX';
const KEY_OFFLINE = 'sk-teste-chave-sem-rede-0000000000ZZZZ';

const send = (deps: AdminDeps, req: AdminRequest | Record<string, unknown>, auth: string | null = LOCAL_ADMIN_AUTH): Promise<AdminResult> => handleAdmin(auth, JSON.stringify(req), deps);

function spyLogs() {
  const lines: string[] = [];
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => lines.push(a.map(String).join(' ')));
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('[simulado] ai-admin · autorização', () => {
  it('sem sessão → 401; utilizador comum → 403 em TODAS as ações, sem tocar em nada', async () => {
    const base = createLocalAiAdmin();
    const touched: string[] = [];
    const commonUser: AdminDeps = {
      ...base,
      getUser: async (h) => (h === 'Bearer comum' ? { id: 'utilizador-comum' } : null),
      isAdmin: async () => false,
    };
    for (const name of ['get', 'update', 'stageKey', 'activateKey', 'discardKey', 'removeKey', 'recordTest', 'providerKey', 'checkKey', 'usage', 'audit'] as const) {
      const original = commonUser[name];
      Object.assign(commonUser, {
        [name]: (...args: never[]) => {
          touched.push(name);
          return (original as (...a: never[]) => unknown)(...args);
        },
      });
    }
    expect((await send(commonUser, { action: 'get' }, null)).status).toBe(401);
    const requests: AdminRequest[] = [
      { action: 'get' },
      { action: 'update', expectedVersion: 1, patch: { enabled: true } },
      { action: 'setKey', key: KEY_A },
      { action: 'removeKey', expectedVersion: 1 },
      { action: 'test' },
      { action: 'usage' },
      { action: 'audit' },
    ];
    for (const req of requests) {
      const r = await send(commonUser, req, 'Bearer comum');
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('not_admin');
      expect(JSON.stringify(r.body)).not.toContain(KEY_A);
    }
    expect(touched).toEqual([]);
  });

  it('pedido fora do contrato recusado sem ecoar o conteúdo (incluindo uma chave mal formada)', async () => {
    const deps = createLocalAiAdmin();
    const bad = await send(deps, { action: 'setKey', key: 'sk teste com espacos 0000000000' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toContain('sk teste');
    expect((await send(deps, { action: 'update', expectedVersion: 1, patch: { key_status: 'valid' } })).status).toBe(400);
    expect((await send(deps, { action: 'apagarTudo' })).status).toBe(400);
  });
});

describe('[simulado] ai-admin · chave e configuração', () => {
  it('desativado por omissão; não se ativa sem chave; guardar a chave: só «configurada», últimos 4 e impressão', async () => {
    const logs = spyLogs();
    const deps = createLocalAiAdmin();
    const first = await send(deps, { action: 'get' });
    expect(first.body.view?.settings).toMatchObject({ enabled: false, key: { configured: false, status: 'none' } });
    const on = await send(deps, { action: 'update', expectedVersion: 1, patch: { enabled: true } });
    expect(on.status).toBe(400);
    expect(on.body.code).toBe('invalid_settings');

    const set = await send(deps, { action: 'setKey', key: KEY_A });
    expect(set.status).toBe(200);
    expect(set.body.view?.settings.key).toMatchObject({ configured: true, last4: 'AAAA', status: 'valid' });
    expect(set.body.view?.settings.key.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(set.body.test?.cost).toContain('Sem custo');
    expect(JSON.stringify(set.body)).not.toContain(KEY_A);

    const version = set.body.view?.settings.version ?? 0;
    const enabled = await send(deps, { action: 'update', expectedVersion: version, patch: { enabled: true, monthly_budget_usd: 40 } });
    expect(enabled.body.view?.settings).toMatchObject({ enabled: true, monthly_budget_usd: 40 });
    // Versão antiga: recusada (sem sobreposição silenciosa).
    expect((await send(deps, { action: 'update', expectedVersion: version, patch: { monthly_budget_usd: 1 } })).status).toBe(409);
    expect(logs.join('\n')).not.toContain(KEY_A);
  });

  it('substituição recusada (definitiva ou sem resposta) mantém a chave anterior e a configuração válida', async () => {
    const deps = createLocalAiAdmin();
    await send(deps, { action: 'setKey', key: KEY_A });
    const v = (await send(deps, { action: 'get' })).body.view?.settings.version ?? 0;
    await send(deps, { action: 'update', expectedVersion: v, patch: { enabled: true } });

    for (const key of [KEY_BAD, KEY_OFFLINE]) {
      const r = await send(deps, { action: 'setKey', key });
      expect(r.status).toBe(422);
      expect(r.body.error).toContain('Mantém-se a chave anterior (…AAAA)');
      expect(r.body.view?.settings).toMatchObject({ enabled: true, key: { last4: 'AAAA', status: 'valid' } });
      expect(JSON.stringify(r.body)).not.toContain(key);
      expect(await deps.providerKey()).toBe(KEY_A);
    }
    const audit = (await send(deps, { action: 'audit' })).body.audit ?? [];
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['key_set', 'update', 'key_rejected']));
    expect(JSON.stringify(audit)).not.toContain(KEY_BAD);

    // Substituição aceite: nova ativa; a anterior sai do cofre.
    const ok = await send(deps, { action: 'setKey', key: KEY_B });
    expect(ok.body.view?.settings.key.last4).toBe('BBBB');
    expect(await deps.providerKey()).toBe(KEY_B);
  });

  it('testar ligação: sem custo; recusa definitiva desativa; falta de resposta não muda nada; remover desativa', async () => {
    let answer: 'ok' | 'bad' | 'offline' = 'ok';
    const deps = createLocalAiAdmin(async () => (answer === 'ok' ? { ok: true } : answer === 'bad' ? { ok: false, definitive: true, reason: 'O fornecedor recusou a chave.' } : { ok: false, definitive: false, reason: 'Sem resposta do fornecedor.' }));
    expect((await send(deps, { action: 'test' })).body.code).toBe('no_key');
    await send(deps, { action: 'setKey', key: KEY_A });
    let v = (await send(deps, { action: 'get' })).body.view?.settings.version ?? 0;
    await send(deps, { action: 'update', expectedVersion: v, patch: { enabled: true } });

    answer = 'offline';
    const offline = await send(deps, { action: 'test' });
    expect(offline.body.test).toMatchObject({ ok: false, definitive: false });
    expect(offline.body.view?.settings).toMatchObject({ enabled: true, key: { status: 'valid' } });

    answer = 'bad';
    const bad = await send(deps, { action: 'test' });
    expect(bad.body.test?.message).toContain('desativado');
    expect(bad.body.view?.settings).toMatchObject({ enabled: false, key: { status: 'invalid' } });
    expect(bad.body.test?.cost).toContain('Sem custo');

    v = bad.body.view?.settings.version ?? 0;
    const removed = await send(deps, { action: 'removeKey', expectedVersion: v });
    expect(removed.body.view?.settings).toMatchObject({ enabled: false, key: { configured: false, status: 'none' } });
    expect(await deps.providerKey()).toBeNull();
  });

  it('um erro interno que contenha a chave nunca a devolve', async () => {
    const deps: AdminDeps = {
      ...createLocalAiAdmin(),
      stageKey: async (_a, key) => {
        throw new Error(`duplicate key value violates unique constraint: ${key}`);
      },
    };
    const r = await send(deps, { action: 'setKey', key: KEY_A });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain(KEY_A);
  });
});
