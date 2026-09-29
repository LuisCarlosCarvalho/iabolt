import type { Editor } from 'grapesjs';
import { AlertTriangle, Check, Info, Maximize2, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AI_CONTRACT_VERSION, AiProposeRequest, type AiDevice, type AiProposeResponse } from '../../supabase/functions/_shared/ai/contract.ts';
import { applyOperations, describeOperations, documentVersion, EDITING_MESSAGE, isEditingText, previewAfter, validateForDocument, type ChangeLine } from '../ai/apply';
import { buildElementContext, capabilitiesOf } from '../ai/context';
import { ServerProposer, SimulatedProposer, type Proposer } from '../ai/proposers';
import type { AiStatus } from '../admin/aiAdminClient';
import { useServices } from '../app/services';
import { Button, Modal, Spinner } from '../app/ui';
import { getProjectData } from '../engine/createBoltEditor';
import { contentHint, displayName } from '../engine/labels';
import { findById } from '../engine/operations';
import { previewDocument } from '../engine/runtime';
import { deviceById, DEVICES, type DeviceId } from '../engine/styles';
import { previewSize, ScaledPreview } from './ScaledPreview';

/**
 * Painel «Assistente IA», versão 1: só o ELEMENTO SELECIONADO, com quatro capacidades (texto,
 * ligação, nível do título, estilos próprios no dispositivo escolhido). Percurso: pedido →
 * proposta validada → antes/depois e lista de alterações → «Aplicar» (um único desfazer) ou
 * «Descartar». Nada é aplicado sem confirmação; qualquer erro deixa o documento como estava.
 */
declare global {
  interface Window {
    /** Só em desenvolvimento: último pedido enviado (os testes E2E verificam o contexto). */
    __boltAiLastRequest?: AiProposeRequest;
  }
}

type Phase =
  | { kind: 'idle'; note?: string }
  | { kind: 'waiting'; ctrl: AbortController }
  | { kind: 'proposal'; request: AiProposeRequest; response: AiProposeResponse; changes: ChangeLine[]; before: string; after: string }
  | { kind: 'error'; message: string; details?: string[] }
  | { kind: 'applied'; count: number };

/**
 * Modo local: simulador. Modo servidor: o assistente real só existe se a configuração central o
 * tiver ativo (ai_status). Mesmo com esta página aberta, desativar no painel bloqueia os pedidos
 * seguintes no servidor.
 */
function useProposer(): Proposer | null {
  const { mode, auth, ai } = useServices();
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    if (mode === 'local') return;
    let alive = true;
    ai.status()
      .then((st) => alive && setStatus(st))
      .catch(() => alive && setStatus({ enabled: false, modelLabel: null }));
    return () => {
      alive = false;
    };
  }, [mode, ai]);
  return useMemo(() => {
    if (mode === 'local') return new SimulatedProposer();
    if (!auth || !status?.enabled) return null;
    return new ServerProposer(auth.client, `${status.modelLabel ?? 'Assistente IA'} · piloto`);
  }, [mode, auth, status]);
}

export function AiAssistantPanel({ editor, projectId, device: editingDevice }: { editor: Editor; projectId: string; device: DeviceId }) {
  const proposer = useProposer();
  const [instruction, setInstruction] = useState('');
  // O dispositivo do assistente acompanha o do editor, salvo escolha própria (válida enquanto o
  // dispositivo do editor não mudar).
  const [override, setOverride] = useState<{ from: DeviceId; value: AiDevice } | null>(null);
  const device: AiDevice = override && override.from === editingDevice ? override.value : editingDevice;
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [view, setView] = useState<'before' | 'after'>('after');
  const [zoomed, setZoomed] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const selected = editor.getSelected();
  const caps = selected ? capabilitiesOf(selected) : null;
  const busy = phase.kind === 'waiting';

  if (!proposer) {
    return (
      <div className="panel-scroll ai-panel" data-testid="ai-panel">
        <div className="panel-title">Assistente IA</div>
        <div className="ai-note" role="note" data-testid="ai-disabled">
          <Info aria-hidden="true" />
          <p>O assistente está desativado. Um administrador do Bolt IA ativa-o em «Configurações de IA».</p>
        </div>
      </div>
    );
  }

  const propose = async () => {
    const c = editor.getSelected();
    if (!c || !instruction.trim()) return;
    if (isEditingText(editor)) {
      setPhase({ kind: 'error', message: EDITING_MESSAGE });
      return;
    }
    const parsed = AiProposeRequest.safeParse({
      contract: AI_CONTRACT_VERSION,
      projectId,
      documentVersion: documentVersion(editor),
      requestId: crypto.randomUUID(),
      scope: { kind: 'element', id: c.getId() },
      device,
      instruction: instruction.trim(),
      context: buildElementContext(editor, c, device),
    });
    if (!parsed.success) {
      setPhase({ kind: 'error', message: 'Não foi possível preparar o pedido para este elemento. Nada foi alterado.' });
      return;
    }
    const request = parsed.data;
    if (import.meta.env.DEV) window.__boltAiLastRequest = request;
    const ctrl = new AbortController();
    setPhase({ kind: 'waiting', ctrl });
    try {
      const response = await proposer.propose(request, ctrl.signal);
      if (!alive.current || ctrl.signal.aborted) return;
      const problems = validateForDocument(editor, request, response);
      if (problems.length) {
        if (problems[0] === EDITING_MESSAGE) {
          setPhase({ kind: 'error', message: EDITING_MESSAGE });
          return;
        }
        const stale = problems.some((p) => p.includes('documento mudou'));
        setPhase({
          kind: 'error',
          message: stale ? 'O documento mudou enquanto esperava pela proposta. Nada foi alterado; peça de novo.' : 'A proposta não passou na validação. Nada foi alterado.',
          ...(stale ? {} : { details: problems }),
        });
        return;
      }
      const ops = response.proposal.operations;
      const pageId = editor.Pages.getSelected()?.getId();
      const opts = { interactive: true, scroll: true, focusId: request.scope.id, ...(pageId ? { pageId } : {}) };
      setView('after');
      setPhase({
        kind: 'proposal',
        request,
        response,
        changes: describeOperations(editor, ops),
        before: previewDocument(getProjectData(editor), opts),
        after: previewDocument(previewAfter(editor, ops), opts),
      });
    } catch (e) {
      if (!alive.current) return;
      if (ctrl.signal.aborted) setPhase({ kind: 'idle', note: 'Pedido cancelado. Nada foi alterado.' });
      else setPhase({ kind: 'error', message: e instanceof Error ? e.message : 'O assistente não respondeu. Nada foi alterado.' });
    }
  };

  const apply = () => {
    if (phase.kind !== 'proposal') return;
    const problems = validateForDocument(editor, phase.request, phase.response);
    if (problems.length) {
      setPhase({ kind: 'error', message: problems[0] === EDITING_MESSAGE ? EDITING_MESSAGE : 'O documento mudou desde a proposta. Nada foi alterado; peça uma nova proposta.' });
      return;
    }
    try {
      applyOperations(editor, phase.request.scope.id, phase.response.proposal.operations);
      setPhase({ kind: 'applied', count: phase.changes.length });
      setInstruction('');
    } catch {
      setPhase({ kind: 'error', message: 'A aplicação falhou e o documento foi reposto como estava. Nada foi alterado.' });
    }
  };

  // Enquanto uma proposta está aberta, qualquer alteração ao documento invalida-a (verificado a cada
  // evento). Durante a edição de texto no canvas o documento não é lido (reconstruiria o elemento).
  const editingText = isEditingText(editor);
  const stale = phase.kind === 'proposal' && !editingText && documentVersion(editor) !== phase.request.documentVersion;
  const scopeEl = phase.kind === 'proposal' ? findById(editor, phase.request.scope.id) : selected;

  return (
    <div className="panel-scroll ai-panel" data-testid="ai-panel">
      <div className="panel-title">Assistente IA</div>
      <p className={`ai-engine ${proposer.simulated ? 'is-simulated' : ''}`} data-testid="ai-engine">
        <Sparkles aria-hidden="true" /> {proposer.label}
      </p>
      {proposer.simulated && (
        <p className="hint ai-hint" data-testid="ai-simulated-note">
          Modo local: as propostas vêm de um simulador que entende comandos simples («texto: …», «ligação: …», «nível h2», «cor #b91c1c», «tamanho 20px», «negrito», «centrar»). Não é IA.
        </p>
      )}

      <section className="ai-scope" aria-label="Âmbito do pedido" data-testid="ai-scope">
        <div className="ai-scope-title">Âmbito: elemento selecionado</div>
        {scopeEl ? (
          <p className="ai-scope-name" data-testid="ai-scope-name">
            <strong>{displayName(scopeEl)}</strong> {contentHint(scopeEl) && <span>· {contentHint(scopeEl)}</span>}
          </p>
        ) : (
          <p className="hint" data-testid="ai-no-selection">
            Selecione um elemento no canvas ou na estrutura para fazer um pedido.
          </p>
        )}
        {caps && (
          <ul className="ai-caps" aria-label="O que o assistente pode alterar neste elemento" data-testid="ai-caps">
            <li className={caps.text ? '' : 'is-off'}>Texto{caps.text ? '' : ' (não se aplica)'}</li>
            <li className={caps.link ? '' : 'is-off'}>Ligação{caps.link ? '' : ' (não se aplica)'}</li>
            <li className={caps.tag ? '' : 'is-off'}>Nível do título{caps.tag ? '' : ' (não se aplica)'}</li>
            <li>Estilos próprios</li>
          </ul>
        )}
      </section>

      {phase.kind !== 'proposal' && (
        <form
          className="ai-form"
          onSubmit={(e) => {
            e.preventDefault();
            void propose();
          }}
        >
          <label className="field">
            <span>Estilos no dispositivo</span>
            <select className="select" value={device} disabled={busy} onChange={(e) => setOverride({ from: editingDevice, value: DEVICES.find((d) => d.id === e.target.value)?.id ?? 'desktop' })} data-testid="ai-device">
              {DEVICES.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Pedido</span>
            <textarea
              className="textarea"
              rows={4}
              maxLength={1000}
              value={instruction}
              disabled={busy || !selected}
              placeholder={proposer.simulated ? 'Ex.: texto: Fale connosco; cor #b91c1c' : 'Ex.: encurta o título e põe-no a vermelho escuro no telemóvel'}
              onChange={(e) => setInstruction(e.target.value)}
              data-testid="ai-instruction"
            />
          </label>
          {busy ? (
            <div className="ai-waiting" role="status" data-testid="ai-waiting">
              <Spinner label="A preparar a proposta…" />
              <Button variant="ghost" onClick={() => phase.ctrl.abort()} data-testid="ai-cancel-request">
                Cancelar pedido
              </Button>
            </div>
          ) : (
            <Button type="submit" variant="primary" disabled={!selected || !instruction.trim()} data-testid="ai-propose">
              <Sparkles aria-hidden="true" /> Propor alterações
            </Button>
          )}
        </form>
      )}

      {phase.kind === 'idle' && phase.note && (
        <p className="hint ai-hint" role="status" data-testid="ai-note">
          {phase.note}
        </p>
      )}
      {phase.kind === 'error' && (
        <div className="notice notice-error ai-message" role="alert" data-testid="ai-error">
          <AlertTriangle aria-hidden="true" />
          <div>
            <p>{phase.message}</p>
            {phase.details && (
              <ul>
                {phase.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {phase.kind === 'applied' && (
        <div className="notice ai-message ai-applied" role="status" data-testid="ai-applied">
          <Check aria-hidden="true" />
          <p>Alterações aplicadas ({phase.count}). Um só «Desfazer» reverte o lote inteiro.</p>
        </div>
      )}

      {phase.kind === 'proposal' && (
        <section className="ai-proposal" aria-label="Proposta do assistente" data-testid="ai-proposal">
          <p className="ai-summary" data-testid="ai-summary">
            {phase.response.proposal.summary}
          </p>
          {phase.changes.length > 0 ? (
            <ul className="ai-changes" aria-label="Alterações propostas" data-testid="ai-changes">
              {phase.changes.map((c, i) => (
                <li key={`${c.what}-${i}`} data-testid="ai-change">
                  <strong>{c.what}</strong>
                  <span className="ai-before">{c.before}</span>
                  <span aria-hidden="true">→</span>
                  <span className="ai-after">{c.after}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint" data-testid="ai-nothing">
              Nada para aplicar.
            </p>
          )}
          {phase.changes.length > 0 && (
            <>
              <BeforeAfter view={view} onView={setView} before={phase.before} after={phase.after} device={phase.request.device} testId="ai-preview" />
              <Button variant="ghost" onClick={() => setZoomed(true)} data-testid="ai-zoom">
                <Maximize2 aria-hidden="true" /> Ampliar pré-visualização
              </Button>
              <Modal wide open={zoomed} title="Pré-visualização da proposta" onClose={() => setZoomed(false)}>
                {zoomed && (
                  <div className="ai-zoom" data-testid="ai-zoom-dialog">
                    <BeforeAfter view={view} onView={setView} before={phase.before} after={phase.after} device={phase.request.device} testId="ai-zoom-preview" maxHeight={Math.round(window.innerHeight * 0.65)} />
                  </div>
                )}
              </Modal>
            </>
          )}
          {editingText && (
            <div className="notice ai-message" role="status" data-testid="ai-editing">
              <AlertTriangle aria-hidden="true" />
              <p>Está a editar texto no canvas. Termine a edição para poder aplicar.</p>
            </div>
          )}
          {stale && (
            <div className="notice notice-error ai-message" role="alert" data-testid="ai-stale">
              <AlertTriangle aria-hidden="true" />
              <p>O documento mudou desde esta proposta. Não pode ser aplicada; peça uma nova.</p>
            </div>
          )}
          <div className="ai-actions">
            {phase.changes.length > 0 && (
              <Button variant="primary" disabled={stale || editingText} onClick={apply} data-testid="ai-apply">
                <Check aria-hidden="true" /> Aplicar alterações
              </Button>
            )}
            <Button variant="ghost" onClick={() => setPhase({ kind: 'idle', note: 'Proposta descartada. Nada foi alterado.' })} data-testid="ai-discard">
              <X aria-hidden="true" /> Descartar
            </Button>
          </div>
        </section>
      )}

      <p className="hint ai-next" data-testid="ai-next-steps">
        Próximas etapas (ainda não disponíveis): secções e páginas; inserir, mover, duplicar e eliminar elementos; estilos globais com âmbito «Site inteiro» e confirmação do impacto nas páginas.
      </p>
    </div>
  );
}

/**
 * Antes/depois com as MESMAS dimensões: largura e altura do dispositivo do pedido (breakpoints
 * reais), reduzidos por escala. Só muda o documento mostrado.
 */
function BeforeAfter({ view, onView, before, after, device, testId, maxHeight }: { view: 'before' | 'after'; onView: (v: 'before' | 'after') => void; before: string; after: string; device: DeviceId; testId: string; maxHeight?: number }) {
  const { width } = previewSize(device);
  return (
    <div className="ai-before-after">
      <div className="ai-preview-head">
        <div className="segmented ai-tabs" role="tablist" aria-label="Pré-visualização">
          <button type="button" role="tab" aria-selected={view === 'before'} className={view === 'before' ? 'is-active' : ''} onClick={() => onView('before')} data-testid={`${testId}-before`}>
            Antes
          </button>
          <button type="button" role="tab" aria-selected={view === 'after'} className={view === 'after' ? 'is-active' : ''} onClick={() => onView('after')} data-testid={`${testId}-after`}>
            Depois
          </button>
        </div>
        <span className="hint" data-testid={`${testId}-device`}>
          {deviceById(device).label} · {width} px
        </span>
      </div>
      <ScaledPreview key={view} html={view === 'before' ? before : after} device={device} title={view === 'before' ? 'Antes das alterações' : 'Depois das alterações'} testId={testId} {...(maxHeight ? { maxHeight } : {})} />
    </div>
  );
}
