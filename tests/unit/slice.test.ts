import type { Component, Editor } from 'grapesjs';
import { describe, expect, it } from 'vitest';
import { findComponentsWithoutId, parseBoltDocument } from '../../src/contract/boltDocument';
import { blockById, BLOCKS } from '../../src/engine/blocks';
import { createBoltEditor, getProjectData, renderProjectHtml } from '../../src/engine/createBoltEditor';
import { displayName } from '../../src/engine/labels';
import { canPlace, duplicate, findById, insertBlock, move, moveBy, remove, setLink, setText } from '../../src/engine/operations';
import { getOwnStyle, setOwnStyle } from '../../src/engine/styles';
import { buildProjectData, getTemplate, TEMPLATES } from '../../src/templates/registry';

const all = (c: Component): Component[] => [c, ...c.components().models.flatMap(all)];
const components = (e: Editor): Component[] => {
  const w = e.getWrapper();
  return w ? all(w) : [];
};
const byTag = (e: Editor, tag: string) => components(e).filter((c) => c.get('tagName') === tag);
const byType = (e: Editor, type: string) => components(e).filter((c) => c.get('type') === type);
const byText = (e: Editor, text: string) => components(e).find((c) => c.get('type') !== 'textnode' && c.getInnerHTML() === text);
const must = <T,>(v: T | null | undefined, what: string): T => {
  if (v === null || v === undefined) throw new Error(`Em falta: ${what}`);
  return v;
};
const reopen = (e: Editor): Editor => createBoltEditor({ projectData: JSON.parse(JSON.stringify(getProjectData(e))) });
const nimbus = () => must(getTemplate('nimbus-lancamento'), 'template Nimbus');
const vertice = () => must(getTemplate('vertice-servicos'), 'template Vértice');

describe('Templates', () => {
  it('cada template tem navegação, hero, conteúdo e rodapé, com ids estáveis e envelope válido', () => {
    for (const t of TEMPLATES) {
      const data = buildProjectData(t);
      const e = createBoltEditor({ projectData: data });
      const top = must(e.getWrapper(), 'wrapper').components().models.map((c) => c.get('type'));
      expect(top[0]).toBe('bolt-navbar');
      expect(top.filter((x) => x === 'bolt-section').length).toBeGreaterThanOrEqual(3);
      expect(top.at(-1)).toBe('bolt-footer');
      expect(byTag(e, 'h1')).toHaveLength(1);
      expect(findComponentsWithoutId(data)).toEqual([]);
      const doc = { boltSchemaVersion: 1, engine: { name: 'grapesjs', version: 'test' }, projectId: 'p', revision: 0, projectData: data };
      expect(parseBoltDocument(doc).ok).toBe(true);
    }
  });

  it('preserva a distinção entre logótipo em texto (Nimbus) e em imagem (Vértice)', () => {
    const logos = (data: ReturnType<typeof buildProjectData>) => components(createBoltEditor({ projectData: data })).filter((c) => c.getAttributes()['data-bolt-role'] === 'logo');
    const textLogos = logos(buildProjectData(nimbus()));
    expect(textLogos.length).toBeGreaterThan(0);
    expect(textLogos.every((c) => c.get('type') === 'text')).toBe(true);
    expect(displayName(must(textLogos[0], 'logo'))).toBe('Logótipo (texto)');
    const imageLogos = logos(buildProjectData(vertice()));
    expect(imageLogos.length).toBeGreaterThan(0);
    expect(imageLogos.every((c) => c.get('type') === 'image')).toBe(true);
    expect(displayName(must(imageLogos[0], 'logo'))).toBe('Logótipo (imagem)');
  });

  it('instanciar cria cópias independentes e editar uma cópia não altera o template', () => {
    const t = nimbus();
    const before = JSON.stringify(t);
    const first = buildProjectData(t);
    const e = createBoltEditor({ projectData: first });
    const h1 = must(byTag(e, 'h1')[0], 'h1');
    setText(e, h1.getId(), 'Título do cliente');
    setOwnStyle(e, h1, 'desktop', { color: '#ff0000' });
    remove(e, must(byType(e, 'bolt-footer')[0], 'rodapé').getId());
    expect(JSON.stringify(t)).toBe(before);
    expect(Object.isFrozen(t.components)).toBe(true);
    const second = buildProjectData(t);
    // Cada cópia recebe ids próprios; estrutura, conteúdo e estilos são iguais aos do template.
    const withoutIds = (v: unknown) => JSON.stringify(v, (k, val: unknown) => (k === 'id' ? undefined : val));
    expect(withoutIds(second)).toBe(withoutIds(first));
    expect(JSON.stringify(second)).not.toContain('Título do cliente');
  });

  it('um projeto em branco é válido e fica pronto para receber blocos', () => {
    const data = buildProjectData(null);
    const e = createBoltEditor({ projectData: data });
    expect(must(e.getWrapper(), 'wrapper').components().length).toBe(0);
    const section = insertBlock(e, must(blockById('section'), 'bloco').content());
    expect(section.parent()?.is('wrapper')).toBe(true);
  });
});

describe('Nomes compreensíveis', () => {
  it('traduz o modelo para nomes do utilizador', () => {
    const e = createBoltEditor({ projectData: buildProjectData(nimbus()) });
    expect(displayName(must(byTag(e, 'h1')[0], 'h1'))).toBe('Título');
    expect(displayName(must(byType(e, 'bolt-section')[0], 'secção'))).toBe('Secção');
    expect(displayName(must(byType(e, 'bolt-button')[0], 'botão'))).toBe('Botão');
    expect(displayName(must(byType(e, 'image').find((c) => !c.getAttributes()['data-bolt-role']), 'imagem'))).toBe('Imagem');
    expect(displayName(must(e.getWrapper(), 'wrapper'))).toBe('Página');
    // O destaque do canvas usa os mesmos nomes.
    expect(must(byTag(e, 'h1')[0], 'h1').getName()).toBe('Título');
  });
});

describe('Posições válidas', () => {
  it('secções só no nível da página; linhas de colunas só aceitam colunas', () => {
    const e = createBoltEditor({ projectData: buildProjectData(nimbus()) });
    const section = must(byType(e, 'bolt-section')[1], 'secção');
    const column = must(byType(e, 'bolt-column')[0], 'coluna');
    const columns = must(byType(e, 'bolt-columns')[0], 'colunas');
    const title = must(byTag(e, 'h1')[0], 'h1');
    expect(canPlace(e, column, section, 0)).toBe(false);
    expect(canPlace(e, must(e.getWrapper(), 'wrapper'), section, 0)).toBe(true);
    expect(canPlace(e, columns, title, 0)).toBe(false);
    expect(canPlace(e, column, title, 0)).toBe(true);
    expect(() => move(e, section.getId(), column.getId(), 0)).toThrow(/Destino inválido/);
  });

  it('inserir um bloco a partir de um elemento interior encontra a primeira posição válida', () => {
    const e = createBoltEditor({ projectData: buildProjectData(nimbus()) });
    const h1 = must(byTag(e, 'h1')[0], 'h1');
    const heading = insertBlock(e, must(blockById('heading'), 'bloco').content(), h1);
    expect(heading.parent()).toBe(h1.parent());
    expect(heading.index()).toBe(h1.index() + 1);
    const section = insertBlock(e, must(blockById('section'), 'bloco').content(), h1);
    expect(section.parent()?.is('wrapper')).toBe(true);
    expect(e.getSelected()).toBe(section);
  });

  it('todos os blocos da biblioteca entram numa página em branco e ficam com ids', () => {
    const e = createBoltEditor({ projectData: buildProjectData(null) });
    const section = insertBlock(e, must(blockById('section'), 'bloco').content());
    const container = must(section.components().at(0), 'contentor');
    for (const b of BLOCKS.filter((x) => x.id !== 'section')) insertBlock(e, b.content(), container);
    expect(findComponentsWithoutId(getProjectData(e))).toEqual([]);
    const html = renderProjectHtml(getProjectData(e)).html;
    expect(html).toContain('data-bolt-type="columns"');
    expect(html).toContain('data-bolt-type="button"');
    expect(html).toContain('<img');
  });
});

describe('Edição que sobrevive a guardar e reabrir', () => {
  it('reordenar, duplicar, eliminar, editar ligações e estilos por dispositivo', () => {
    const e = createBoltEditor({ projectData: buildProjectData(nimbus()) });
    e.UndoManager.clear();
    const menu = must(components(e).find((c) => c.getClasses().includes('nb-menu')), 'menu');
    const clientes = must(menu.components().at(2), 'ligação Clientes');
    expect(moveBy(e, clientes.getId(), -1)).toBe(true);
    expect(moveBy(e, must(menu.components().at(0), 'primeira').getId(), -1)).toBe(false);

    const cta = must(byType(e, 'bolt-button')[0], 'botão');
    setLink(e, cta.getId(), { text: 'Falar <já>', href: 'mailto:ola@exemplo.pt', newTab: true });

    const sections = byType(e, 'bolt-section').length;
    const clone = duplicate(e, must(byType(e, 'bolt-section')[1], 'secção').getId());
    const h1 = must(byTag(e, 'h1')[0], 'h1');
    setOwnStyle(e, h1, 'desktop', { color: '#dc2626' });
    setOwnStyle(e, h1, 'mobile', { 'font-size': '28px' });
    const eyebrow = must(byText(e, 'Novo · Relatórios automáticos'), 'etiqueta');
    remove(e, eyebrow.getId());

    const r = reopen(e);
    const rMenu = must(components(r).find((c) => c.getClasses().includes('nb-menu')), 'menu');
    expect(rMenu.components().models.map((c) => c.getInnerHTML())).toEqual(['Recursos', 'Clientes', 'Como funciona']);
    const rCta = must(findById(r, cta.getId()), 'botão');
    expect(rCta.getInnerHTML()).toBe('Falar &lt;já&gt;');
    expect(rCta.components().models.every((c) => c.get('type') === 'textnode')).toBe(true);
    expect(rCta.getAttributes()).toMatchObject({ href: 'mailto:ola@exemplo.pt', target: '_blank' });
    expect(byType(r, 'bolt-section')).toHaveLength(sections + 1);
    expect(findById(r, clone.getId())).toBeDefined();
    expect(byText(r, 'Novo · Relatórios automáticos')).toBeUndefined();
    const rH1 = must(findById(r, h1.getId()), 'h1');
    expect(getOwnStyle(r, rH1, 'desktop')).toEqual({ color: '#dc2626' });
    expect(getOwnStyle(r, rH1, 'mobile')).toEqual({ 'font-size': '28px' });
    expect(r.getCss()).toContain('@media (max-width: 480px)');
  });

  it('estilos por dispositivo entram no histórico de desfazer', () => {
    const e = createBoltEditor({ projectData: buildProjectData(nimbus()) });
    e.UndoManager.clear();
    const h1 = must(byTag(e, 'h1')[0], 'h1');
    setOwnStyle(e, h1, 'tablet', { 'text-align': 'center' });
    expect(getOwnStyle(e, h1, 'tablet')).toEqual({ 'text-align': 'center' });
    e.UndoManager.undo();
    expect(getOwnStyle(e, h1, 'tablet')).toEqual({});
  });
});
