import { AlertTriangle, CheckCircle2, ImageIcon, KeyRound, PlugZap, RefreshCw, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  DIAG_MAX_USD,
  routing,
  SUPPORTED_PROVIDERS,
  TEST_COST_NOTE,
  type AdminAuditEntry,
  type AdminDiagnosis,
  type AdminGeneration,
  type AdminRequest,
  type AdminResult,
  type AdminUsage,
  type AdminView,
  type SettingsPatch,
} from '../../supabase/functions/_shared/ai/admin.ts';
import { isProviderId, PROVIDER_LABEL, type ProviderId } from '../../supabase/functions/_shared/ai/ids.ts';
import { Link } from '../app/router';
import { useServices } from '../app/services';
import { Button, formatDateTime, Modal, Spinner, StatePanel } from '../app/ui';

/**
 * Painel «Configurações de IA»: configuração CENTRAL do Bolt IA (aplica-se a todos os workspaces),
 * gerida pelos administradores da plataforma. Esconder esta página não é a proteção: cada ação é
 * verificada no servidor (função ai-admin). Cada fornecedor tem a sua chave, que só é enviada
 * quando é introduzida ou substituída; o campo é limpo logo a seguir e o servidor nunca a devolve.
 * «Credenciais reconhecidas» (teste sem custo) e «Geração validada» (utilização real) são coisas
 * diferentes e aparecem em separado.
 */
type Msg = { kind: 'ok' | 'error'; text: string } | null;
type NumericKey = {
  [K in keyof SettingsPatch & keyof AdminView['settings']]: AdminView['settings'][K] extends number ? K : never;
}[keyof SettingsPatch & keyof AdminView['settings']];

const LIMIT_FIELDS: ReadonlyArray<{ key: NumericKey; label: string; step?: string; hint?: string }> = [
  { key: 'monthly_budget_usd', label: 'Orçamento mensal (USD)', step: '0.01', hint: 'Teto aplicado antes de cada chamada (edição e imagens), com reserva do custo máximo.' },
  { key: 'requests_per_user_day', label: 'Pedidos por pessoa por dia' },
  { key: 'requests_per_workspace_day', label: 'Pedidos por workspace por dia' },
  { key: 'image_requests_per_user_day', label: 'Imagens por pessoa por dia' },
  { key: 'max_concurrent_per_user', label: 'Pedidos simultâneos por pessoa' },
  { key: 'max_concurrent_per_workspace', label: 'Pedidos simultâneos por workspace' },
  { key: 'max_output_tokens', label: 'Máximo de tokens de saída' },
  { key: 'max_operations', label: 'Máximo de operações por proposta' },
  { key: 'max_parts', label: 'Máximo de partes por pedido grande', hint: 'Página ou site inteiro: cada parte é um pedido com reserva própria.' },
  { key: 'max_retries', label: 'Repetições após resposta inválida' },
  { key: 'timeout_ms', label: 'Tempo limite por tentativa (ms)' },
  { key: 'overhead_tokens', label: 'Margem de tokens do fornecedor' },
];

const usd = (n: number) => `${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USD`;

const ACTION_LABEL: Record<string, string> = {
  update: 'Configurações alteradas',
  key_set: 'Chave configurada',
  key_replaced: 'Chave substituída',
  key_rejected: 'Chave nova recusada (mantida a anterior)',
  key_removed: 'Chave removida',
  provider_enabled: 'Fornecedor ativado',
  provider_disabled: 'Fornecedor desativado',
  key_tested: 'Ligação testada',
  admin_granted: 'Administrador adicionado',
  admin_revoked: 'Administrador removido',
};

const FIELD_LABEL: Record<string, string> = {
  enabled: 'Assistente ativo',
  model: 'Modelo de edição',
  provider: 'Fornecedor de edição',
  image_enabled: 'Imagens ativas',
  image_provider: 'Fornecedor de imagens',
  image_model: 'Modelo de imagens',
  fornecedor: 'Fornecedor',
  chave: 'Chave',
  resultado: 'Resultado',
  motivo: 'Motivo',
  detalhe: 'Detalhe',
  assistente: 'Assistente',
  imagens: 'Imagens',
  ...Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, f.label])),
};
const show = (v: unknown) => (v === true ? 'sim' : v === false ? 'não' : v === null || v === undefined ? '—' : String(v));

function describeChanges(changes: Record<string, unknown>): string {
  return Object.entries(changes)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => {
      const label = FIELD_LABEL[k] ?? k;
      if (v && typeof v === 'object' && 'para' in v) return `${label}: ${show(Reflect.get(v, 'de'))} → ${show(Reflect.get(v, 'para'))}`;
      return `${label}: ${show(k === 'fornecedor' && isProviderId(v) ? PROVIDER_LABEL[v] : v)}`;
    })
    .join(' · ');
}

/** Última utilização real bem-sucedida (fornecedor, e opcionalmente modelo e tipo). */
function validatedAt(generation: AdminGeneration | null, provider: ProviderId, model?: string, kind?: 'edit' | 'image'): { at: string; model: string } | null {
  const hits = (generation ?? []).filter((g) => g.provider === provider && g.validated_at && (!model || g.model === model) && (!kind || g.kind === kind));
  const last = hits.sort((a, b) => String(b.validated_at).localeCompare(String(a.validated_at)))[0];
  return last?.validated_at ? { at: last.validated_at, model: last.model } : null;
}

export function AiSettingsPage() {
  const { ai } = useServices();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [view, setView] = useState<AdminView | null>(null);
  const [usage, setUsage] = useState<AdminUsage | null>(null);
  const [generation, setGeneration] = useState<AdminGeneration | null>(null);
  const [audit, setAudit] = useState<AdminAuditEntry[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [confirmRemove, setConfirmRemove] = useState<ProviderId | null>(null);

  const adopt = useCallback((v: AdminView) => {
    setView(v);
    setLimits(Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, String(v.settings[f.key])])));
  }, []);

  const refreshSide = useCallback(async () => {
    const [u, a] = await Promise.all([ai.send({ action: 'usage' }), ai.send({ action: 'audit' })]);
    if (u.body.usage) setUsage(u.body.usage);
    setGeneration(u.body.generation ?? null);
    if (a.body.audit) setAudit(a.body.audit);
  }, [ai]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const isAdmin = await ai.isAdmin();
      if (!alive) return;
      setAllowed(isAdmin);
      if (!isAdmin) return;
      const r = await ai.send({ action: 'get' });
      if (!alive) return;
      if (r.body.view) adopt(r.body.view);
      else setMsg({ kind: 'error', text: r.body.error ?? 'Não foi possível ler as configurações.' });
      await refreshSide();
    })();
    return () => {
      alive = false;
    };
  }, [ai, adopt, refreshSide]);

  const run = async (label: string, req: AdminRequest, after?: (r: AdminResult) => void) => {
    setBusy(label);
    setMsg(null);
    try {
      const r = await ai.send(req);
      if (r.body.view) adopt(r.body.view);
      if (r.body.error) setMsg({ kind: 'error', text: r.body.error });
      else if (r.body.message) setMsg({ kind: 'ok', text: r.body.message });
      after?.(r);
      await refreshSide();
    } finally {
      setBusy(null);
    }
  };

  if (allowed === null) return <main className="page"><div className="center-fill"><Spinner /></div></main>;
  if (!allowed) {
    return (
      <main className="page">
        <StatePanel title="Sem acesso" actions={<Link to="/" className="btn btn-primary">Ir para os projetos</Link>}>
          As Configurações de IA são geridas pelos administradores do Bolt IA.
        </StatePanel>
      </main>
    );
  }
  if (!view) {
    return (
      <main className="page">
        {msg ? <div className="notice notice-error" role="alert">{msg.text}</div> : <div className="center-fill"><Spinner /></div>}
      </main>
    );
  }

  const s = view.settings;
  const version = s.version;
  const editKeyValid = s.keys[s.provider].status === 'valid';
  const route = routing(view);
  const editGen = validatedAt(generation, s.provider, s.model, 'edit');

  const saveLimits = () => {
    const patch: Record<string, number> = {};
    for (const f of LIMIT_FIELDS) {
      const n = Number(limits[f.key]);
      if (Number.isFinite(n) && n !== s[f.key]) patch[f.key] = n;
    }
    if (Object.keys(patch).length === 0) {
      setMsg({ kind: 'ok', text: 'Sem alterações nos limites.' });
      return;
    }
    void run('limits', { action: 'update', expectedVersion: version, patch });
  };

  return (
    <main className="page ai-settings" data-testid="ai-settings">
      <div className="page-head">
        <div>
          <h1>Configurações de IA</h1>
          <p>Configuração central do Bolt IA, gerida pelos administradores. Aplica-se a todos os workspaces.</p>
        </div>
        <div className="page-actions">
          <span className="ai-admin-badge" title="Cada alteração é verificada no servidor.">
            <ShieldCheck aria-hidden="true" /> Administrador
          </span>
        </div>
      </div>

      {ai.simulated && (
        <div className="notice" role="note" data-testid="ai-settings-simulated">
          <AlertTriangle aria-hidden="true" />
          <div>
            <strong>Simulação local.</strong> Sem servidor configurado, este painel usa a mesma lógica da função <code>ai-admin</code> em memória: nenhuma chave é enviada a um fornecedor nem guardada, e tudo se perde ao recarregar. Chaves com «invalida» são recusadas pelo fornecedor simulado.
          </div>
        </div>
      )}
      {msg && (
        <div className={`notice ${msg.kind === 'error' ? 'notice-error' : 'notice-ok'}`} role={msg.kind === 'error' ? 'alert' : 'status'} data-testid="ai-settings-message">
          {msg.kind === 'error' ? <AlertTriangle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
          <div>{msg.text}</div>
        </div>
      )}

      <div className="ai-settings-layout">
        <div className="ai-settings-main">
          <Section step={1} title="Fornecedores e chaves" testId="ai-settings-keys">
            <p className="hint">
              Pode guardar a chave de qualquer fornecedor (fica cifrada no cofre do servidor) e ativar os que quiser usar. Vários podem estar ativos ao mesmo tempo: o
              assistente usa o melhor para cada função (passo 2). Só aparecem fornecedores com integração implementada.
            </p>
            <div className="ai-providers">
              {SUPPORTED_PROVIDERS.map((p) => (
                <ProviderCard
                  key={p.id}
                  provider={p.id}
                  view={view}
                  busy={busy}
                  generation={generation}
                  onRun={run}
                  onRemove={() => setConfirmRemove(p.id)}
                />
              ))}
            </div>
          </Section>

          <Section step={2} title="Como o assistente escolhe" testId="ai-settings-routing">
            <p className="hint">
              Para cada função, o servidor usa o melhor fornecedor <strong>ativo</strong> com a chave reconhecida, pela ordem abaixo. Se um fornecedor for desativado ou a chave
              falhar num teste, passa para o ativo seguinte. Não muda a meio de um pedido.
            </p>
            <div className="ai-routing">
              {(['edit', 'image'] as const).map((cap) => {
                const current = cap === 'edit' ? route.edit : route.image;
                const order = view.models.filter((m) => m.capability === cap && typeof m.preference === 'number').sort((x, y) => (x.preference ?? 0) - (y.preference ?? 0));
                return (
                  <div key={cap} className="ai-routing-item" data-testid={`ai-route-${cap}`}>
                    <strong>{cap === 'edit' ? 'Edição de textos e estilos' : 'Geração de imagens'}</strong>
                    <p className={current ? 'ai-route-on' : 'ai-route-off'}>
                      {current ? `Em uso: ${current.label} (${PROVIDER_LABEL[current.provider]})` : cap === 'edit' ? 'Indisponível: ative um fornecedor com a chave reconhecida.' : 'Indisponível: ative a Google (Gemini) com a chave reconhecida.'}
                    </p>
                    <ol className="hint">
                      {order.map((m) => (
                        <li key={m.model}>
                          {m.label} ({PROVIDER_LABEL[m.provider]})
                          {s.keys[m.provider].enabled ? (s.keys[m.provider].status === 'valid' ? '' : ' · chave por reconhecer') : ' · fornecedor inativo'}
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section step={3} title="Limites e orçamento" testId="ai-settings-limits">
            <div className="ai-limits">
              {LIMIT_FIELDS.map((f) => (
                <label key={f.key} className="field">
                  <span>{f.label}</span>
                  <input
                    className="input"
                    type="number"
                    step={f.step ?? '1'}
                    min={0}
                    value={limits[f.key] ?? ''}
                    onChange={(e) => setLimits({ ...limits, [f.key]: e.target.value })}
                    disabled={busy !== null}
                    data-testid={`ai-limit-${f.key}`}
                  />
                  {f.hint && <small className="hint">{f.hint}</small>}
                </label>
              ))}
            </div>
            <Button disabled={busy !== null} onClick={saveLimits} data-testid="ai-limits-save">
              Guardar limites
            </Button>
          </Section>
        </div>
        <aside className="ai-settings-side" aria-label="Estado, consumo e registo">
          <Section title="Estado do assistente" testId="ai-settings-state">
            <p className={`ai-state ${s.enabled ? 'is-on' : 'is-off'}`} data-testid="ai-enabled">
              {s.enabled ? 'Assistente ativo' : 'Assistente desativado'}
            </p>
            <p className="hint">
              {s.enabled
                ? 'Ativo porque há pelo menos um fornecedor ativo para edição. Desativar todos os fornecedores bloqueia de imediato novos pedidos, mesmo em sessões já abertas.'
                : 'Ative um fornecedor (com a chave reconhecida) para ligar o assistente.'}
            </p>
            <dl className="ai-checks">
              <div data-testid="ai-check-key">
                <dt>Credenciais ({PROVIDER_LABEL[s.provider]})</dt>
                <dd>
                  {editKeyValid
                    ? `Reconhecidas${s.keys[s.provider].tested_at ? ` em ${formatDateTime(s.keys[s.provider].tested_at ?? '')}` : ''}, sem gerar nada.`
                    : 'Por verificar.'}
                </dd>
              </div>
              <div data-testid="ai-check-generation">
                <dt>Geração ({view.models.find((m) => m.provider === s.provider && m.model === s.model)?.label ?? s.model})</dt>
                <dd>
                  {editGen
                    ? `Validada em ${formatDateTime(editGen.at)}: um pedido real devolveu uma proposta válida.`
                    : 'Por validar: o teste de ligação não gera texto. Só um pedido real bem-sucedido com este modelo a comprova.'}
                </dd>
              </div>
            </dl>
            {s.updated_by_email && (
              <p className="hint" data-testid="ai-settings-updated">
                Última alteração: {formatDateTime(s.updated_at)} por {s.updated_by_email}.
              </p>
            )}
          </Section>
          <Section title="Consumo do mês" testId="ai-settings-usage" action={<Button variant="ghost" onClick={() => void refreshSide()} aria-label="Atualizar consumo"><RefreshCw aria-hidden="true" /></Button>}>
            {usage ? (
              <dl className="ai-usage">
                <Stat label="Consumo confirmado" value={usd(usage.confirmed_usd)} hint="Tokens ou tarifas indicados pelo fornecedor." testId="ai-usage-confirmed" />
                <Stat label="Estimado (consumo desconhecido)" value={usd(usage.unknown_usd)} hint={`Contado pelo máximo reservado (${usage.unknown_attempts} tentativa(s)).`} testId="ai-usage-unknown" />
                <Stat label="Reservado (em curso)" value={usd(usage.reserved_usd)} hint={`${usage.in_flight} pedido(s) por acertar.`} testId="ai-usage-reserved" />
                <Stat label="Imagens" value={usd(usage.image_usd)} hint="Incluído no total; conta mesmo que a imagem seja descartada." testId="ai-usage-images" />
                <Stat label="Orçamento restante" value={usd(Math.max(0, usage.budget_usd - usage.confirmed_usd - usage.unknown_usd - usage.reserved_usd))} hint={`De ${usd(usage.budget_usd)} · ${usage.requests} pedido(s) em ${usage.month}.`} testId="ai-usage-remaining" />
              </dl>
            ) : (
              <Spinner />
            )}
          </Section>
          <Section title="Registo de alterações" testId="ai-settings-audit">
            {audit.length === 0 ? (
              <p className="hint">Sem alterações registadas.</p>
            ) : (
              <ol className="ai-audit" data-testid="ai-audit-list">
                {audit.map((a, i) => (
                  <li key={`${a.at}-${i}`} data-testid="ai-audit-entry">
                    <strong>{ACTION_LABEL[a.action] ?? a.action}</strong>
                    <span>{describeChanges(a.changes)}</span>
                    <small>
                      {formatDateTime(a.at)} · {a.actor_email ?? '—'}
                    </small>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </aside>
      </div>

      <Modal
        open={confirmRemove !== null}
        title={confirmRemove ? `Remover a chave ${PROVIDER_LABEL[confirmRemove]}?` : ''}
        onClose={() => setConfirmRemove(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const p = confirmRemove;
                setConfirmRemove(null);
                if (p) void run('remove', { action: 'removeKey', provider: p, expectedVersion: version });
              }}
              data-testid="ai-key-remove-confirm"
            >
              Remover
            </Button>
          </>
        }
      >
        {confirmRemove && (
          <p style={{ margin: 0 }}>
            A chave {PROVIDER_LABEL[confirmRemove]} (…{s.keys[confirmRemove].last4}) é apagada do cofre. As chaves dos outros fornecedores mantêm-se. Se este fornecedor estiver em uso (edição ou imagens), esse uso fica desativado.
          </p>
        )}
      </Modal>
    </main>
  );
}

/** Resultado de guardar ou testar uma chave, mostrado NO PRÓPRIO CARTÃO (sucesso ou não). */
type CardNote = { kind: 'ok' | 'error'; text: string };

function resultNote(r: AdminResult): CardNote | null {
  const t = r.body.test;
  if (t) return { kind: t.ok ? 'ok' : 'error', text: `${t.ok ? 'Teste com sucesso' : 'Teste sem sucesso'}: ${t.message} ${t.cost}` };
  if (r.body.error) return { kind: 'error', text: r.body.error };
  if (r.body.message) return { kind: 'ok', text: r.body.message };
  return null;
}

/** Chave, teste e estado de UM fornecedor. */
function ProviderCard({
  provider,
  view,
  busy,
  generation,
  onRun,
  onRemove,
}: {
  provider: ProviderId;
  view: AdminView;
  busy: string | null;
  generation: AdminGeneration | null;
  onRun: (label: string, req: AdminRequest, after?: (r: AdminResult) => void) => Promise<void>;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState('');
  /** Cloudflare: o Account ID (não é secreto) vai junto com o token, como «ACCOUNT_ID:TOKEN». */
  const [accountId, setAccountId] = useState('');
  const cloudflare = provider === 'cloudflare';
  const [note, setNote] = useState<CardNote | null>(null);
  const k = view.settings.keys[provider];
  const route = routing(view);
  const uses = [route.edit?.provider === provider ? `edição (${route.edit.label})` : null, route.image?.provider === provider ? `imagens (${route.image.label})` : null].filter(Boolean);
  const active = k.enabled === true;
  const gen = validatedAt(generation, provider);
  const models = view.models.filter((m) => m.provider === provider);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const token = draft.trim();
    const account = accountId.trim();
    if (cloudflare && !/^[0-9a-f]{32}$/i.test(account)) {
      setNote({ kind: 'error', text: 'O Account ID tem 32 caracteres (letras a–f e números): copie-o da página inicial da conta Cloudflare.' });
      return;
    }
    const key = cloudflare ? `${account}:${token}` : token;
    if (token.length < 20 || /\s/.test(token)) {
      setNote({ kind: 'error', text: cloudflare ? 'O token parece incompleto ou tem espaços: cole o token completo, tal como a Cloudflare o mostra.' : 'A chave parece incompleta ou tem espaços: cole a chave completa, tal como o fornecedor a mostra.' });
      return;
    }
    // O campo é limpo já: a chave não fica no estado da página depois de enviada.
    setDraft('');
    setNote(null);
    void onRun(`key-${provider}`, { action: 'setKey', provider, key }, (r) => setNote(resultNote(r)));
  };

  return (
    <article className="ai-provider-card" aria-label={PROVIDER_LABEL[provider]} data-testid={`ai-provider-${provider}`}>
      <header className="ai-provider-head">
        <strong>{PROVIDER_LABEL[provider]}</strong>
        <span className="hint">
          {models.some((m) => m.capability === 'edit') && (
            <>
              <Sparkles aria-hidden="true" /> edição
            </>
          )}
          {models.some((m) => m.capability === 'image') && (
            <>
              {' '}
              <ImageIcon aria-hidden="true" /> imagens
            </>
          )}
        </span>
      </header>
      <div className={`ai-key-status ${k.configured ? (k.status === 'valid' ? 'is-ok' : 'is-bad') : ''}`} data-testid={`ai-key-status-${provider}`}>
        <KeyRound aria-hidden="true" />
        {k.configured ? (
          <div>
            <strong>{k.status === 'valid' ? 'Chave configurada' : 'Chave recusada no último teste'}</strong>
            <span>
              …{k.last4} · impressão {k.fingerprint}
            </span>
          </div>
        ) : (
          <div>
            <strong>Sem chave</strong>
            <span>Cole a chave abaixo e clique «Guardar chave»; depois pode ativar este fornecedor.</span>
          </div>
        )}
      </div>
      <label className={`ai-toggle ai-provider-toggle ${k.status === 'valid' ? '' : 'is-disabled'}`}>
        <input
          type="checkbox"
          checked={active}
          disabled={busy !== null || (k.status !== 'valid' && !active)}
          onChange={(e) => void onRun(`enable-${provider}`, { action: 'setEnabled', provider, enabled: e.target.checked })}
          data-testid={`ai-provider-enabled-${provider}`}
        />
        <span>{active ? 'Ativo' : 'Inativo'}</span>
        <small className="hint">
          {k.status !== 'valid'
            ? 'Guarde (ou teste) a chave para poder ativar.'
            : active
              ? uses.length
                ? `Em uso: ${uses.join(' e ')}.`
                : 'Ativo, de reserva: outro fornecedor ativo tem prioridade.'
              : 'Ative para o assistente poder usar este fornecedor.'}
        </small>
      </label>
      <dl className="ai-checks">
        <div data-testid={`ai-cred-${provider}`}>
          <dt>Credenciais</dt>
          <dd>{k.status === 'valid' ? `Reconhecidas${k.tested_at ? ` em ${formatDateTime(k.tested_at)}` : ''} (sem gerar nada).` : k.status === 'invalid' ? 'Recusadas no último teste.' : 'Por verificar.'}</dd>
        </div>
        <div data-testid={`ai-gen-${provider}`}>
          <dt>Geração</dt>
          <dd>{gen ? `Validada em ${formatDateTime(gen.at)} (${gen.model}).` : 'Por validar: nenhuma utilização real bem-sucedida.'}</dd>
        </div>
      </dl>
      <form className="ai-key-form" onSubmit={save}>
        {cloudflare && (
          <>
            <p className="hint" data-testid="ai-cloudflare-help">
              Gera as imagens de graça (cerca de 170 por dia) e passa a ser usada sozinha para as imagens assim que a credencial for reconhecida. Na Cloudflare:
              «Workers AI» → «Use REST API»: copie o «Account ID» e clique «Create a Workers AI API Token» → «Create API Token» → «Copy API Token» (o token só é mostrado uma vez).
            </p>
            <label className="field">
              <span>Account ID</span>
              <input
                className="input"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="32 caracteres, ex.: 0123456789abcdef0123456789abcdef"
                disabled={busy !== null}
                data-testid="ai-account-input-cloudflare"
              />
            </label>
          </>
        )}
        <label className="field">
          <span>{cloudflare ? (k.configured ? 'Substituir por um token novo' : 'API Token') : k.configured ? 'Substituir por uma chave nova' : 'Chave de API'}</span>
          <input
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Cole aqui a chave; nunca é mostrada de volta"
            disabled={busy !== null}
            data-testid={`ai-key-input-${provider}`}
          />
        </label>
        <div className="ai-key-actions">
          <Button type="submit" variant="primary" disabled={busy !== null || draft.trim().length === 0 || (cloudflare && accountId.trim().length === 0)} data-testid={`ai-key-save-${provider}`}>
            {busy === `key-${provider}` ? 'A verificar…' : k.configured ? (cloudflare ? 'Substituir token' : 'Substituir chave') : cloudflare ? 'Guardar token' : 'Guardar chave'}
          </Button>
          <Button
            disabled={busy !== null || !k.configured}
            onClick={() => {
              setNote(null);
              void onRun(`test-${provider}`, { action: 'test', provider }, (r) => setNote(resultNote(r)));
            }}
            data-testid={`ai-key-test-${provider}`}
            title={TEST_COST_NOTE}
          >
            <PlugZap aria-hidden="true" /> {busy === `test-${provider}` ? 'A testar…' : 'Testar ligação (sem custo)'}
          </Button>
          <Button variant="ghost" disabled={busy !== null || !k.configured} onClick={onRemove} data-testid={`ai-key-remove-${provider}`}>
            <Trash2 aria-hidden="true" /> Remover
          </Button>
        </div>
        {busy === `key-${provider}` || busy === `test-${provider}` ? (
          <p className="hint" role="status" data-testid={`ai-key-testing-${provider}`}>
            A testar a ligação com {PROVIDER_LABEL[provider]}…
          </p>
        ) : (
          note && (
            <div className={`notice ${note.kind === 'ok' ? 'notice-ok' : 'notice-error'} ai-key-note`} role={note.kind === 'ok' ? 'status' : 'alert'} data-testid={`ai-key-test-result-${provider}`} data-kind={note.kind}>
              {note.kind === 'ok' ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
              <span>{note.text}</span>
            </div>
          )
        )}
      </form>
      {provider === 'google' && k.configured && <GeminiDiagnosis busy={busy} onRun={onRun} />}
    </article>
  );
}

/**
 * Diagnóstico progressivo do pedido ao Gemini (HTTP 400 «invalid argument»): o servidor envia do
 * pedido mínimo ao pedido real, um elemento de cada vez, e pára no primeiro recusado. É PAGO (os
 * degraus aceites consomem tokens), com teto verificado no servidor; só corre com autorização
 * explícita nesta página. A chave nunca sai do servidor.
 */
function GeminiDiagnosis({ busy, onRun }: { busy: string | null; onRun: (label: string, req: AdminRequest, after?: (r: AdminResult) => void) => Promise<void> }) {
  const [agree, setAgree] = useState(false);
  const [report, setReport] = useState<AdminDiagnosis | null>(null);
  return (
    <details className="ai-diagnosis" data-testid="ai-diagnosis">
      <summary>Diagnóstico do pedido (pago, até {DIAG_MAX_USD.toLocaleString('pt-PT')} USD)</summary>
      <p className="hint">
        Envia ao Gemini (modelo de edição mais barato) até 14 pedidos, do mais simples ao pedido real do assistente (com um projeto anónimo), e pára no primeiro recusado. Os pedidos aceites
        consomem tokens; o custo total nunca passa de {DIAG_MAX_USD.toLocaleString('pt-PT')} USD.
      </p>
      <label className="ai-toggle">
        <input type="checkbox" checked={agree} disabled={busy !== null} onChange={(e) => setAgree(e.target.checked)} data-testid="ai-diagnosis-agree" />
        <span>Autorizo este diagnóstico pago (até {DIAG_MAX_USD.toLocaleString('pt-PT')} USD)</span>
      </label>
      <Button
        disabled={busy !== null || !agree}
        onClick={() =>
          void onRun('diagnose-google', { action: 'diagnose', provider: 'google', maxUsd: DIAG_MAX_USD }, (r) => {
            setAgree(false);
            setReport(r.body.diagnosis ?? null);
          })
        }
        data-testid="ai-diagnosis-run"
      >
        {busy === 'diagnose-google' ? 'A diagnosticar…' : 'Executar diagnóstico'}
      </Button>
      {report && (
        <div className="ai-diagnosis-report" data-testid="ai-diagnosis-report">
          <p>
            <strong>
              {report.culprit && report.fixValidated
                ? `Causa encontrada: o Gemini recusa «${report.culprit}»; sem isso, o pedido real do assistente foi aceite.`
                : report.culprit
                  ? `Causa provável: o Gemini recusa «${report.culprit}» (o pedido real sem isso não chegou a ser confirmado).`
                  : report.firstRejected
                ? `Primeiro pedido recusado: ${report.steps.find((x) => x.id === report.firstRejected)?.label ?? report.firstRejected}`
                : report.stoppedForBudget
                  ? 'Parado pelo teto de custo.'
                  : report.steps.length > 0 && report.steps[report.steps.length - 1]?.accepted !== true
                    ? 'Interrompido antes do fim (falha temporária do fornecedor): execute de novo dentro de alguns minutos.'
                    : 'Nenhum pedido recusado: o pedido real foi aceite.'}
            </strong>{' '}
            Modelo {report.model} · custo {report.costUsd.toFixed(6)} USD
          </p>
          <ol>
            {report.steps.map((st) => (
              <li key={st.id} className={st.accepted ? 'is-ok' : 'is-bad'}>
                {st.label}: {st.http === null ? 'não enviado' : `HTTP ${st.http}`} — {st.detail}
              </li>
            ))}
          </ol>
        </div>
      )}
    </details>
  );
}

function Section({ title, testId, children, action, step }: { title: string; testId: string; children: ReactNode; action?: ReactNode; step?: number }) {
  return (
    <section className="ai-settings-card" data-testid={testId} aria-label={title}>
      <div className="ai-settings-card-head">
        <h2>
          {step !== undefined && (
            <span className="ai-step" aria-hidden="true">
              {step}
            </span>
          )}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, hint, testId }: { label: string; value: string; hint: string; testId: string }) {
  return (
    <div className="ai-stat" data-testid={testId}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      <small className="hint">{hint}</small>
    </div>
  );
}
