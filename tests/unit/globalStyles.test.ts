import studioText from '../../amostra/projeto-teste-2026-09-16-091529.grapesjs?raw';
import elementorText from '../../amostra/[Modelo] [Elementor] Carla Santos.json?raw';
import type { Editor } from 'grapesjs';
import { describe, expect, it } from 'vitest';
import type { GrapesProjectData } from '../../src/contract/boltDocument';
import { createBoltEditor, getProjectData } from '../../src/engine/createBoltEditor';
import {
  continuousSlotEdit,
  createGlobalSetup,
  isGlobalSelector,
  readGlobalStyles,
  resetAll,
  slotValue,
  trackGlobalStyles,
  writeSlot,
} from '../../src/engine/globalStyles';
import { addPage } from '../../src/engine/pages';
import { analyzeImport, type Dependencies } from '../../src/importers/pipeline';
import { buildProjectData, getTemplate } from '../../src/templates/registry';

/**
 * Estilos globais com um template nativo e as duas amostras importadas (lidas, nunca alteradas).
 * Verifica: ler não altera; alterações só nas variáveis/regras globais; ligações do Studio
 * preservadas; regras de telemóvel e valores próprios intactos; histórico; gravar e reabrir.
 */
const offline: Dependencies = {
  fetch: async () => {
    throw new TypeError('offline');
  },
  probeImage: async () => false,
};
const file = (name: string, text: string) => ({ name, type: 'application/json', size: text.length, text: async () => text });
const tick = () => new Promise((r) => setTimeout(r, 30));

async function open(which: 'nimbus' | 'studio' | 'elementor'): Promise<Editor> {
  let data: GrapesProjectData;
  if (which === 'nimbus') {
    const t = getTemplate('nimbus-lancamento');
    if (!t) throw new Error('template');
    data = buildProjectData(t);
  } else {
    data = (await analyzeImport(file(which, which === 'studio' ? studioText : elementorText), offline)).projectData;
  }
  const e = createBoltEditor({ projectData: data });
  await tick();
  e.UndoManager.clear();
  return e;
}

const keyOf = (e: Editor, name: string, scope?: string) => {
  const s = readGlobalStyles(e).slots.find((x) => x.name === name && (!scope || x.scope === scope));
  if (!s) throw new Error(`campo ${name} ${scope ?? ''}`);
  return s.key;
};
/** Regras com media query e regras próprias (#id): nunca podem mudar com os estilos globais. */
const protectedRules = (e: Editor) =>
  JSON.stringify(
    e.Css.getRules()
      .filter((r) => r.get('mediaText') || /^#/.test(r.selectorsToString()))
      .map((r) => [r.selectorsToString(), r.get('mediaText'), r.getStyle({ skipResolve: true })]),
  );

describe('Estilos globais · leitura', () => {
  it.each(['nimbus', 'studio', 'elementor'] as const)('%s: abrir o painel (ler e registar) não altera o documento nem o histórico', async (which) => {
    const e = await open(which);
    const before = JSON.stringify(getProjectData(e));
    readGlobalStyles(e);
    trackGlobalStyles(e);
    readGlobalStyles(e);
    await tick();
    expect(JSON.stringify(getProjectData(e))).toBe(before);
    expect(e.UndoManager.hasUndo()).toBe(false);
  });

  it('identifica o que tem associação global e nada mais', async () => {
    const nimbus = readGlobalStyles(await open('nimbus'));
    expect(nimbus.slots.filter((s) => s.group === 'colors').map((s) => s.name)).toEqual(['--bolt-primary', '--bolt-on-primary', '--bolt-text', '--bolt-heading', '--bolt-bg']);
    expect(nimbus.slots.some((s) => s.name === '--bolt-font-heading' && s.group === 'typography')).toBe(true);
    // Cores fixas repetidas em regras de classes (ex.: #0f172a) não são tratadas como variáveis.
    expect(nimbus.slots.every((s) => isGlobalSelector(s.scope))).toBe(true);

    const studio = readGlobalStyles(await open('studio'));
    const primary = studio.slots.find((s) => s.name === '--gjs-t-color-primary');
    expect(primary).toMatchObject({ group: 'colors', label: 'Cor principal', scope: ':root', record: { source: 'globalStyles', id: 'color-primary' } });
    // O nome original e o técnico ficam como informação secundária.
    expect(primary?.technical).toBe('«Primary» no ficheiro · --gjs-t-color-primary em :root');
    expect(studio.slots.find((s) => s.scope === '.gjs-t-body' && s.prop === 'font-family')?.record?.id).toBe('body-font-family');
    expect(studio.projectFonts).toEqual(expect.arrayContaining(['Barlow', 'Poppins']));

    const elementor = readGlobalStyles(await open('elementor'));
    expect(elementor.hasVariables).toBe(false);
    expect(elementor.slots.some((s) => s.scope.startsWith('#'))).toBe(false);
  });
});

describe('Estilos globais · template nativo (Nimbus)', () => {
  it('muda a variável em todas as páginas, sem tocar em regras de telemóvel nem valores próprios; um passo de histórico', async () => {
    const e = await open('nimbus');
    trackGlobalStyles(e);
    const protectedBefore = protectedRules(e);
    const rulesBefore = e.Css.getRules().length;
    const p2 = addPage(e, 'Contactos');
    p2.getMainComponent().append({ type: 'bolt-button', classes: ['bolt-btn'], content: 'Pedir', attributes: { href: '#' } });
    await tick();
    e.UndoManager.clear();

    expect(writeSlot(e, keyOf(e, '--bolt-primary'), '#e11d48')).toBe(true);
    expect(e.getCss()).toContain('--bolt-primary:#e11d48');
    expect(e.UndoManager.getStackGroup().length).toBe(1);
    expect(protectedRules(e)).toBe(protectedBefore);
    expect(e.Css.getRules().length).toBe(rulesBefore);

    // Fonte partilhada.
    await tick();
    writeSlot(e, keyOf(e, '--bolt-font-heading'), "Georgia, 'Times New Roman', serif");
    await tick();
    expect(e.UndoManager.getStackGroup().length).toBe(2);
    e.UndoManager.undo();
    expect(slotValue(e, keyOf(e, '--bolt-font-heading'))).toBe("'Inter', 'Segoe UI', system-ui, sans-serif");
    e.UndoManager.redo();
    expect(slotValue(e, keyOf(e, '--bolt-font-heading'))).toContain('Georgia');

    // Gravar e reabrir.
    const again = createBoltEditor({ projectData: getProjectData(e) });
    expect(slotValue(again, keyOf(again, '--bolt-primary'))).toBe('#e11d48');
    expect(again.Pages.getAll()).toHaveLength(2);
    expect(protectedRules(again)).toBe(protectedBefore);
  });

  it('seletor de cor: pré-visualização contínua e um único passo; «Repor tudo» num passo, sem apagar regras', async () => {
    const e = await open('nimbus');
    trackGlobalStyles(e);
    const key = keyOf(e, '--bolt-heading');
    const live = continuousSlotEdit(e, key);
    live.preview('#111111');
    live.preview('#222222');
    live.preview('#333333');
    live.commit('#333333');
    await tick();
    expect(e.UndoManager.getStackGroup().length).toBe(1);
    e.UndoManager.undo();
    expect(slotValue(e, key)).toBe('#0f172a');
    expect(e.UndoManager.hasUndo()).toBe(false);

    e.UndoManager.redo();
    await tick();
    writeSlot(e, keyOf(e, '--bolt-primary'), '#000000');
    await tick();
    const rules = e.Css.getRules().length;
    const steps = e.UndoManager.getStackGroup().length;
    expect(resetAll(e)).toBe(2);
    await tick();
    expect(slotValue(e, key)).toBe('#0f172a');
    expect(slotValue(e, keyOf(e, '--bolt-primary'))).toBe('#4f46e5');
    expect(e.Css.getRules().length).toBe(rules);
    expect(e.UndoManager.getStackGroup().length).toBe(steps + 1);
  });
});

describe('Estilos globais · amostra GrapesJS Studio', () => {
  it('edita o registo ligado: a ligação, o nome e o âmbito ficam; histórico e reabertura', async () => {
    const e = await open('studio');
    trackGlobalStyles(e);
    const protectedBefore = protectedRules(e);
    const key = keyOf(e, '--gjs-t-color-primary');
    writeSlot(e, key, '#ff6600');
    await tick();
    expect(e.getCss()).toMatch(/:root\{[^}]*--gjs-t-color-primary:#ff6600/);
    // As regras que usam a variável continuam a usá-la (não foram convertidas em valores fixos).
    expect(e.getCss()).toMatch(/\.gjs-t-h2\{color:var\(--gjs-t-color-primary\)/);
    const data = getProjectData(e);
    const root = (data.styles as Array<{ selectorsAdd?: string; style?: Record<string, unknown> }>).find((r) => r.selectorsAdd === ':root');
    expect(root?.style?.['--gjs-t-color-primary']).toMatchObject({ type: 'data-variable', path: 'globalStyles.color-primary.value' });
    expect(JSON.stringify(data.dataSources)).toContain('"value":"#ff6600"');
    expect(protectedRules(e)).toBe(protectedBefore);

    // Fonte partilhada (registo body-font-family); um elemento com fonte própria mantém a sua.
    const font = keyOf(e, 'font-family', '.gjs-t-body');
    writeSlot(e, font, "Georgia, 'Times New Roman', serif");
    await tick();
    expect(e.getCss()).toMatch(/\.gjs-t-body\{[^}]*font-family:Georgia/);
    expect(e.getCss()).toMatch(/#iplayer2rank\{[^}]*font-family:Barlow/);

    expect(e.UndoManager.getStackGroup().length).toBe(2);
    e.UndoManager.undo();
    expect(slotValue(e, font)).toBe('Barlow');
    e.UndoManager.undo();
    expect(slotValue(e, key)).toBe('#22D3EE');
    e.UndoManager.redo();

    const again = createBoltEditor({ projectData: getProjectData(e) });
    expect(slotValue(again, keyOf(again, '--gjs-t-color-primary'))).toBe('#ff6600');
    expect(again.getCss()).toMatch(/\.gjs-t-h2\{color:var\(--gjs-t-color-primary\)/);
  });

  it('página nova herda a classe do corpo (gjs-t-body) para seguir os estilos globais', async () => {
    const e = await open('studio');
    const p = addPage(e, 'Segunda');
    expect(p.getMainComponent().getClasses()).toContain('gjs-t-body');
  });
});

describe('Estilos globais · amostra Elementor (sem configuração global)', () => {
  it('«Criar estilos globais» liga o corpo a variáveis com os valores atuais, num passo, sem tocar em valores próprios', async () => {
    const e = await open('elementor');
    trackGlobalStyles(e);
    const protectedBefore = protectedRules(e);
    createGlobalSetup(e);
    await tick();
    const css = e.getCss() ?? '';
    expect(css).toMatch(/body\{[^}]*color:var\(--bolt-text\)/);
    expect(css).toMatch(/--bolt-text:#333333/);
    expect(css).toContain('font-family:var(--bolt-font-body)');
    expect(protectedRules(e)).toBe(protectedBefore);
    const g = readGlobalStyles(e);
    expect(g.hasVariables).toBe(true);
    expect(g.slots.find((s) => s.name === '--bolt-text')?.group).toBe('colors');
    expect(e.UndoManager.getStackGroup().length).toBe(1);
    e.UndoManager.undo();
    expect(readGlobalStyles(e).hasVariables).toBe(false);
    expect(e.getCss()).toMatch(/body\{[^}]*color:#333333/);
  });
});
