import type { Editor } from 'grapesjs';
import { AlertTriangle, Check, HelpCircle, ImagePlus, Info, Maximize2, Sparkles, Upload, Wand2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  AI_CONTRACT_VERSION,
  AI_SCOPE_KINDS,
  AiProposeRequest,
  AiScope,
  type AiDevice,
  type AiImageSource,
  type AiOperation,
  type AiProposal,
  type AiProposeResponse,
  type AiScopeKind,
  type AiSectionItem,
} from '../../supabase/functions/_shared/ai/contract.ts';
import { IMAGE_ASPECTS } from '../../supabase/functions/_shared/ai/images.ts';
import {
  affectedPageIds,
  applyOperations,
  describeOperations,
  documentVersion,
  EDITING_MESSAGE,
  imageSlots,
  isEditingText,
  previewAfter,
  validateForDocument,
  type ChangeLine,
  type ImageChoice,
} from '../ai/apply';
import { buildScopeContext, capabilitiesOf, planParts, resolveScope, type ContextPart, type ResolvedScope } from '../ai/context';
import { cropToAspect, slotAspect } from '../ai/imageSlot';
import { estimateRequestUsd, formatUsd } from '../ai/cost';
import type { ImageGenerator } from '../ai/proposers';
import type { AiHandoff } from '../ai/quickEdit';
import { canvasSettled, describeHidden, hiddenStyleChanges } from '../ai/visibility';
import type { AiStatus } from '../admin/aiAdminClient';
import type { AssetUrlMap } from '../assets/assetRefs';
import { ACCEPTED_IMAGE_TYPES, type LibraryImage } from '../assets/assetStore';
import { useServices } from '../app/services';
import { Button, errorMessage, Modal, Spinner } from '../app/ui';
import { getProjectData } from '../engine/createBoltEditor';
import { findInProject } from '../engine/operations';
import { listPages } from '../engine/pages';
import { previewDocument } from '../engine/runtime';
import { deviceById, DEVICES, type DeviceId } from '../engine/styles';
import { pageImages } from './images';
import { previewSize, ScaledPreview } from './ScaledPreview';
import { ImageGenNotice } from './ImageGenNotice';
import { useAssistant } from './useAssistant';
import { navigate } from '../app/router';

/**
 * Painel «Assistente IA». O utilizador escolhe EXPLICITAMENTE o âmbito (elemento, secção, página,
 * site inteiro), vê-o e vê o custo máximo antes de enviar. Percurso: pedido (dividido em partes se
 * for grande) → proposta consolidada e validada → imagens escolhidas/carregadas/geradas (com
 * confirmação do custo) → antes/depois por página e lista de alterações com as páginas afetadas →
 * «Aplicar» (um único desfazer, mesmo em várias páginas) ou «Descartar». Nada é aplicado sem
 * confirmação; qualquer erro deixa o documento como estava. O âmbito nunca muda sozinho: um
 * esclarecimento pode OFERECER outro âmbito, e só o utilizador o escolhe.
 */
declare global {
  interface Window {
    /** Só em desenvolvimento: últimos pedidos enviados (os testes E2E verificam o contexto). */
    __boltAiLastRequest?: AiProposeRequest;
    __boltAiRequests?: AiProposeRequest[];
    /** Só em desenvolvimento: número de envios (os testes verificam que não há envios duplicados). */
    __boltAiSent?: number;
    /** Só em desenvolvimento: tempos medidos (validação, pré-visualização), para os relatórios de desempenho. */
    __boltAiTimings?: Array<{ step: string; ms: number; ops: number }>;
  }
}

/** Mede um passo síncrono; em desenvolvimento, regista o tempo (validação e pré-visualização medidas em separado). */
function timed<T>(step: string, ops: number, fn: () => T): T {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      window.__boltAiTimings = [...(window.__boltAiTimings ?? []), { step, ms: Math.round(performance.now() - t0), ops }];
    }
  }
}

/** Liberta as imagens temporárias (endereços blob: da sessão) de uma proposta que termina. */
function releaseImages(choices: ReadonlyMap<string, ImageChoice>): void {
  for (const c of choices.values()) if (c.display.startsWith('blob:')) URL.revokeObjectURL(c.display);
}

/** Deixa o browser pintar (o progresso) antes de um passo pesado. */
const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));

const SCOPE_LABEL: Record<AiScopeKind, string> = { element: 'Elemento', section: 'Secção', page: 'Página', site: 'Site inteiro' };

interface Proposal {
  requests: AiProposeRequest[];
  responses: AiProposeResponse[];
  ops: AiOperation[];
  summary: string;
  scope: ResolvedScope;
  device: AiDevice;
  /** Versão do documento quando a proposta foi pedida (qualquer mudança invalida-a). */
  version: string;
  /** Vinda da janela rápida com uma imagem a gerar: a confirmação «Gerar imagem» abre logo. */
  autoGenerate?: boolean;
}

type Phase =
  | { kind: 'idle'; note?: string }
  | { kind: 'waiting'; ctrl: AbortController; part: number; total: number; stage: 'pedir' | 'validar' }
  | { kind: 'proposal'; proposal: Proposal }
  | { kind: 'clarify'; question: string; options: NonNullable<AiProposal['clarification']>['options']; summary: string }
  | { kind: 'error'; message: string; details?: string[] }
  | { kind: 'applied'; count: number; pages: number; hidden: string[] };

interface Plan {
  parts: ContextPart[];
  cost: number | null;
  maxParts: number;
  error?: string;
  /** Estado do documento (contador de alterações) para o qual o plano foi calculado. */
  version: number;
}

/** Pedido sem identificador nem versão (o plano estima o custo com ele). */
function draftRequest(projectId: string, scope: AiScope, device: AiDevice, instruction: string, context: AiProposeRequest['context'], imageGeneration: boolean): AiProposeRequest {
  return { contract: AI_CONTRACT_VERSION, projectId, documentVersion: 'x', requestId: '00000000-0000-4000-8000-000000000000', scope, device, instruction, imageGeneration, context };
}

/**
 * Plano do pedido: partes e custo máximo. `documentChanges` identifica o estado do documento
 * (a lista de partes muda quando o documento muda).
 */
function planFor(editor: Editor, scopeJson: string, device: AiDevice, instruction: string, projectId: string, status: AiStatus | null, documentChanges: number): Plan {
  try {
    const scope = AiScope.parse(JSON.parse(scopeJson));
    const parts = planParts(buildScopeContext(editor, scope, device));
    const pricing = status?.pricing;
    const cost = pricing ? parts.reduce((sum, p) => sum + estimateRequestUsd(pricing, draftRequest(projectId, scope, device, instruction || '.', p.context, false)), 0) : null;
    return { parts, cost, maxParts: pricing?.maxParts ?? 6, version: documentChanges };
  } catch (e) {
    return { parts: [], cost: null, maxParts: 0, error: errorMessage(e), version: documentChanges };
  }
}

/**
 * Plano calculado uma vez por combinação (âmbito, dispositivo, texto, estado do documento e do
 * servidor): o painel re-renderiza a cada evento do editor e o contexto de um site grande não deve
 * ser reconstruído sem necessidade.
 */
const planCache = new WeakMap<Editor, { key: string; plan: Plan }>();
function cachedPlan(editor: Editor, key: string, compute: () => Plan): Plan {
  const hit = planCache.get(editor);
  if (hit && hit.key === key) return hit.plan;
  const plan = compute();
  planCache.set(editor, { key, plan });
  return plan;
}

/** Só em desenvolvimento: expõe os pedidos enviados aos testes E2E. */
function exposeRequests(requests: AiProposeRequest[]): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  window.__boltAiLastRequest = requests[0];
  window.__boltAiRequests = requests;
  window.__boltAiSent = (window.__boltAiSent ?? 0) + 1;
}

export function AiAssistantPanel({
  editor,
  projectId,
  workspaceId,
  urls,
  device: editingDevice,
  focusRequest = 0,
  prefill,
  handoff,
  onConsumed,
}: {
  editor: Editor;
  projectId: string;
  workspaceId?: string;
  urls: AssetUrlMap;
  device: DeviceId;
  focusRequest?: number;
  /** Texto vindo da janela rápida «Editar com IA» (o contador muda a cada pedido). */
  prefill?: { text: string; n: number };
  /** Proposta vinda da janela rápida (imagens): aparece já, sem novo pedido ao assistente. */
  handoff?: AiHandoff & { n: number };
  /**
   * O painel usou o texto ou a proposta passados pela janela rápida: o editor limpa-os. O painel é
   * recriado sempre que a ferramenta abre; sem isto, voltava a aplicá-los a cada abertura (a
   * confirmação «Gerar imagem?» reaparecia sempre, 08/10/2026).
   */
  onConsumed?: (what: 'prefill' | 'handoff', n: number) => void;
}) {
  const { proposer, images, status, admin } = useAssistant();
  const { assets } = useServices();
  const [instruction, setInstruction] = useState('');
  const [scopeKind, setScopeKind] = useState<AiScopeKind>('element');
  /** Âmbito escolhido num esclarecimento (id concreto), válido até mudar de tipo de âmbito. */
  const [explicit, setExplicit] = useState<{ kind: AiScopeKind; id: string } | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusRequest > 0) instructionRef.current?.focus();
  }, [focusRequest]);
  const prefillN = prefill?.n ?? 0;
  const prefillText = prefill?.text ?? '';
  const [prefilled, setPrefilled] = useState(0);
  if (prefillN > prefilled) {
    setPrefilled(prefillN);
    setInstruction(prefillText);
  }
  useEffect(() => {
    if (prefilled > 0) onConsumed?.('prefill', prefilled);
  }, [prefilled, onConsumed]);
  // O dispositivo do assistente acompanha o do editor, salvo escolha própria.
  // Responsivo automático: o pedido é sempre sobre a BASE (todos os ecrãs) e o assistente acrescenta
  // os ajustes de tablet e telemóvel quando são precisos (ou só esse ecrã, se o pedido o disser).
  const device: AiDevice = 'desktop';
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [choices, setChoices] = useState<Map<string, ImageChoice>>(new Map());
  // Proposta passada pela janela rápida: o mesmo pedido, o mesmo elemento, já validada no envio.
  const handoffN = handoff?.n ?? 0;
  const [handedOff, setHandedOff] = useState(0);
  if (handoff && handoffN > handedOff) {
    setHandedOff(handoffN);
    const req = handoff.request;
    const target = req.scope.kind === 'element' ? findInProject(editor, req.scope.id)?.component : undefined;
    const resolved = resolveScope(editor, 'element', target) ?? { scope: req.scope, label: 'Elemento', pageIds: [] };
    setScopeKind('element');
    // O destino da proposta (ex.: a imagem do cartão), que pode não ser o elemento selecionado.
    setExplicit(req.scope.kind === 'element' ? { kind: 'element', id: req.scope.id } : null);
    setInstruction(req.instruction);
    setChoices(new Map());
    setPhase({
      kind: 'proposal',
      proposal: { requests: [req], responses: [handoff.response], ops: handoff.response.proposal.operations, summary: handoff.response.proposal.summary, scope: resolved, device: req.device, version: req.documentVersion, autoGenerate: handoff.autoGenerate },
    });
  }
  useEffect(() => {
    if (handedOff > 0) onConsumed?.('handoff', handedOff);
  }, [handedOff, onConsumed]);
  const alive = useRef(true);
  /** Um pedido de cada vez: impede envios duplicados (duplo clique, Enter repetido). */
  const inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const selected = editor.getSelected();
  const imageSelected = scopeKind === 'element' && selected !== undefined && capabilitiesOf(editor, selected).image;
  const busy = phase.kind === 'waiting';
  const editingText = isEditingText(editor);
  const scope = resolveScope(editor, scopeKind, selected, explicit && explicit.kind === scopeKind ? explicit.id : undefined);
  const scopeJson = scope ? JSON.stringify(scope.scope) : '';
  const documentChanges = editor.getDirtyCount();
  // Não lê o documento durante a edição de texto (reconstruiria o elemento em edição).
  const planKey = JSON.stringify([scopeJson, device, instruction, projectId, documentChanges, status?.pricing ?? null, proposer?.label ?? '']);
  const plan = scopeJson && !editingText && proposer ? cachedPlan(editor, planKey, () => planFor(editor, scopeJson, device, instruction, projectId, status, documentChanges)) : null;

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
    if (inFlight.current || !scope || !instruction.trim() || !plan || plan.parts.length === 0) return;
    if (isEditingText(editor)) {
      setPhase({ kind: 'error', message: EDITING_MESSAGE });
      return;
    }
    if (plan.parts.length > plan.maxParts) {
      setPhase({ kind: 'error', message: `O pedido é demasiado grande: seriam ${plan.parts.length} partes (máximo ${plan.maxParts}). Escolha um âmbito menor. Nada foi enviado.` });
      return;
    }
    const version = documentVersion(editor);
    const requests: AiProposeRequest[] = [];
    for (const p of plan.parts) {
      const parsed = AiProposeRequest.safeParse({ ...draftRequest(projectId, scope.scope, device, instruction.trim(), p.context, images !== null), documentVersion: version, requestId: crypto.randomUUID() });
      if (!parsed.success) {
        setPhase({ kind: 'error', message: 'Não foi possível preparar o pedido para este âmbito. Nada foi enviado.' });
        return;
      }
      requests.push(parsed.data);
    }
    exposeRequests(requests);
    const ctrl = new AbortController();
    const responses: AiProposeResponse[] = [];
    inFlight.current = true;
    try {
      // Partes em sequência (cada uma com reserva própria no servidor); a proposta é consolidada.
      for (let i = 0; i < requests.length; i += 1) {
        const request = requests[i];
        if (!request) continue;
        setPhase({ kind: 'waiting', ctrl, part: i + 1, total: requests.length, stage: 'pedir' });
        const response = await proposer.propose(request, ctrl.signal);
        // Cancelado entretanto: a resposta é descartada (nunca aparece nem é aplicada).
        if (!alive.current || ctrl.signal.aborted) return;
        if (response.proposal.clarification) {
          setPhase({ kind: 'clarify', question: response.proposal.clarification.question, options: response.proposal.clarification.options, summary: response.proposal.summary });
          return;
        }
        setPhase({ kind: 'waiting', ctrl, part: i + 1, total: requests.length, stage: 'validar' });
        await nextFrame();
        if (!alive.current || ctrl.signal.aborted) return;
        const problems = timed('validacao', response.proposal.operations.length, () => validateForDocument(editor, request, response));
        if (problems.length) {
          if (problems[0] === EDITING_MESSAGE) {
            setPhase({ kind: 'error', message: EDITING_MESSAGE });
            return;
          }
          const stale = problems.some((p) => p.includes('documento mudou'));
          setPhase({
            kind: 'error',
            message: stale ? 'O documento mudou enquanto esperava pela proposta. Nada foi alterado; peça de novo.' : `A proposta${requests.length > 1 ? ` (parte ${i + 1})` : ''} não passou na validação. Nada foi alterado.`,
            ...(stale ? {} : { details: problems }),
          });
          return;
        }
        responses.push(response);
      }
      const ops = responses.flatMap((r) => r.proposal.operations);
      const summary = responses.map((r) => r.proposal.summary).filter(Boolean).join(' ');
      setChoices(new Map());
      // Com uma imagem a gerar (e gerador disponível), a confirmação «Gerar imagem?» abre logo, como
      // na janela rápida: o utilizador confirma (custo mostrado) ou cancela e escolhe outra.
      const autoGenerate = images !== null && imageSlots(ops).some((x) => x.source.kind === 'generate');
      setPhase({ kind: 'proposal', proposal: { requests, responses, ops, summary, scope, device, version, autoGenerate } });
    } catch (e) {
      if (!alive.current) return;
      if (ctrl.signal.aborted) setPhase({ kind: 'idle', note: 'Pedido cancelado. Nada foi alterado.' });
      else setPhase({ kind: 'error', message: e instanceof Error ? e.message : 'O assistente não respondeu. Nada foi alterado.' });
    } finally {
      inFlight.current = false;
      if (ctrl.signal.aborted && alive.current) setPhase({ kind: 'idle', note: 'Pedido cancelado. Nada foi alterado.' });
    }
  };

  /** Uma opção de esclarecimento com outro âmbito: muda o âmbito (sem enviar); o utilizador revê e envia. */
  const chooseOption = (opt: { label: string; scope?: { kind: AiScopeKind; id?: string | undefined } | undefined }) => {
    if (opt.scope) {
      setScopeKind(opt.scope.kind);
      setExplicit(opt.scope.id ? { kind: opt.scope.kind, id: opt.scope.id } : null);
      setPhase({ kind: 'idle', note: `Âmbito alterado para «${opt.label}». Reveja o pedido e envie de novo quando quiser.` });
    } else {
      setPhase({ kind: 'idle', note: `Escolheu «${opt.label}». Precise o pedido e envie de novo.` });
    }
    instructionRef.current?.focus();
  };

  const apply = async (p: Proposal) => {
    // Revalida contra o documento atual (qualquer mudança desde a proposta invalida-a).
    for (let i = 0; i < p.requests.length; i += 1) {
      const req = p.requests[i];
      const res = p.responses[i];
      if (!req || !res) continue;
      const problems = validateForDocument(editor, req, res);
      if (problems.length) {
        setPhase({ kind: 'error', message: problems[0] === EDITING_MESSAGE ? EDITING_MESSAGE : 'O documento mudou desde a proposta. Nada foi alterado; peça uma nova proposta.' });
        return;
      }
    }
    // Imagens carregadas ou geradas: guardadas agora (referência permanente), só porque o
    // utilizador aplicou. Se o envio falhar, nada é aplicado.
    const ready = new Map(choices);
    try {
      for (const [index, ch] of ready) {
        if (!ch.pending) continue;
        const type = ch.pending.type || 'image/png';
        const file = new File([ch.pending], `ia-${index.replace('.', '-')}.${type.split('/')[1] ?? 'png'}`, { type });
        const up = await assets.upload(file, { projectId, ...(workspaceId ? { workspaceId } : {}) });
        urls.register(up.stored, up.display);
        const { pending: _sent, ...rest } = ch;
        void _sent;
        ready.set(index, { ...rest, display: up.display, stored: up.stored });
      }
    } catch (e) {
      setPhase({ kind: 'error', message: `Não foi possível guardar as imagens: ${errorMessage(e)} Nada foi alterado.` });
      return;
    }
    if (!alive.current) return;
    try {
      const pages = affectedPageIds(editor, p.ops).length;
      const count = describeOperations(editor, p.ops, ready).length || p.ops.length;
      applyOperations(editor, p.ops, ready);
      releaseImages(choices);
      setChoices(new Map());
      setInstruction('');
      // Destino explícito (vindo da janela rápida) só vale para esta proposta.
      setExplicit(null);
      // Confirma no canvas que os estilos aplicados se veem (num site importado, uma regra com
      // !important pode prevalecer): se não, diz-o em vez de dar a alteração como feita.
      setPhase({ kind: 'applied', count, pages, hidden: [] });
      await canvasSettled(editor);
      const hidden = hiddenStyleChanges(editor, p.ops, editingDevice).map(describeHidden);
      if (alive.current && hidden.length) setPhase({ kind: 'applied', count, pages, hidden });
    } catch {
      setPhase({ kind: 'error', message: 'A aplicação falhou e o documento foi reposto como estava. Nada foi alterado.' });
    }
  };

  return (
    <div className="panel-scroll ai-panel" data-testid="ai-panel">
      <div className="panel-title">Assistente IA</div>
      <div className="ai-engines">
        <p className={`ai-engine ${proposer.simulated ? 'is-simulated' : ''}`} data-testid="ai-engine" title="Escreve a proposta (textos, estilos, estrutura e a descrição das imagens)">
          <Sparkles aria-hidden="true" /> {proposer.label}
        </p>
        {images && (
          <p className={`ai-engine ai-engine-image ${imageSelected ? 'is-focus' : ''} ${images.simulated ? 'is-simulated' : ''}`} data-testid="ai-engine-image" title="Gera as imagens novas">
            <ImagePlus aria-hidden="true" /> {images.label}
          </p>
        )}
      </div>
      {images && imageSelected && (
        <p className="hint ai-hint" data-testid="ai-image-agent-note">
          Imagem selecionada: o pedido é escrito por {proposer.label} e a imagem nova é gerada por {images.label}, no formato do espaço onde fica. Antes de gerar, pede confirmação.
        </p>
      )}
      {proposer.simulated && (
        <p className="hint ai-hint" data-testid="ai-simulated-note">
          Modo local: as propostas vêm de um simulador que entende comandos simples («texto: …», «cor #b91c1c», «imagem: escolher», «fundo-imagem: gerar …», «inserir título: …», «títulos: cor …»). Não é IA; as imagens «geradas» são imagens de teste identificadas como simuladas.
        </p>
      )}

      <section className="ai-scope" aria-label="Âmbito do pedido" data-testid="ai-scope">
        <div className="ai-scope-title">Âmbito</div>
        <div className="segmented ai-scope-kinds" role="radiogroup" aria-label="Âmbito do pedido">
          {AI_SCOPE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={scopeKind === k}
              className={scopeKind === k ? 'is-active' : ''}
              disabled={busy || phase.kind === 'proposal'}
              onClick={() => {
                setScopeKind(k);
                setExplicit(null);
              }}
              data-testid={`ai-scope-kind-${k}`}
            >
              {SCOPE_LABEL[k]}
            </button>
          ))}
        </div>
        {scope ? (
          <p className="ai-scope-name" data-testid="ai-scope-name">
            <strong>{scope.label}</strong>
          </p>
        ) : (
          <p className="hint" data-testid="ai-no-selection">
            Selecione um elemento no canvas ou na estrutura (ou escolha «Página» ou «Site inteiro»).
          </p>
        )}
        {scopeKind === 'element' && selected && (
          <p className="hint" data-testid="ai-caps">
            Pode alterar: {describeCaps(capabilitiesOf(editor, selected))}.
          </p>
        )}
        {(scopeKind === 'page' || scopeKind === 'site') && (
          <p className="hint">Pedidos a uma página ou ao site inteiro podem alterar textos, estilos, imagens e estrutura de forma coordenada; a proposta mostra as páginas afetadas antes de aplicar.</p>
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
          <p className="hint ai-responsive" data-testid="ai-responsive">
            Responsivo automático: as alterações valem para todos os ecrãs e o assistente ajusta tablet e telemóvel quando é preciso. Para um só ecrã, diga-o no pedido
            (ex.: «no telemóvel»).
          </p>
          <label className="field">
            <span>Pedido</span>
            <textarea
              ref={instructionRef}
              className="textarea"
              rows={4}
              maxLength={1000}
              value={instruction}
              disabled={busy || !scope}
              placeholder={proposer.simulated ? 'Ex.: texto: Fale connosco; cor #b91c1c' : 'Ex.: encurta o título e põe-no a vermelho escuro no telemóvel'}
              onChange={(e) => setInstruction(e.target.value)}
              data-testid="ai-instruction"
            />
          </label>
          {plan && scope && (
            <p className="hint ai-plan" data-testid="ai-plan">
              {plan.error ? `${plan.error} ` : ''}
              {plan.parts.length > 1 ? `Pedido grande: ${plan.parts.length} partes (uma proposta consolidada no fim). ` : ''}
              {/* Valores financeiros: só administradores (o servidor também só lhos envia a eles). */}
              {!admin
                ? ''
                : proposer.simulated
                  ? 'Simulador: sem custo.'
                  : plan.cost !== null
                    ? `Custo máximo estimado: ${formatUsd(plan.cost)} (reserva feita no servidor; o custo real costuma ser menor).`
                    : 'O custo máximo é calculado e reservado no servidor antes da chamada.'}
              {plan.parts.length > plan.maxParts ? ` Excede o máximo de ${plan.maxParts} partes: escolha um âmbito menor.` : ''}
            </p>
          )}
          {busy ? (
            <div className="ai-waiting" role="status" data-testid="ai-waiting">
              <Spinner
                label={`${phase.stage === 'validar' ? 'A validar a proposta no documento…' : 'A pedir a proposta ao assistente…'}${phase.total > 1 ? ` (parte ${phase.part} de ${phase.total})` : ''}`}
              />
              <Button variant="ghost" onClick={() => phase.ctrl.abort()} data-testid="ai-cancel-request">
                Cancelar pedido
              </Button>
            </div>
          ) : (
            <Button type="submit" variant="primary" disabled={!scope || !instruction.trim() || !plan || plan.parts.length === 0 || plan.parts.length > plan.maxParts} data-testid="ai-propose">
              <Sparkles aria-hidden="true" /> {plan && plan.parts.length > 1 ? `Propor em ${plan.parts.length} partes` : 'Propor alterações'}
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
      {phase.kind === 'clarify' && (
        <section className="notice ai-message ai-clarify" role="status" aria-label="O assistente precisa de um esclarecimento" data-testid="ai-clarify">
          <HelpCircle aria-hidden="true" />
          <div>
            <p data-testid="ai-clarify-question">{phase.question}</p>
            {phase.summary && <p className="hint">{phase.summary}</p>}
            <div className="ai-actions">
              {phase.options.map((o, i) => (
                <Button key={`${o.label}-${i}`} variant={o.scope ? 'primary' : 'ghost'} onClick={() => chooseOption(o)} data-testid="ai-clarify-option">
                  {o.scope ? `Mudar o âmbito: ${o.label}` : o.label}
                </Button>
              ))}
              <Button variant="ghost" onClick={() => setPhase({ kind: 'idle', note: 'Nada foi alterado.' })} data-testid="ai-clarify-dismiss">
                <X aria-hidden="true" /> Fechar
              </Button>
            </div>
          </div>
        </section>
      )}
      {phase.kind === 'applied' && (
        <div className="notice ai-message ai-applied" role="status" data-testid="ai-applied">
          <Check aria-hidden="true" />
          <p>
            Alterações aplicadas ({phase.count}
            {phase.pages > 1 ? ` em ${phase.pages} páginas` : ''}). Um só «Desfazer» reverte o lote inteiro.
          </p>
        </div>
      )}
      {phase.kind === 'applied' && phase.hidden.length > 0 && (
        <div className="notice ai-message" role="alert" data-testid="ai-hidden">
          <AlertTriangle aria-hidden="true" />
          <div>
            <p>
              <strong>Parte da alteração não se vê na página.</strong>
            </p>
            <ul>
              {phase.hidden.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {phase.kind === 'proposal' && (
        <ProposalView
          editor={editor}
          proposal={phase.proposal}
          choices={choices}
          onChoose={(index, choice) => setChoices((prev) => new Map(prev).set(index, choice))}
          images={images}
          admin={admin}
          status={status}
          projectId={projectId}
          workspaceId={workspaceId}
          urls={urls}
          onDiscard={() => {
            // Imagens geradas ou carregadas e não aplicadas: libertadas da memória; nada foi guardado.
            releaseImages(choices);
            setChoices(new Map());
            setExplicit(null);
            setPhase({ kind: 'idle', note: 'Proposta descartada. Nada foi alterado.' });
          }}
          onApply={() => apply(phase.proposal)}
        />
      )}
    </div>
  );
}

function describeCaps(c: { text: boolean; link: boolean; tag: boolean; image: boolean; container: boolean }): string {
  const list = [c.text ? 'texto' : '', c.link ? 'ligação' : '', c.tag ? 'nível do título' : '', c.image ? 'imagem' : '', c.container ? 'conteúdo, estrutura e imagem de fundo' : '', 'estilos próprios'].filter(Boolean);
  return list.join(', ');
}

// ---------------------------------------------------------------- proposta

/** Elemento a destacar na pré-visualização da página mostrada. */
function focusOf(editor: Editor, ops: readonly AiOperation[], pageId: string | undefined): string | undefined {
  for (const o of ops) {
    if (o.op === 'insertBlock' || o.op === 'insertSection') return o.newId;
    const id = o.id;
    if (!pageId || findInProject(editor, id)?.page.getId() === pageId) return id;
  }
  return undefined;
}

function ProposalView({
  editor,
  proposal,
  choices,
  onChoose,
  images,
  admin,
  status,
  projectId,
  workspaceId,
  urls,
  onApply,
  onDiscard,
}: {
  editor: Editor;
  proposal: Proposal;
  choices: ReadonlyMap<string, ImageChoice>;
  onChoose: (key: string, choice: ImageChoice) => void;
  images: ImageGenerator | null;
  admin: boolean;
  status: AiStatus | null;
  projectId: string;
  workspaceId: string | undefined;
  urls: AssetUrlMap;
  onApply: () => Promise<void>;
  onDiscard: () => void;
}) {
  const [view, setView] = useState<'before' | 'after'>('after');
  /** Ecrã da pré-visualização (o resultado é responsivo: vê-se em cada um antes de aplicar). */
  const [previewDevice, setPreviewDevice] = useState<DeviceId>(proposal.device);
  const [zoomed, setZoomed] = useState(false);
  const [applying, setApplying] = useState(false);
  const ops = proposal.ops;
  const slots = imageSlots(ops);
  const missing = slots.filter((s) => !choices.has(s.key)).length;
  const pagesInfo = listPages(editor);
  const pageIds = affectedPageIds(editor, ops);
  const [pageId, setPageId] = useState<string | undefined>(pageIds[0]);
  const editingText = isEditingText(editor);
  const stale = !editingText && documentVersion(editor) !== proposal.version;
  const changes: ChangeLine[] = describeOperations(editor, ops, choices);

  // Antes/depois: quando todas as imagens estão escolhidas; a página mostrada é uma das afetadas.
  // Construído DEPOIS de mostrar a proposta (a lista de alterações aparece logo; a pré-visualização
  // indica que está a ser preparada) e medido à parte da validação.
  const previewKey = JSON.stringify([pageId ?? '', missing, stale, ops.length, [...choices.entries()].map(([k, c]) => [k, c.display])]);
  const [built, setBuilt] = useState<{ key: string; value: { before: string; after: string } | { error: string } } | null>(null);
  useEffect(() => {
    if (missing || !ops.length || stale) return;
    const t = setTimeout(() => {
      let value: { before: string; after: string } | { error: string };
      try {
        const shownPage = pageId ?? editor.Pages.getSelected()?.getId();
        const focus = focusOf(editor, ops, shownPage);
        const opts = { interactive: true, scroll: true, ...(focus ? { focusId: focus } : {}), ...(shownPage ? { pageId: shownPage } : {}) };
        value = timed('previsualizacao', ops.length, () => ({ before: previewDocument(getProjectData(editor), opts), after: previewDocument(previewAfter(editor, ops, choices), opts) }));
      } catch (e) {
        value = { error: errorMessage(e) };
      }
      setBuilt({ key: previewKey, value });
    }, 0);
    return () => clearTimeout(t);
  }, [editor, ops, choices, pageId, missing, stale, previewKey]);
  const preview = built && built.key === previewKey ? built.value : null;

  return (
    <section className="ai-proposal" aria-label="Proposta do assistente" data-testid="ai-proposal">
      <p className="ai-summary" data-testid="ai-summary">
        {proposal.summary}
      </p>
      <p className="hint" data-testid="ai-proposal-scope">
        Âmbito: {proposal.scope.label}
        {proposal.requests.length > 1 ? ` · ${proposal.requests.length} partes consolidadas` : ''}
      </p>
      {pageIds.length > 0 && (
        <p className="hint" data-testid="ai-affected-pages">
          {pageIds.length === 1 ? 'Página afetada' : `Páginas afetadas (${pageIds.length})`}: {pageIds.map((id) => pagesInfo.find((p) => p.id === id)?.name ?? id).join(', ')}
        </p>
      )}
      {changes.length > 0 ? (
        <ul className="ai-changes" aria-label="Alterações propostas" data-testid="ai-changes">
          {changes.map((c, i) => (
            <li key={`${c.what}-${i}`} data-testid="ai-change">
              <strong>
                {c.what}
                {pageIds.length > 1 && c.page ? <span className="ai-change-page"> · {c.page}</span> : null}
              </strong>
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

      {slots.map((s, i) => (
        <ImageSlot
          key={s.key}
          editor={editor}
          op={s.op}
          item={s.item}
          source={s.source}
          choice={choices.get(s.key)}
          onChoose={(ch) => onChoose(s.key, ch)}
          images={images}
          admin={admin}
          status={status}
          autoConfirm={proposal.autoGenerate === true && i === slots.findIndex((x) => x.source.kind === 'generate')}
          projectId={projectId}
          workspaceId={workspaceId}
          urls={urls}
        />
      ))}

      {ops.length > 0 && (
        <>
          {pageIds.length > 1 && (
            <label className="field">
              <span>Pré-visualizar a página</span>
              <select className="select" value={pageId} onChange={(e) => setPageId(e.target.value)} data-testid="ai-preview-page">
                {pageIds.map((id) => (
                  <option key={id} value={id}>
                    {pagesInfo.find((p) => p.id === id)?.name ?? id}
                  </option>
                ))}
              </select>
            </label>
          )}
          {missing > 0 ? (
            <p className="hint" data-testid="ai-preview-waiting">
              A pré-visualização aparece quando todas as imagens da proposta estiverem escolhidas ({missing} por escolher).
            </p>
          ) : preview && 'error' in preview ? (
            <p className="error-text" role="alert">
              {preview.error}
            </p>
          ) : preview ? (
            <>
              <div className="segmented ai-preview-devices" role="radiogroup" aria-label="Ecrã da pré-visualização" data-testid="ai-preview-devices">
                {DEVICES.map((d) => (
                  <button key={d.id} type="button" role="radio" aria-checked={previewDevice === d.id} className={previewDevice === d.id ? 'is-active' : ''} onClick={() => setPreviewDevice(d.id)} data-testid={`ai-preview-device-${d.id}`}>
                    {d.label}
                  </button>
                ))}
              </div>
              <BeforeAfter view={view} onView={setView} before={preview.before} after={preview.after} device={previewDevice} testId="ai-preview" />
              <Button variant="ghost" onClick={() => setZoomed(true)} data-testid="ai-zoom">
                <Maximize2 aria-hidden="true" /> Ampliar pré-visualização
              </Button>
              <Modal wide open={zoomed} title="Pré-visualização da proposta" onClose={() => setZoomed(false)}>
                {zoomed && (
                  <div className="ai-zoom" data-testid="ai-zoom-dialog">
                    <BeforeAfter view={view} onView={setView} before={preview.before} after={preview.after} device={previewDevice} testId="ai-zoom-preview" maxHeight={Math.round(window.innerHeight * 0.65)} />
                  </div>
                )}
              </Modal>
            </>
          ) : stale ? null : (
            <div role="status" data-testid="ai-preview-building">
              <Spinner label="A preparar a pré-visualização…" />
            </div>
          )}
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
        {ops.length > 0 && (
          <Button
            variant="primary"
            disabled={stale || editingText || missing > 0 || applying}
            onClick={() => {
              setApplying(true);
              void onApply().finally(() => setApplying(false));
            }}
            data-testid="ai-apply"
          >
            <Check aria-hidden="true" /> {applying ? 'A aplicar…' : 'Aplicar alterações'}
          </Button>
        )}
        <Button variant="ghost" disabled={applying} onClick={onDiscard} data-testid="ai-discard">
          <X aria-hidden="true" /> Descartar
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- imagens da proposta

function ImageSlot({
  editor,
  op,
  item,
  source,
  choice,
  onChoose,
  images,
  admin,
  status,
  autoConfirm,
  projectId,
  workspaceId,
  urls,
}: {
  editor: Editor;
  op: AiOperation;
  item: AiSectionItem | undefined;
  source: AiImageSource;
  choice: ImageChoice | undefined;
  onChoose: (c: ImageChoice) => void;
  images: ImageGenerator | null;
  admin: boolean;
  status: AiStatus | null;
  /** Abrir já a confirmação «Gerar imagem» (pedido de geração vindo da janela rápida). */
  autoConfirm: boolean;
  projectId: string;
  workspaceId: string | undefined;
  urls: AssetUrlMap;
}) {
  const { assets } = useServices();
  const fileRef = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const [library, setLibrary] = useState<LibraryImage[] | null>(null);
  const [prompt, setPrompt] = useState(source.kind === 'generate' ? source.prompt : (source.hint ?? ''));
  const target = op.op === 'insertBlock' || op.op === 'insertSection' ? undefined : findInProject(editor, op.id)?.component;
  // Formato do ESPAÇO onde a imagem fica (medido no canvas); na falta dele, o proposto pelo modelo.
  const [measured] = useState(() => slotAspect(target, op.op === 'setBackgroundImage' ? 'background' : 'image'));
  const [aspect, setAspect] = useState<(typeof IMAGE_ASPECTS)[number]>(measured ?? (source.kind === 'generate' ? source.aspect : '16:9'));
  const [confirming, setConfirming] = useState(autoConfirm && source.kind === 'generate' && images !== null);
  const [generating, setGenerating] = useState<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const what = op.op === 'setBackgroundImage' ? 'Imagem de fundo' : op.op === 'insertSection' ? 'Imagem da secção nova' : op.op === 'insertBlock' ? 'Imagem nova' : 'Imagem';
  const alt = target ? String(target.getAttributes().alt ?? '') : (item?.alt ?? '');

  const openPicker = () => {
    setPicking(true);
    const list = assets.listLibrary?.bind(assets);
    if (!list) return;
    list({ ...(workspaceId ? { workspaceId } : {}), projectId })
      .then((items) => {
        for (const it of items) urls.register(it.ref, it.display);
        setLibrary(items);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  };

  const onFile = (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.some((t) => t === file.type)) {
      setError('Formato não suportado. Use PNG, JPEG, WebP, GIF ou AVIF.');
      return;
    }
    setError(null);
    onChoose({ display: URL.createObjectURL(file), pending: file, origin: 'upload' });
  };

  const generate = async () => {
    if (!images) return;
    setConfirming(false);
    const ctrl = new AbortController();
    setGenerating(ctrl);
    setError(null);
    try {
      const r = await images.generate({ requestId: crypto.randomUUID(), projectId, prompt: prompt.trim(), aspect }, ctrl.signal);
      // Fornecedores que só geram quadrados: recorte central para o formato do espaço.
      const blob = await cropToAspect(r.blob, aspect);
      onChoose({ display: URL.createObjectURL(blob), pending: blob, origin: 'generated', costUsd: r.costUsd });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setGenerating(null);
    }
  };

  const onPage = pageImages(editor);
  return (
    <div className="ai-image-slot" data-testid="ai-image-slot">
      <div className="ai-image-slot-head">
        <strong>
          {what}
          {alt ? ` · «${alt}»` : target ? ` · ${target.getName?.() ?? ''}` : ''}
        </strong>
        {source.kind === 'choose' && source.hint && <span className="hint">Sugestão: {source.hint}</span>}
      </div>
      {choice ? (
        <div className="ai-image-chosen" data-testid="ai-image-chosen">
          <img className="img-thumb" src={choice.display} alt="Imagem escolhida para a proposta" />
          <span className="hint">
            {choice.origin === 'generated'
              ? `Imagem ${images?.simulated ? 'SIMULADA (não é IA)' : 'gerada'}${admin && choice.costUsd ? ` · custo registado ${formatUsd(choice.costUsd)}` : ''}. Só substitui a atual se aplicar a proposta.`
              : choice.origin === 'upload'
                ? 'Imagem carregada: só é guardada no projeto se aplicar a proposta.'
                : 'Imagem existente.'}
          </span>
        </div>
      ) : (
        <p className="hint" data-testid="ai-image-missing">
          Por escolher.
        </p>
      )}
      <div className="ai-actions">
        <Button variant="ghost" onClick={openPicker} disabled={generating !== null} data-testid="ai-image-pick">
          <ImagePlus aria-hidden="true" /> Escolher existente
        </Button>
        <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={generating !== null} data-testid="ai-image-upload">
          <Upload aria-hidden="true" /> Carregar
        </Button>
        <input ref={fileRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} className="sr-only" data-testid="ai-image-file" onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
      {images ? (
        <div className="ai-generate" data-testid="ai-generate-box">
          <label className="field">
            <span>Descrição da imagem a gerar</span>
            <textarea className="textarea" rows={2} maxLength={1000} value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={generating !== null} data-testid="ai-generate-prompt" />
          </label>
          <div className="ai-actions">
            <select className="select" value={aspect} onChange={(e) => setAspect(IMAGE_ASPECTS.find((a) => a === e.target.value) ?? '16:9')} aria-label="Proporção" data-testid="ai-generate-aspect">
              {IMAGE_ASPECTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                  {a === measured ? ' (espaço)' : ''}
                </option>
              ))}
            </select>
            {generating ? (
              <>
                <Spinner label="A gerar a imagem…" />
                <Button variant="ghost" onClick={() => generating.abort()}>
                  Cancelar
                </Button>
              </>
            ) : (
              <Button onClick={() => setConfirming(true)} disabled={prompt.trim().length < 3} data-testid="ai-generate">
                <Wand2 aria-hidden="true" /> Gerar imagem{admin ? ` (${images.simulated ? 'simulada, sem custo' : `≈ ${formatUsd(images.priceUsd ?? 0)}`})` : images.simulated ? ' (simulada)' : ''}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <ImageGenNotice admin={admin} status={status} onConfigure={() => navigate('/configuracoes/ia')} />
      )}
      {error && (
        <p className="error-text" role="alert" data-testid="ai-image-error">
          {error}
        </p>
      )}

      <Modal
        open={confirming}
        title="Gerar imagem?"
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => void generate()} data-testid="ai-generate-confirm">
              {admin ? `Gerar (${images?.simulated ? 'sem custo' : `≈ ${formatUsd(images?.priceUsd ?? 0)}`})` : 'Gerar imagem'}
            </Button>
          </>
        }
      >
        <p style={{ margin: 0 }} data-testid="ai-generate-cost">
          {images?.simulated
            ? `Simulador: é desenhada uma imagem de teste identificada como SIMULADA${admin ? ', sem custo' : ''}.`
            : admin
              ? `Gerar uma imagem com ${images?.label ?? 'o fornecedor configurado'} custa até ${formatUsd(images?.priceUsd ?? 0)}. O custo fica registado mesmo que depois descarte a imagem. A imagem gerada NÃO substitui a atual: só entra no site se aplicar a proposta.`
              : 'Gerar uma imagem nova com IA a partir desta descrição? Conta para o limite de utilização, mesmo que depois a descarte. A imagem gerada NÃO substitui a atual: só entra no site se aplicar a proposta.'}
          {` Descrição: «${prompt.trim()}».`}
        </p>
      </Modal>

      <Modal open={picking} title="Escolher imagem" onClose={() => setPicking(false)}>
        <div className="field">
          <span className="field-label">Imagens desta página</span>
          {onPage.length ? (
            <div className="asset-grid">
              {onPage.map((src) => (
                <button
                  key={src}
                  type="button"
                  aria-label="Usar esta imagem"
                  onClick={() => {
                    onChoose({ display: src, stored: urls.refOf(src), origin: 'page' });
                    setPicking(false);
                  }}
                  data-testid="ai-pick-page-image"
                >
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
          ) : (
            <p className="hint">Sem imagens nesta página.</p>
          )}
        </div>
        {assets.listLibrary && (
          <div className="field">
            <span className="field-label">Disponíveis no workspace</span>
            {library === null ? (
              <Spinner />
            ) : library.length ? (
              <div className="asset-grid">
                {library.map((it) => (
                  <button
                    key={it.ref}
                    type="button"
                    aria-label="Usar esta imagem"
                    onClick={() => {
                      onChoose({ display: it.display, stored: it.ref, origin: 'library' });
                      setPicking(false);
                    }}
                    data-testid="ai-pick-library-image"
                  >
                    <img src={it.display} alt="" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="hint">Sem imagens carregadas no workspace.</p>
            )}
          </div>
        )}
      </Modal>
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
      <ScaledPreview key={`${view}-${before.length}-${after.length}`} html={view === 'before' ? before : after} device={device} title={view === 'before' ? 'Antes das alterações' : 'Depois das alterações'} testId={testId} {...(maxHeight ? { maxHeight } : {})} />
    </div>
  );
}
