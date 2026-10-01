import type { Component, Editor } from 'grapesjs';
import { describe, expect, it } from 'vitest';
import type { AiProposeRequest, AiProposeResponse } from '../../supabase/functions/_shared/ai/contract.ts';
import { SimulatedProposer, type Proposer } from '../../src/ai/proposers';
import { runQuickEdit } from '../../src/ai/quickEdit';
import { createBoltEditor } from '../../src/engine/createBoltEditor';
import { buildProjectData, getTemplate } from '../../src/templates/registry';

/**
 * [simulado] «Editar com IA» rápido: o mesmo contrato e validação do painel, mas aplica logo.
 * Sem canvas (headless): a verificação visual dos estilos é feita nos testes E2E.
 */
const tick = () => new Promise((r) => setTimeout(r, 30));

async function nimbus(): Promise<Editor> {
  const t = getTemplate('nimbus-lancamento');
  if (!t) throw new Error('template');
  const e = createBoltEditor({ projectData: buildProjectData(t) });
  await tick();
  e.UndoManager.clear();
  return e;
}

function first(root: Component, tag: string): Component {
  const walk = (c: Component): Component | undefined => (String(c.get('tagName')) === tag || c.get('type') === tag ? c : c.components().models.map(walk).find(Boolean));
  const found = walk(root);
  if (!found) throw new Error(tag);
  return found;
}

const run = (editor: Editor, component: Component, instruction: string, proposer: Proposer = new SimulatedProposer(0), signal = new AbortController().signal) =>
  runQuickEdit({ editor, proposer, projectId: 'p1', device: 'desktop', instruction, component, signal });

describe('Editar com IA rápido', () => {
  it('pedido de imagem de fundo NOVA (texto do print): com gerador segue para gerar; sem gerador, para escolher — nada aplicado', async () => {
    const editor = await nimbus();
    const section = first(editor.getWrapper() as Component, 'section');
    const ask = (imageGeneration: boolean) =>
      runQuickEdit({ editor, proposer: new SimulatedProposer(0), projectId: 'p1', device: 'desktop', instruction: 'criar uma imagem de fundo com alunos vindo para casa', component: section, signal: new AbortController().signal, imageGeneration });
    const withGen = await ask(true);
    expect(withGen.kind).toBe('needs-images');
    if (withGen.kind !== 'needs-images') return;
    expect(withGen.generate).toBe(true);
    expect(withGen.handoff.autoGenerate).toBe(true);
    expect(withGen.handoff.request.imageGeneration).toBe(true);
    expect(withGen.handoff.response.proposal.operations).toEqual([
      { op: 'setBackgroundImage', id: section.getId(), device: 'desktop', image: { kind: 'generate', prompt: 'alunos vindo para casa', aspect: '16:9' } },
    ]);
    const without = await ask(false);
    expect(without.kind === 'needs-images' && without.generate).toBe(false);
    expect(editor.UndoManager.hasUndo()).toBe(false);
  });

  it('aplica logo a proposta validada num só passo de desfazer', async () => {
    const editor = await nimbus();
    const h1 = first(editor.getWrapper() as Component, 'h1');
    const before = h1.getInnerHTML();
    const r = await run(editor, h1, 'texto: Rápido; cor #b91c1c');
    expect(r.kind).toBe('applied');
    if (r.kind !== 'applied') return;
    expect(r.changes.length).toBe(2);
    expect(h1.getInnerHTML()).toBe('Rápido');
    editor.UndoManager.undo();
    expect(h1.getInnerHTML()).toBe(before);
    expect(editor.UndoManager.hasUndo()).toBe(false);
  });

  it('não aplica o que pede decisão: esclarecimento, imagens, proposta inválida, nada proposto', async () => {
    const editor = await nimbus();
    const root = editor.getWrapper() as Component;
    const h1 = first(root, 'h1');
    expect((await run(editor, h1, '[simulado:ambiguo] a imagem')).kind).toBe('clarify');
    expect((await run(editor, first(root, 'image'), 'imagem: escolher')).kind).toBe('needs-images');
    const invalid = await run(editor, h1, '[simulado:invalido] x');
    expect(invalid.kind).toBe('error');
    expect((await run(editor, h1, 'algo que o simulador não entende')).kind).toBe('nothing');
    expect(editor.UndoManager.hasUndo()).toBe(false);
  });

  it('cancelar descarta a resposta; o documento mudado entretanto invalida a proposta', async () => {
    const editor = await nimbus();
    const h1 = first(editor.getWrapper() as Component, 'h1');
    const ctrl = new AbortController();
    const pending = run(editor, h1, '[simulado:lento] texto: Tarde', new SimulatedProposer(), ctrl.signal);
    ctrl.abort();
    expect((await pending).kind).toBe('cancelled');
    // Proponente que muda o documento antes de responder (outra edição durante a espera).
    const sim = new SimulatedProposer(0);
    const racing: Proposer = {
      label: 'teste',
      simulated: true,
      propose: async (req: AiProposeRequest, signal: AbortSignal): Promise<AiProposeResponse> => {
        const res = await sim.propose(req, signal);
        h1.components('Outro texto');
        return res;
      },
    };
    const r = await run(editor, h1, 'texto: Proposto', racing);
    expect(r.kind).toBe('error');
    expect(h1.getInnerHTML()).toBe('Outro texto');
  });
});
