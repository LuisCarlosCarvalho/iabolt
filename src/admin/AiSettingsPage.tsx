import { AlertTriangle, CheckCircle2, ImageIcon, KeyRound, PlugZap, RefreshCw, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  SUPPORTED_PROVIDERS,
  TEST_COST_NOTE,
  type AdminAuditEntry,
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
  const [editProvider, setEditProvider] = useState<ProviderId>('anthropic');
  const [model, setModel] = useState('');
  const [imageProvider, setImageProvider] = useState<ProviderId | ''>('');
  const [imageModel, setImageModel] = useState('');
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [confirmRemove, setConfirmRemove] = useState<ProviderId | null>(null);

  const adopt = useCallback((v: AdminView) => {
    setView(v);
    setEditProvider(v.settings.provider);
    setModel(v.settings.model);
    setImageProvider(v.settings.image_provider ?? '');
    setImageModel(v.settings.image_model ?? '');
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
  const imageKeyValid = s.image_provider ? s.keys[s.image_provider].status === 'valid' : false;
  const editModels = view.models.filter((m) => m.capability === 'edit' && m.provider === editProvider);
  const imageProviders = SUPPORTED_PROVIDERS.filter((p) => view.models.some((m) => m.capability === 'image' && m.provider === p.id));
  const imageModels = view.models.filter((m) => m.capability === 'image' && m.provider === imageProvider);
  const selectedModel = view.models.find((m) => m.provider === editProvider && m.model === model);
  const selectedImage = view.models.find((m) => m.provider === imageProvider && m.model === imageModel);
  const editGen = validatedAt(generation, s.provider, s.model, 'edit');
  const imageGen = s.image_provider && s.image_model ? validatedAt(generation, s.image_provider, s.image_model, 'image') : null;

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
              Cada fornecedor tem a sua chave, guardada cifrada no cofre do servidor. Trocar o fornecedor em uso não apaga as outras chaves. Só aparecem fornecedores com integração implementada.
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

          <Section step={2} title="Edição (assistente)" testId="ai-settings-model">
            <div className="ai-row2">
              <label className="field">
                <span>Fornecedor</span>
                <select
                  className="select"
                  value={editProvider}
                  onChange={(e) => {
                    const next = SUPPORTED_PROVIDERS.find((x) => x.id === e.target.value)?.id ?? 'anthropic';
                    setEditProvider(next);
                    setModel(view.models.find((m) => m.provider === next && m.capability === 'edit')?.model ?? '');
                  }}
                  disabled={busy !== null}
                  data-testid="ai-provider"
                >
                  {SUPPORTED_PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {s.keys[p.id].status === 'valid' ? '' : ' (sem chave reconhecida)'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Modelo de edição</span>
                <select className="select" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy !== null} data-testid="ai-model">
                  {editModels.map((m) => (
                    <option key={m.model} value={m.model}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="hint">
              {selectedModel && (
                <span data-testid="ai-model-prices">
                  Preços (USD por milhão de tokens): entrada {selectedModel.prices.input} · saída {selectedModel.prices.output} · cache {selectedModel.prices.cacheRead}. Usados nas reservas seguintes.
                  {selectedModel.note ? ` ${selectedModel.note}` : ''}
                </span>
              )}
            </p>
            {editProvider !== s.provider && s.keys[editProvider].status !== 'valid' && (
              <p className="hint" data-testid="ai-provider-needs-key">
                Este fornecedor ainda não tem uma chave reconhecida: pode escolhê-lo, mas o assistente só é ativado depois de configurar e reconhecer a chave (passo 1).
              </p>
            )}
            <Button
              disabled={busy !== null || !model || (editProvider === s.provider && model === s.model)}
              onClick={() =>
                void run('model', {
                  action: 'update',
                  expectedVersion: version,
                  // Mudar para um fornecedor sem chave reconhecida desativa o assistente (nunca aponta para uma chave má).
                  patch: { provider: editProvider, model, ...(s.enabled && s.keys[editProvider].status !== 'valid' ? { enabled: false } : {}) },
                })
              }
              data-testid="ai-model-save"
            >
              Guardar fornecedor e modelo
            </Button>
          </Section>

          <Section step={3} title="Geração de imagens" testId="ai-settings-images">
            {imageProviders.length === 0 ? (
              <p className="hint">Nenhum modelo de imagens suportado.</p>
            ) : (
              <>
                <div className="ai-row2">
                  <label className="field">
                    <span>Fornecedor de imagens</span>
                    <select
                      className="select"
                      value={imageProvider}
                      onChange={(e) => {
                        const next = imageProviders.find((x) => x.id === e.target.value)?.id ?? '';
                        setImageProvider(next);
                        setImageModel(view.models.find((m) => m.provider === next && m.capability === 'image')?.model ?? '');
                      }}
                      disabled={busy !== null}
                      data-testid="ai-image-provider"
                    >
                      <option value="">— Nenhum —</option>
                      {imageProviders.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                          {s.keys[p.id].status === 'valid' ? '' : ' (sem chave reconhecida)'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Modelo de imagens</span>
                    <select className="select" value={imageModel} onChange={(e) => setImageModel(e.target.value)} disabled={busy !== null || !imageProvider} data-testid="ai-image-model">
                      {imageModels.map((m) => (
                        <option key={m.model} value={m.model}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {selectedImage && (
                  <p className="hint" data-testid="ai-image-price">
                    Custo por imagem: {usd(selectedImage.price_image ?? 0)} (tarifa publicada; o utilizador vê este valor e confirma antes de cada geração). {selectedImage.note ?? ''}
                  </p>
                )}
                <div className="ai-key-actions">
                  <Button
                    disabled={busy !== null || (imageProvider === (s.image_provider ?? '') && imageModel === (s.image_model ?? ''))}
                    onClick={() =>
                      void run('image-model', {
                        action: 'update',
                        expectedVersion: version,
                        patch: imageProvider
                          ? { image_provider: imageProvider, image_model: imageModel, ...(s.image_enabled && s.keys[imageProvider].status !== 'valid' ? { image_enabled: false } : {}) }
                          : { image_provider: null, image_model: null, image_enabled: false },
                      })
                    }
                    data-testid="ai-image-save"
                  >
                    Guardar modelo de imagens
                  </Button>
                  <label className={`ai-toggle ${imageKeyValid ? '' : 'is-disabled'}`}>
                    <input
                      type="checkbox"
                      checked={s.image_enabled}
                      disabled={busy !== null || (!imageKeyValid && !s.image_enabled) || !s.image_model}
                      onChange={(e) => void run('image-enabled', { action: 'update', expectedVersion: version, patch: { image_enabled: e.target.checked } })}
                      data-testid="ai-image-enabled"
                    />
                    <span>{s.image_enabled ? 'Geração de imagens ativa' : 'Geração de imagens desativada'}</span>
                  </label>
                </div>
                {/* Credencial: uma chave por fornecedor (passo 1), partilhada pela edição e pelas imagens. */}
                <p className="hint" data-testid="ai-image-credential">
                  {!imageProvider
                    ? 'Credencial: escolha primeiro o fornecedor de imagens.'
                    : s.keys[imageProvider].status === 'valid'
                      ? `Credencial: usa a chave ${PROVIDER_LABEL[imageProvider]} já guardada no passo 1 (reconhecida)${imageProvider === s.provider ? ', a mesma da edição' : ''}. Não é preciso outra chave.`
                      : s.keys[imageProvider].configured
                        ? `Credencial: a chave ${PROVIDER_LABEL[imageProvider]} do passo 1 foi recusada no último teste. Substitua-a no cartão ${PROVIDER_LABEL[imageProvider]} (passo 1) e teste-a.`
                        : `Credencial em falta: guarde a chave ${PROVIDER_LABEL[imageProvider]} no cartão ${PROVIDER_LABEL[imageProvider]} do passo 1 (fica cifrada no cofre do servidor). Depois guarde o modelo e ative a geração aqui.`}
                </p>
                <p className="hint" data-testid="ai-image-generation">
                  {imageGen ? `Geração de imagens validada em ${formatDateTime(imageGen.at)} com este modelo.` : 'Geração de imagens por validar: só uma imagem real gerada com este modelo a comprova.'}
                </p>
              </>
            )}
          </Section>

          <Section step={4} title="Limites e orçamento" testId="ai-settings-limits">
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
            <label className={`ai-toggle ${editKeyValid ? '' : 'is-disabled'}`}>
              <input
                type="checkbox"
                checked={s.enabled}
                disabled={busy !== null || (!editKeyValid && !s.enabled)}
                onChange={(e) => void run('enabled', { action: 'update', expectedVersion: version, patch: { enabled: e.target.checked } })}
                data-testid="ai-enabled"
              />
              <span>{s.enabled ? 'Assistente ativo' : 'Assistente desativado'}</span>
            </label>
            <p className="hint">
              {editKeyValid
                ? 'Desativar bloqueia de imediato novos pedidos, mesmo em sessões já abertas.'
                : `Desativado. Só pode ser ativado com a chave ${PROVIDER_LABEL[s.provider]} reconhecida.`}
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
  const [note, setNote] = useState<string | null>(null);
  const k = view.settings.keys[provider];
  const s = view.settings;
  const uses = [s.provider === provider ? 'edição' : null, s.image_provider === provider ? 'imagens' : null].filter(Boolean);
  const gen = validatedAt(generation, provider);
  const models = view.models.filter((m) => m.provider === provider);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const key = draft.trim();
    // O campo é limpo já: a chave não fica no estado da página depois de enviada.
    setDraft('');
    setNote(null);
    void onRun(`key-${provider}`, { action: 'setKey', provider, key }, (r) => setNote(r.body.test ? `${r.body.test.message} ${r.body.test.cost}` : null));
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
          {uses.length > 0 && <> · em uso: {uses.join(' e ')}</>}
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
            <span>Nada deste fornecedor pode ser ativado.</span>
          </div>
        )}
      </div>
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
        <label className="field">
          <span>{k.configured ? 'Substituir por uma chave nova' : 'Chave de API'}</span>
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
          <Button type="submit" variant="primary" disabled={busy !== null || draft.trim().length < 20} data-testid={`ai-key-save-${provider}`}>
            {busy === `key-${provider}` ? 'A verificar…' : k.configured ? 'Substituir chave' : 'Guardar chave'}
          </Button>
          <Button
            disabled={busy !== null || !k.configured}
            onClick={() => void onRun(`test-${provider}`, { action: 'test', provider }, (r) => setNote(r.body.test ? `${r.body.test.message} ${r.body.test.cost}` : null))}
            data-testid={`ai-key-test-${provider}`}
            title={TEST_COST_NOTE}
          >
            <PlugZap aria-hidden="true" /> {busy === `test-${provider}` ? 'A testar…' : 'Testar ligação (sem custo)'}
          </Button>
          <Button variant="ghost" disabled={busy !== null || !k.configured} onClick={onRemove} data-testid={`ai-key-remove-${provider}`}>
            <Trash2 aria-hidden="true" /> Remover
          </Button>
        </div>
        {note && (
          <p className="hint" data-testid={`ai-key-test-result-${provider}`}>
            {note}
          </p>
        )}
      </form>
    </article>
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
