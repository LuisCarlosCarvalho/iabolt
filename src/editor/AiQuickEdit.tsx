import type { Component, Editor } from 'grapesjs';
import { AlertTriangle, Check, Sparkles, Undo2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AI_CONTRACT_VERSION, type AiProposeRequest } from '../../supabase/functions/_shared/ai/contract.ts';
import { buildScopeContext, planParts, resolveScope } from '../ai/context';
import { estimateRequestUsd, formatUsd } from '../ai/cost';
import { runQuickEdit, type QuickEditResult } from '../ai/quickEdit';
import { describeHidden } from '../ai/visibility';
import { Button, IconButton, Spinner } from '../app/ui';
import { displayName } from '../engine/labels';
import type { DeviceId } from '../engine/styles';
import { measure, type Box } from './CanvasToolbar';
import { useAssistant } from './useAssistant';
import { useEditorTick } from './useEditorTick';

/**
 * Janela pequena «Editar com IA», aberta pelo botão da barra do elemento: escreve-se o pedido e
 * «Alterar» aplica logo a proposta validada (um só «Desfazer»). Usa o mesmo assistente, contrato,
 * validação e custos do painel. O que precisa de decisão (esclarecimento, imagens, pedido grande)
 * continua no painel completo («Mais opções»), com o texto já escrito.
 */
type Phase = { kind: 'idle' } | { kind: 'working'; ctrl: AbortController } | { kind: 'done'; result: QuickEditResult; n: number };

const WIDTH = 340;
const GAP = 8;
/** Espaço da barra do elemento (por cima dele): a janela não a tapa. */
const BAR = 40;

/**
 * Posição no contentor do canvas: por baixo do elemento; se não couber, por cima (acima da barra);
 * senão, encostada ao fundo. Nunca sai do contentor (o conteúdo tem scroll próprio).
 */
function place(box: Box | null, hostW: number, hostH: number, height: number): { top: number; left: number; maxHeight: number } {
  const maxHeight = Math.max(160, hostH - 2 * GAP);
  const h = Math.min(height, maxHeight);
  const left = Math.min(Math.max(GAP, (box?.left ?? GAP) + (box ? Math.min(box.width, 400) / 2 - WIDTH / 2 : 0)), Math.max(GAP, hostW - WIDTH - GAP));
  if (!box) return { top: GAP, left, maxHeight };
  const below = box.top + box.height + GAP;
  if (below + h <= hostH - GAP) return { top: Math.max(GAP, below), left, maxHeight };
  const above = box.top - BAR - h - GAP;
  if (above >= GAP) return { top: above, left, maxHeight };
  return { top: Math.max(GAP, hostH - h - GAP), left, maxHeight };
}

/** Só em desenvolvimento: os testes E2E leem o pedido enviado. */
function expose(req: AiProposeRequest): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  window.__boltAiLastRequest = req;
  window.__boltAiRequests = [req];
  window.__boltAiSent = (window.__boltAiSent ?? 0) + 1;
}

export function AiQuickEdit({
  editor,
  component,
  host,
  projectId,
  device,
  onClose,
  onMore,
}: {
  editor: Editor;
  component: Component;
  host: HTMLElement;
  projectId: string;
  device: DeviceId;
  onClose: () => void;
  onMore: (text: string) => void;
}) {
  useEditorTick(editor);
  const { proposer, status } = useAssistant();
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const input = useRef<HTMLTextAreaElement>(null);
  const self = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(() => measure(editor, component, host));
  const [height, setHeight] = useState(220);
  // Acompanha o elemento (scroll do canvas, zoom, dispositivo), como a barra do elemento.
  useEffect(() => {
    let raf = 0;
    let last = '';
    const tick = () => {
      const next = measure(editor, component, host);
      const key = next ? `${Math.round(next.top)}|${Math.round(next.left)}|${Math.round(next.width)}|${Math.round(next.height)}` : '';
      if (key !== last) {
        last = key;
        setBox(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editor, component, host]);
  // Altura real da janela (muda com o resultado), para a posicionar sem sair do contentor.
  useLayoutEffect(() => {
    const el = self.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.scrollHeight));
    ro.observe(el);
    setHeight(el.scrollHeight);
    return () => ro.disconnect();
  }, []);
  const alive = useRef(true);
  const runs = useRef(0);
  useEffect(() => {
    alive.current = true;
    input.current?.focus();
    return () => {
      alive.current = false;
    };
  }, []);

  // Outra seleção (ou o elemento deixou de existir): a janela fecha, salvo durante um pedido.
  const selected = editor.getSelected();
  const working = phase.kind === 'working';
  useEffect(() => {
    if (!working && selected !== component) onClose();
  }, [working, selected, component, onClose]);

  const pricing = status?.pricing;
  // Elemento só: o contexto é pequeno; recalculado quando o texto ou o documento mudam.
  const cost = (() => {
    if (!pricing || !proposer || proposer.simulated) return null;
    try {
      const scope = resolveScope(editor, 'element', component);
      const part = scope ? planParts(buildScopeContext(editor, scope.scope, device))[0] : undefined;
      if (!scope || !part) return null;
      const draft: AiProposeRequest = { contract: AI_CONTRACT_VERSION, projectId, documentVersion: 'x', requestId: '00000000-0000-4000-8000-000000000000', scope: scope.scope, device, instruction: text || '.', imageGeneration: false, context: part.context };
      return estimateRequestUsd(pricing, draft);
    } catch {
      return null;
    }
  })();

  const submit = async () => {
    if (!proposer || working || !text.trim()) return;
    const ctrl = new AbortController();
    setPhase({ kind: 'working', ctrl });
    const result = await runQuickEdit({ editor, proposer, projectId, device, instruction: text, component, signal: ctrl.signal, onRequest: expose });
    if (!alive.current) return;
    if (result.kind === 'cancelled') {
      setPhase({ kind: 'idle' });
      return;
    }
    if (result.kind === 'applied') setText('');
    runs.current += 1;
    setPhase({ kind: 'done', result, n: runs.current });
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (working && phase.kind === 'working') phase.ctrl.abort();
      else onClose();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
  };

  const pos = place(box, host.clientWidth, host.clientHeight, height);
  const style = { top: pos.top, left: pos.left, width: WIDTH, maxHeight: pos.maxHeight };
  const done = phase.kind === 'done' ? phase : null;

  return (
    <div ref={self} className="ai-quick" role="dialog" aria-label="Editar com IA" style={style} onKeyDown={onKey} data-testid="ai-quick">
      <div className="ai-quick-head">
        <Sparkles aria-hidden="true" />
        <strong>Editar com IA</strong>
        <span className="ai-quick-target" title={displayName(component)}>
          · {displayName(component)}
        </span>
        <IconButton label="Fechar" className="ai-quick-close" onClick={() => (working && phase.kind === 'working' ? phase.ctrl.abort() : onClose())} data-testid="ai-quick-close">
          <X />
        </IconButton>
      </div>
      {!proposer ? (
        <p className="hint" data-testid="ai-quick-disabled">
          O assistente está desativado. Um administrador ativa-o em «Configurações de IA».
        </p>
      ) : (
        <>
          <textarea
            ref={input}
            className="textarea"
            rows={3}
            maxLength={1000}
            value={text}
            disabled={working}
            placeholder={proposer.simulated ? 'Ex.: texto: Fale connosco; cor #b91c1c' : 'Descreva a alteração. Ex.: muda o título para «Bem-vindo» e põe-no a azul escuro'}
            onChange={(e) => setText(e.target.value)}
            data-testid="ai-quick-input"
          />
          <p className="hint ai-quick-hint">
            {proposer.simulated ? 'Simulador: sem custo.' : cost !== null ? `Custo máximo estimado: ${formatUsd(cost)}.` : 'O custo é reservado no servidor antes da chamada.'} Ctrl+Enter
            para alterar.
          </p>
          <div className="ai-quick-actions">
            <Button variant="ghost" disabled={working} onClick={() => onMore(text)} data-testid="ai-quick-more">
              Mais opções
            </Button>
            {working ? (
              <Button onClick={() => phase.kind === 'working' && phase.ctrl.abort()} data-testid="ai-quick-cancel">
                Cancelar
              </Button>
            ) : null}
            <Button variant="primary" disabled={working || !text.trim()} onClick={() => void submit()} data-testid="ai-quick-apply">
              {working ? <Spinner label="A alterar…" /> : 'Alterar'}
            </Button>
          </div>
        </>
      )}
      {done && <QuickResult key={done.n} result={done.result} onUndo={() => editor.UndoManager.undo()} onMore={() => onMore(text)} />}
    </div>
  );
}

function QuickResult({ result, onUndo, onMore }: { result: QuickEditResult; onUndo: () => void; onMore: () => void }) {
  const [undone, setUndone] = useState(false);
  switch (result.kind) {
    case 'applied':
      return (
        <div className="ai-quick-result" role="status" data-testid="ai-quick-result">
          <p className="ai-quick-ok">
            <Check aria-hidden="true" /> {undone ? 'Alteração desfeita.' : `Alterado (${result.changes.length || result.ops.length}).`}
          </p>
          {!undone && (
            <ul className="ai-quick-lines">
              {result.changes.slice(0, 4).map((c, i) => (
                <li key={i}>
                  {c.what}: {c.before ? <s>{c.before}</s> : null} {c.after}
                </li>
              ))}
            </ul>
          )}
          {!undone && result.hidden.length > 0 && (
            <div className="ai-quick-warn" role="alert" data-testid="ai-quick-hidden">
              <AlertTriangle aria-hidden="true" />
              <div>
                <strong>Parte da alteração não se vê na página.</strong>
                <ul>
                  {result.hidden.map((h) => (
                    <li key={`${h.id}-${h.prop}`}>{describeHidden(h)}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {!undone && (
            <Button
              variant="ghost"
              onClick={() => {
                onUndo();
                setUndone(true);
              }}
              data-testid="ai-quick-undo"
            >
              <Undo2 aria-hidden="true" /> Desfazer
            </Button>
          )}
        </div>
      );
    case 'nothing':
      return (
        <p className="hint ai-quick-result" role="status" data-testid="ai-quick-result">
          Nada foi alterado: o assistente não propôs alterações{result.summary ? ` (${result.summary})` : ''}.
        </p>
      );
    case 'clarify':
      return (
        <div className="ai-quick-result" role="status" data-testid="ai-quick-result">
          <p>{result.question}</p>
          <p className="hint">Nada foi alterado.</p>
          <Button onClick={onMore}>Responder no assistente</Button>
        </div>
      );
    case 'needs-panel':
      return (
        <div className="ai-quick-result" role="status" data-testid="ai-quick-result">
          <p>{result.reason} Nada foi alterado.</p>
          <Button onClick={onMore}>Continuar no assistente</Button>
        </div>
      );
    case 'error':
      return (
        <div className="ai-quick-warn" role="alert" data-testid="ai-quick-error">
          <AlertTriangle aria-hidden="true" />
          <div>
            <p>{result.message}</p>
            {result.details && (
              <ul>
                {result.details.slice(0, 4).map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      );
    case 'cancelled':
      return null;
  }
}
