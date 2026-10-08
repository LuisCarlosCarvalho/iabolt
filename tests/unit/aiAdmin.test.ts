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
const KEY_OPENAI = 'sk-teste-openai-valida-00000000000OOOO';
const KEY_GOOGLE = 'AIza-teste-google-valida-000000000GGGG';

const send = (deps: AdminDeps, req: AdminRequest | Record<string, unknown>, auth: string | null = LOCAL_ADMIN_AUTH): Promise<AdminResult> => handleAdmin(auth, JSON.stringify({ api: 2, command: req }), deps);

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
    for (const name of ['get', 'update', 'stageKey', 'activateKey', 'discardKey', 'removeKey', 'recordTest', 'providerKey', 'checkKey', 'usage', 'generation', 'audit', 'diagnose'] as const) {
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
      { action: 'setKey', provider: 'anthropic', key: KEY_A },
      { action: 'removeKey', provider: 'openai', expectedVersion: 1 },
      { action: 'test', provider: 'google' },
      { action: 'diagnose', provider: 'google', maxUsd: 0.02 },
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

  it('pedido fora do contrato recusado sem ecoar o conteúdo (incluindo uma chave mal formada ou fornecedor desconhecido)', async () => {
    const deps = createLocalAiAdmin();
    const bad = await send(deps, { action: 'setKey', provider: 'anthropic', key: 'sk teste com espacos 0000000000' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toContain('sk teste');
    expect((await send(deps, { action: 'setKey', provider: 'qualquer-api', key: KEY_A })).status).toBe(400);
    expect((await send(deps, { action: 'update', expectedVersion: 1, patch: { key_status: 'valid' } })).status).toBe(400);
    expect((await send(deps, { action: 'apagarTudo' })).status).toBe(400);
  });
});

describe('[simulado] ai-admin · chave e configuração', () => {
  it('desativado por omissão; não se ativa sem chave; guardar a chave: só «configurada», últimos 4 e impressão', async () => {
    const logs = spyLogs();
    const deps = createLocalAiAdmin();
    const first = await send(deps, { action: 'get' });
    expect(first.body.view?.settings).toMatchObject({ enabled: false, image_enabled: false, keys: { anthropic: { configured: false, status: 'none' } } });
    const on = await send(deps, { action: 'update', expectedVersion: 1, patch: { enabled: true } });
    expect(on.status).toBe(400);
    expect(on.body.code).toBe('invalid_settings');

    const set = await send(deps, { action: 'setKey', provider: 'anthropic', key: KEY_A });
    expect(set.status).toBe(200);
    expect(set.body.view?.settings.keys.anthropic).toMatchObject({ configured: true, last4: 'AAAA', status: 'valid' });
    expect(set.body.view?.settings.keys.anthropic.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(set.body.test?.cost).toContain('Sem custo');
    expect(set.body.test?.message).toContain('Credenciais reconhecidas');
    expect(set.body.test?.message).toContain('não comprova a geração');
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
    await send(deps, { action: 'setKey', provider: 'anthropic', key: KEY_A });
    const v = (await send(deps, { action: 'get' })).body.view?.settings.version ?? 0;
    await send(deps, { action: 'update', expectedVersion: v, patch: { enabled: true } });

    for (const key of [KEY_BAD, KEY_OFFLINE]) {
      const r = await send(deps, { action: 'setKey', provider: 'anthropic', key });
      expect(r.status).toBe(422);
      expect(r.body.error).toContain('Mantém-se a chave anterior (…AAAA)');
      expect(r.body.view?.settings).toMatchObject({ enabled: true, keys: { anthropic: { last4: 'AAAA', status: 'valid' } } });
      expect(JSON.stringify(r.body)).not.toContain(key);
      expect(await deps.providerKey('anthropic')).toBe(KEY_A);
    }
    const audit = (await send(deps, { action: 'audit' })).body.audit ?? [];
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['key_set', 'update', 'key_rejected']));
    expect(JSON.stringify(audit)).not.toContain(KEY_BAD);

    // Substituição aceite: nova ativa; a anterior sai do cofre.
    const ok = await send(deps, { action: 'setKey', provider: 'anthropic', key: KEY_B });
    expect(ok.body.view?.settings.keys.anthropic.last4).toBe('BBBB');
    expect(await deps.providerKey('anthropic')).toBe(KEY_B);
  });

  it('testar ligação: sem custo; recusa definitiva desativa; falta de resposta não muda nada; remover desativa', async () => {
    let answer: 'ok' | 'bad' | 'offline' = 'ok';
    const deps = createLocalAiAdmin(async () => (answer === 'ok' ? { ok: true } : answer === 'bad' ? { ok: false, definitive: true, reason: 'O fornecedor recusou a chave.' } : { ok: false, definitive: false, reason: 'Sem resposta do fornecedor.' }));
    expect((await send(deps, { action: 'test', provider: 'anthropic' })).body.code).toBe('no_key');
    await send(deps, { action: 'setKey', provider: 'anthropic', key: KEY_A });
    let v = (await send(deps, { action: 'get' })).body.view?.settings.version ?? 0;
    await send(deps, { action: 'update', expectedVersion: v, patch: { enabled: true } });

    answer = 'offline';
    const offline = await send(deps, { action: 'test', provider: 'anthropic' });
    expect(offline.body.test).toMatchObject({ ok: false, definitive: false });
    expect(offline.body.view?.settings).toMatchObject({ enabled: true, keys: { anthropic: { status: 'valid' } } });

    answer = 'bad';
    const bad = await send(deps, { action: 'test', provider: 'anthropic' });
    expect(bad.body.test?.message).toContain('desativado');
    expect(bad.body.view?.settings).toMatchObject({ enabled: false, keys: { anthropic: { status: 'invalid' } } });
    expect(bad.body.test?.cost).toContain('Sem custo');

    v = bad.body.view?.settings.version ?? 0;
    const removed = await send(deps, { action: 'removeKey', provider: 'anthropic', expectedVersion: v });
    expect(removed.body.view?.settings).toMatchObject({ enabled: false, keys: { anthropic: { configured: false, status: 'none' } } });
    expect(await deps.providerKey('anthropic')).toBeNull();
  });

  it('um erro interno que contenha a chave nunca a devolve', async () => {
    const deps: AdminDeps = {
      ...createLocalAiAdmin(),
      stageKey: async (_a, _p, key) => {
        throw new Error(`duplicate key value violates unique constraint: ${key}`);
      },
    };
    const r = await send(deps, { action: 'setKey', provider: 'openai', key: KEY_A });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain(KEY_A);
  });
});

describe('[simulado] ai-admin · vários fornecedores', () => {
  it('cada fornecedor tem a sua chave; trocar o fornecedor de edição preserva as outras chaves', async () => {
    const tested: string[] = [];
    const base = createLocalAiAdmin();
    const deps: AdminDeps = {
      ...base,
      checkKey: async (provider, model, key, kind) => {
        tested.push(`${provider}:${model}:${kind}`);
        return base.checkKey(provider, model, key, kind);
      },
    };
    await send(deps, { action: 'setKey', provider: 'anthropic', key: KEY_A });
    const oa = await send(deps, { action: 'setKey', provider: 'openai', key: KEY_OPENAI });
    const go = await send(deps, { action: 'setKey', provider: 'google', key: KEY_GOOGLE });
    // O teste usa um modelo do PRÓPRIO fornecedor; OpenAI e Google só confirmam credenciais.
    expect(tested).toEqual(['anthropic:claude-sonnet-5-5:edit', 'openai:gpt-6-luna:edit', 'google:gemini-3.5-flash-lite:edit']);
    expect(oa.body.test?.message).toContain('Credenciais reconhecidas');
    expect(oa.body.test?.message).toContain('só ficam comprovados com uma utilização real');
    expect(go.body.view?.settings.keys).toMatchObject({ anthropic: { last4: 'AAAA' }, openai: { last4: 'OOOO' }, google: { last4: 'GGGG' } });

    let v = go.body.view?.settings.version ?? 0;
    const sw = await send(deps, { action: 'update', expectedVersion: v, patch: { provider: 'google', model: 'gemini-3.8-flash', enabled: true } });
    // A escolha automática prevalece: na Google, o melhor modelo de edição é o Flash-Lite (08/10).
    expect(sw.body.view?.settings).toMatchObject({ provider: 'google', model: 'gemini-3.5-flash-lite', enabled: true });
    // As três chaves continuam no cofre, intactas.
    expect(await deps.providerKey('anthropic')).toBe(KEY_A);
    expect(await deps.providerKey('openai')).toBe(KEY_OPENAI);
    expect(await deps.providerKey('google')).toBe(KEY_GOOGLE);
    v = sw.body.view?.settings.version ?? 0;
    const back = await send(deps, { action: 'update', expectedVersion: v, patch: { provider: 'anthropic', model: 'claude-sonnet-5-5' } });
    expect(back.body.view?.settings.keys.google).toMatchObject({ configured: true, status: 'valid' });
    // Modelo de outro fornecedor ou de imagem no lugar do de edição: recusado.
    v = back.body.view?.settings.version ?? 0;
    expect((await send(deps, { action: 'update', expectedVersion: v, patch: { provider: 'anthropic', model: 'gpt-6-luna' } })).body.code).toBe('invalid_settings');
    expect((await send(deps, { action: 'update', expectedVersion: v, patch: { provider: 'google', model: 'gemini-3.1-flash-image' } })).body.code).toBe('invalid_settings');
    expect(JSON.stringify(await send(deps, { action: 'get' }))).not.toMatch(/sk-teste|AIza-teste/);
  });

  it('imagens: fornecedor/modelo próprios; só ativam com a chave desse fornecedor; remover a chave desativa só esse uso', async () => {
    const deps = createLocalAiAdmin();
    await send(deps, { action: 'setKey', provider: 'anthropic', key: KEY_A });
    let v = (await send(deps, { action: 'get' })).body.view?.settings.version ?? 0;
    await send(deps, { action: 'update', expectedVersion: v, patch: { enabled: true } });
    v = (await send(deps, { action: 'get' })).body.view?.settings.version ?? 0;
    const pick = await send(deps, { action: 'update', expectedVersion: v, patch: { image_provider: 'google', image_model: 'gemini-3.1-flash-image' } });
    expect(pick.body.view?.settings).toMatchObject({ image_provider: 'google', image_model: 'gemini-3.1-flash-image', image_enabled: false });
    v = pick.body.view?.settings.version ?? 0;
    // Sem chave Google reconhecida: não ativa.
    expect((await send(deps, { action: 'update', expectedVersion: v, patch: { image_enabled: true } })).body.code).toBe('invalid_settings');
    // Modelo de edição no lugar do de imagem: recusado.
    expect((await send(deps, { action: 'update', expectedVersion: v, patch: { image_model: 'gemini-3.8-flash' } })).body.code).toBe('invalid_settings');
    await send(deps, { action: 'setKey', provider: 'google', key: KEY_GOOGLE });
    v = (await send(deps, { action: 'get' })).body.view?.settings.version ?? 0;
    const on = await send(deps, { action: 'update', expectedVersion: v, patch: { image_enabled: true } });
    expect(on.body.view?.settings).toMatchObject({ enabled: true, image_enabled: true });

    v = on.body.view?.settings.version ?? 0;
    const removed = await send(deps, { action: 'removeKey', provider: 'google', expectedVersion: v });
    expect(removed.body.view?.settings).toMatchObject({ enabled: true, image_enabled: false, keys: { anthropic: { status: 'valid' }, google: { configured: false } } });
    expect(await deps.providerKey('anthropic')).toBe(KEY_A);
    const audit = (await send(deps, { action: 'audit' })).body.audit ?? [];
    expect(audit[0]).toMatchObject({ action: 'key_removed', changes: { fornecedor: 'google', imagens: 'desativadas' } });
  });
});

describe('[simulado] ai-admin · formato do pedido', () => {
  it('formato recusado pelo fornecedor: a chave fica guardada e o assistente não é desativado, com aviso', async () => {
    const warning = 'Chave e modelo reconhecidos, mas o fornecedor recusou o formato do pedido do assistente (HTTP 400 · invalid_request_error: x).';
    const deps = createLocalAiAdmin(async () => ({ ok: true, warning }));
    const saved = await send(deps, { action: 'setKey', provider: 'anthropic', key: KEY_A });
    expect(saved.status).toBe(200);
    expect(saved.body.view?.settings.keys.anthropic).toMatchObject({ configured: true, status: 'valid' });
    expect(saved.body.test).toMatchObject({ ok: false, definitive: false, message: warning });
    const version = saved.body.view?.settings.version ?? 0;
    const on = await send(deps, { action: 'update', expectedVersion: version, patch: { enabled: true } });
    expect(on.body.view?.settings.enabled).toBe(true);
    const tested = await send(deps, { action: 'test', provider: 'anthropic' });
    expect(tested.body.test).toMatchObject({ ok: false, definitive: false, message: warning });
    expect(tested.body.view?.settings).toMatchObject({ enabled: true, keys: { anthropic: { status: 'valid' } } });
    expect(JSON.stringify([saved.body, tested.body])).not.toContain(KEY_A);
  });
});

describe('[simulado] ai-admin · geração validada', () => {
  it('«usage» devolve a última utilização real por fornecedor/modelo/tipo, separada do teste das credenciais', async () => {
    const base = createLocalAiAdmin();
    const deps: AdminDeps = {
      ...base,
      generation: async () => [{ provider: 'anthropic', model: 'claude-sonnet-5-5', kind: 'edit', validated_at: '2026-09-29T20:00:00Z' }],
    };
    const r = await send(deps, { action: 'usage' });
    expect(r.body.generation).toEqual([{ provider: 'anthropic', model: 'claude-sonnet-5-5', kind: 'edit', validated_at: '2026-09-29T20:00:00Z' }]);
    expect(r.body.usage).toMatchObject({ image_usd: 0 });
    // Sem pedidos reais (simulação local): por validar, mesmo com a chave reconhecida.
    await send(base, { action: 'setKey', provider: 'anthropic', key: KEY_A });
    expect((await send(base, { action: 'usage' })).body.generation).toEqual([]);
  });
});

describe('[simulado] ai-admin · diagnóstico progressivo do Gemini (pago, com teto)', () => {
  it('só Google, teto máximo 0,02 USD, usa o modelo de edição Google mais barato e os seus preços; sem chave → no_key', async () => {
    const calls: Array<{ model: string; prices: { input: number; output: number }; maxUsd: number; keyEnds: string }> = [];
    const base = createLocalAiAdmin();
    const deps: AdminDeps = {
      ...base,
      diagnose: async (model, key, prices, maxUsd) => {
        calls.push({ model, prices, maxUsd, keyEnds: key.slice(-4) });
        return { model, endpoint: '/v1beta/interactions', steps: [], firstRejected: null, stoppedForBudget: false, costUsd: 0, maxUsd };
      },
    };
    expect((await send(deps, { action: 'diagnose', provider: 'google', maxUsd: 0.02 })).body.code).toBe('no_key');
    expect((await send(deps, { action: 'diagnose', provider: 'google', maxUsd: 0.5 })).body.code).toBe('bad_request');
    expect((await send(deps, { action: 'diagnose', provider: 'anthropic', maxUsd: 0.01 })).body.code).toBe('bad_request');
    await send(deps, { action: 'setKey', provider: 'google', key: KEY_GOOGLE });
    const r = await send(deps, { action: 'diagnose', provider: 'google', maxUsd: 0.02 });
    expect(r.status).toBe(200);
    expect(r.body.diagnosis?.endpoint).toBe('/v1beta/interactions');
    expect(calls).toHaveLength(1);
    // O modelo de edição Google mais barato (a causa do HTTP 400 é comum aos modelos).
    expect(calls[0]?.model).toBe('gemini-3.5-flash-lite');
    expect(calls[0]?.maxUsd).toBe(0.02);
    expect(calls[0]?.keyEnds).toBe('GGGG');
    expect(JSON.stringify(r.body)).not.toContain(KEY_GOOGLE);
  });
});

describe('[simulado] ai-admin · Cloudflare (imagens gratuitas, escolha automática)', () => {
  const KEY_CF = '0123456789abcdef0123456789abcdef:token-de-teste-cloudflare-000CFTK';
  it('guardar a credencial reconhecida ativa a Cloudflare e as imagens passam para o FLUX sozinhas; a edição não muda', async () => {
    const deps = createLocalAiAdmin();
    await send(deps, { action: 'setKey', provider: 'google', key: KEY_GOOGLE });
    await send(deps, { action: 'setEnabled', provider: 'google', enabled: true });
    let view = (await send(deps, { action: 'get' })).body.view;
    expect(view?.settings).toMatchObject({ provider: 'google', image_provider: 'google', image_model: 'gemini-3.1-flash-image' });
    // Uma chave de edição não se ativa sozinha; a da Cloudflare (só imagens) sim.
    const r = await send(deps, { action: 'setKey', provider: 'cloudflare', key: KEY_CF });
    expect(r.status).toBe(200);
    view = r.body.view;
    expect(view?.settings.keys.cloudflare).toMatchObject({ configured: true, status: 'valid', enabled: true, last4: 'CFTK' });
    expect(view?.settings).toMatchObject({ enabled: true, provider: 'google', image_enabled: true, image_provider: 'cloudflare', image_model: '@cf/black-forest-labs/flux-1-schnell' });
    expect(JSON.stringify(r.body)).not.toContain('token-de-teste');
    // Outro token (substituir): continua ativa e escolhida.
    const again = await send(deps, { action: 'setKey', provider: 'cloudflare', key: KEY_CF.replace('CFTK', 'NOVO') });
    expect(again.body.view?.settings).toMatchObject({ image_provider: 'cloudflare' });
    expect(again.body.view?.settings.keys.cloudflare.last4).toBe('NOVO');
    // Desativar volta ao Gemini.
    const off = await send(deps, { action: 'setEnabled', provider: 'cloudflare', enabled: false });
    expect(off.body.view?.settings).toMatchObject({ image_provider: 'google' });
  });

  it('servidor anterior sem a Cloudflare: o painel mostra-a «sem chave» em vez de falhar', async () => {
    const deps = createLocalAiAdmin();
    const base = (await send(deps, { action: 'get' })).body.view;
    if (!base) throw new Error('vista');
    const older = Object.fromEntries(Object.entries(base.settings.keys).filter(([p]) => p !== 'cloudflare'));
    const legacy: AdminDeps = { ...deps, get: async () => ({ ...base, settings: { ...base.settings, keys: older } }) };
    const r = await send(legacy, { action: 'get' });
    expect(r.status).toBe(200);
    expect(r.body.view?.settings.keys.cloudflare).toMatchObject({ configured: false, status: 'none', enabled: false });
  });
});
