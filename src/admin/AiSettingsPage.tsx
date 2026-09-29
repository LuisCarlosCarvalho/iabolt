import { AlertTriangle, CheckCircle2, KeyRound, PlugZap, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  SUPPORTED_PROVIDERS,
  TEST_COST_NOTE,
  type AdminAuditEntry,
  type AdminRequest,
  type AdminResult,
  type AdminUsage,
  type AdminView,
  type SettingsPatch,
} from '../../supabase/functions/_shared/ai/admin.ts';
import { Link } from '../app/router';
import { useServices } from '../app/services';
import { Button, formatDateTime, Modal, Spinner, StatePanel } from '../app/ui';

/**
 * Painel «Configurações de IA»: configuração CENTRAL do Bolt IA (aplica-se a todos os workspaces),
 * gerida pelos administradores da plataforma. Esconder esta página não é a proteção: cada ação é
 * verificada no servidor (função ai-admin). A chave só é enviada quando é introduzida ou
 * substituída; o campo é limpo logo a seguir e o servidor nunca a devolve.
 */
type Msg = { kind: 'ok' | 'error'; text: string } | null;

const LIMIT_FIELDS: ReadonlyArray<{ key: keyof SettingsPatch & keyof AdminView['settings']; label: string; step?: string; hint?: string }> = [
  { key: 'monthly_budget_usd', label: 'Orçamento mensal (USD)', step: '0.01', hint: 'Teto aplicado antes de cada chamada, com reserva do custo máximo.' },
  { key: 'requests_per_user_day', label: 'Pedidos por pessoa por dia' },
  { key: 'requests_per_workspace_day', label: 'Pedidos por workspace por dia' },
  { key: 'max_concurrent_per_user', label: 'Pedidos simultâneos por pessoa' },
  { key: 'max_concurrent_per_workspace', label: 'Pedidos simultâneos por workspace' },
  { key: 'max_output_tokens', label: 'Máximo de tokens de saída' },
  { key: 'max_operations', label: 'Máximo de operações por proposta' },
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
  enabled: 'Ativo',
  model: 'Modelo',
  provider: 'Fornecedor',
  chave: 'Chave',
  resultado: 'Resultado',
  motivo: 'Motivo',
  detalhe: 'Detalhe',
  assistente: 'Assistente',
  ...Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, f.label])),
};
const show = (v: unknown) => (v === true ? 'sim' : v === false ? 'não' : v === null || v === undefined ? '—' : String(v));

function describeChanges(changes: Record<string, unknown>): string {
  return Object.entries(changes)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => {
      const label = FIELD_LABEL[k] ?? k;
      if (v && typeof v === 'object' && 'para' in v) return `${label}: ${show(Reflect.get(v, 'de'))} → ${show(Reflect.get(v, 'para'))}`;
      return `${label}: ${show(v)}`;
    })
    .join(' · ');
}

export function AiSettingsPage() {
  const { ai } = useServices();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [view, setView] = useState<AdminView | null>(null);
  const [usage, setUsage] = useState<AdminUsage | null>(null);
  const [audit, setAudit] = useState<AdminAuditEntry[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [model, setModel] = useState('');
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);

  const adopt = useCallback((v: AdminView) => {
    setView(v);
    setModel(v.settings.model);
    setLimits(Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, String(v.settings[f.key])])));
  }, []);

  const refreshSide = useCallback(async () => {
    const [u, a] = await Promise.all([ai.send({ action: 'usage' }), ai.send({ action: 'audit' })]);
    if (u.body.usage) setUsage(u.body.usage);
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
  const keyValid = s.key.configured && s.key.status === 'valid';
  const selectedModel = view.models.find((m) => m.model === model);

  const saveKey = (e: FormEvent) => {
    e.preventDefault();
    const key = keyDraft.trim();
    // O campo é limpo já: a chave não fica no estado da página depois de enviada.
    setKeyDraft('');
    setTestNote(null);
    void run('key', { action: 'setKey', key }, (r) => setTestNote(r.body.test ? `${r.body.test.message} ${r.body.test.cost}` : null));
  };

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
          <Section step={1} title="Chave do fornecedor" testId="ai-settings-key">
            <div className={`ai-key-status ${s.key.configured ? (s.key.status === 'valid' ? 'is-ok' : 'is-bad') : ''}`} data-testid="ai-key-status">
              <KeyRound aria-hidden="true" />
              {s.key.configured ? (
                <div>
                  <strong>{s.key.status === 'valid' ? 'Chave configurada' : 'Chave recusada no último teste'}</strong>
                  <span>
                    …{s.key.last4} · impressão {s.key.fingerprint}
                    {s.key.tested_at ? ` · verificada em ${formatDateTime(s.key.tested_at)}` : ''}
                  </span>
                </div>
              ) : (
                <div>
                  <strong>Sem chave</strong>
                  <span>O assistente não pode ser ativado.</span>
                </div>
              )}
            </div>
            <form className="ai-key-form" onSubmit={saveKey}>
              <label className="field">
                <span>{s.key.configured ? 'Substituir por uma chave nova' : 'Chave de API'}</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder="Cole aqui a chave; nunca é mostrada de volta"
                  disabled={busy !== null}
                  data-testid="ai-key-input"
                />
              </label>
              <p className="hint">A chave nova é verificada sem custo (consulta do modelo) antes de substituir a atual. Se o fornecedor a recusar, mantém-se a anterior.</p>
              <div className="ai-key-actions">
                <Button type="submit" variant="primary" disabled={busy !== null || keyDraft.trim().length < 20} data-testid="ai-key-save">
                  {busy === 'key' ? 'A verificar…' : s.key.configured ? 'Substituir chave' : 'Guardar chave'}
                </Button>
                <Button
                  disabled={busy !== null || !s.key.configured}
                  onClick={() => void run('test', { action: 'test' }, (r) => setTestNote(r.body.test ? `${r.body.test.message} ${r.body.test.cost}` : null))}
                  data-testid="ai-key-test"
                  title={TEST_COST_NOTE}
                >
                  <PlugZap aria-hidden="true" /> {busy === 'test' ? 'A testar…' : 'Testar ligação (sem custo)'}
                </Button>
                <Button variant="ghost" disabled={busy !== null || !s.key.configured} onClick={() => setConfirmRemove(true)} data-testid="ai-key-remove">
                  <Trash2 aria-hidden="true" /> Remover chave
                </Button>
              </div>
              {testNote && (
                <p className="hint" data-testid="ai-key-test-result">
                  {testNote}
                </p>
              )}
            </form>
          </Section>
          <Section step={2} title="Fornecedor e modelo" testId="ai-settings-model">
            <div className="ai-row2">
              <label className="field">
                <span>Fornecedor</span>
                <select className="select" value={s.provider} disabled data-testid="ai-provider">
                  {SUPPORTED_PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Modelo</span>
                <select className="select" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy !== null} data-testid="ai-model">
                  {view.models.map((m) => (
                    <option key={m.model} value={m.model}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="hint">
              Só aparecem fornecedores com integração implementada.
              {selectedModel && (
                <span data-testid="ai-model-prices">
                  {' '}
                  Preços (USD por milhão de tokens): entrada {selectedModel.prices.input} · saída {selectedModel.prices.output} · cache {selectedModel.prices.cacheRead}/{selectedModel.prices.cacheWrite}. Usados nas reservas seguintes.
                </span>
              )}
            </p>
            <Button disabled={busy !== null || model === s.model} onClick={() => void run('model', { action: 'update', expectedVersion: version, patch: { model } })} data-testid="ai-model-save">
              Guardar modelo
            </Button>
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
            <label className={`ai-toggle ${keyValid ? '' : 'is-disabled'}`}>
              <input
                type="checkbox"
                checked={s.enabled}
                disabled={busy !== null || (!keyValid && !s.enabled)}
                onChange={(e) => void run('enabled', { action: 'update', expectedVersion: version, patch: { enabled: e.target.checked } })}
                data-testid="ai-enabled"
              />
              <span>{s.enabled ? 'Assistente ativo' : 'Assistente desativado'}</span>
            </label>
            <p className="hint">
              {keyValid
                ? 'Desativar bloqueia de imediato novos pedidos, mesmo em sessões já abertas.'
                : 'Desativado por omissão. Só pode ser ativado com uma chave reconhecida pelo fornecedor.'}
            </p>
            {s.updated_by_email && (
              <p className="hint" data-testid="ai-settings-updated">
                Última alteração: {formatDateTime(s.updated_at)} por {s.updated_by_email}.
              </p>
            )}
          </Section>
          <Section title="Consumo do mês" testId="ai-settings-usage" action={<Button variant="ghost" onClick={() => void refreshSide()} aria-label="Atualizar consumo"><RefreshCw aria-hidden="true" /></Button>}>
            {usage ? (
              <>
                <dl className="ai-usage">
                  <Stat label="Consumo confirmado" value={usd(usage.confirmed_usd)} hint="Tokens indicados pelo fornecedor." testId="ai-usage-confirmed" />
                  <Stat label="Estimado (consumo desconhecido)" value={usd(usage.unknown_usd)} hint={`Contado pelo máximo reservado (${usage.unknown_attempts} tentativa(s)).`} testId="ai-usage-unknown" />
                  <Stat label="Reservado (em curso)" value={usd(usage.reserved_usd)} hint={`${usage.in_flight} pedido(s) por acertar.`} testId="ai-usage-reserved" />
                  <Stat label="Orçamento restante" value={usd(Math.max(0, usage.budget_usd - usage.confirmed_usd - usage.unknown_usd - usage.reserved_usd))} hint={`De ${usd(usage.budget_usd)} · ${usage.requests} pedido(s) em ${usage.month}.`} testId="ai-usage-remaining" />
                </dl>
              </>
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
        open={confirmRemove}
        title="Remover a chave?"
        onClose={() => setConfirmRemove(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirmRemove(false);
                void run('remove', { action: 'removeKey', expectedVersion: version });
              }}
              data-testid="ai-key-remove-confirm"
            >
              Remover e desativar
            </Button>
          </>
        }
      >
        <p style={{ margin: 0 }}>A chave (…{s.key.last4}) é apagada do cofre e o assistente fica desativado para todos. Pode configurar outra depois.</p>
      </Modal>
    </main>
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
