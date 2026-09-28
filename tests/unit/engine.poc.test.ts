import { describe, expect, it } from 'vitest';
import { createBoltEditor, getProjectData } from '../../src/engine/createBoltEditor';
import { POC_FIXTURE } from '../../src/engine/pocFixture';
import { duplicate, findById, move, remove, selectById, selectParent, setText, tree } from '../../src/engine/operations';
import { findComponentsWithoutId, parseBoltDocument } from '../../src/contract/boltDocument';
import type { Editor } from 'grapesjs';

function freshEditor(): Editor {
  const editor = createBoltEditor();
  editor.setComponents(POC_FIXTURE);
  editor.UndoManager.clear();
  return editor;
}

/** Falha o teste com mensagem clara em vez de usar asserções não-nulas. */
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Em falta: ${what}`);
  return value;
}

const wrapperOf = (editor: Editor) => must(editor.getWrapper(), 'wrapper');

const idsOf = (editor: Editor): string[] => {
  const out: string[] = [];
  const walk = (n: ReturnType<typeof tree>): void => {
    out.push(n.id);
    n.children.forEach(walk);
  };
  walk(tree(wrapperOf(editor)));
  return out;
};

describe('Fase 0 · componentes reais', () => {
  it('cada elemento da fixture é um componente com tipo e id próprios', () => {
    const e = freshEditor();
    expect(findById(e, 'logo-text')?.is('text')).toBe(true);
    expect(findById(e, 'logo-img')?.is('image')).toBe(true);
    expect(findById(e, 'hero')?.get('type')).toBe('bolt-section');
    expect(findById(e, 'hero-title')?.is('text')).toBe(true);
    expect(findById(e, 'hero-cta')?.is('link')).toBe(true);
    expect(findById(e, 'hero-img')?.is('image')).toBe(true);
    expect(findById(e, 'hero-title')?.parent()?.getId()).toBe('hero');
  });

  it('todos os componentes (incluindo a raiz) ficam com id persistido no JSON', () => {
    const e = freshEditor();
    expect(findComponentsWithoutId(getProjectData(e))).toEqual([]);
  });
});

describe('Fase 0 · seleção', () => {
  it('Selecionar pai sobe um nível de cada vez e para na raiz', () => {
    const e = freshEditor();
    selectById(e, 'hero-title');
    expect(selectParent(e)?.getId()).toBe('hero');
    const root = selectParent(e);
    expect(root).toBe(e.getWrapper());
    expect(selectParent(e)).toBe(e.getWrapper());
  });
});

describe('Fase 0 · edição e undo', () => {
  it('editar texto altera o modelo e o undo repõe', () => {
    const e = freshEditor();
    setText(e, 'hero-title', 'Novo título');
    expect(findById(e, 'hero-title')?.getInnerHTML()).toBe('Novo título');
    e.UndoManager.undo();
    expect(findById(e, 'hero-title')?.getInnerHTML()).toBe('Websites que convertem');
  });

  it('o logo textual continua texto e o logo de imagem continua imagem após editar', () => {
    const e = freshEditor();
    setText(e, 'logo-text', 'Bolt IA');
    must(findById(e, 'logo-img'), 'logo-img').addAttributes({ alt: 'Novo logo' });
    expect(findById(e, 'logo-text')?.is('text')).toBe(true);
    expect(findById(e, 'logo-img')?.is('image')).toBe(true);
    expect(() => setText(e, 'logo-img', 'x')).toThrow(/não é texto/);
  });
});

describe('Fase 0 · duplicar, mover, eliminar', () => {
  it('duplicar a secção gera identidades novas em toda a subárvore e seleciona o clone', () => {
    const e = freshEditor();
    const before = new Set(idsOf(e));
    const clone = duplicate(e, 'hero');
    expect(e.getSelected()).toBe(clone);
    expect(clone.index()).toBe(must(findById(e, 'hero'), 'hero').index() + 1);
    const cloneIds = idsOf(e).filter((id) => !before.has(id));
    expect(cloneIds).toHaveLength(tree(must(findById(e, 'hero'), 'hero')).children.length + 1);
    const all = idsOf(e);
    expect(new Set(all).size).toBe(all.length);
    // O original não foi alterado
    expect(findById(e, 'hero-title')?.getInnerHTML()).toBe('Websites que convertem');
  });

  it('mover o botão para a navbar altera a árvore e o undo repõe a posição', () => {
    const e = freshEditor();
    move(e, 'hero-cta', 'nav', 1);
    expect(findById(e, 'hero-cta')?.parent()?.getId()).toBe('nav');
    expect(findById(e, 'hero-cta')?.index()).toBe(1);
    e.UndoManager.undo();
    expect(findById(e, 'hero-cta')?.parent()?.getId()).toBe('hero');
    expect(findById(e, 'hero-cta')?.index()).toBe(2);
  });

  it('mover um componente para dentro de si próprio é recusado', () => {
    const e = freshEditor();
    expect(() => move(e, 'hero', 'hero-title', 0)).toThrow(/Destino inválido/);
  });

  it('eliminar remove do modelo, seleciona um destino válido e o undo repõe', () => {
    const e = freshEditor();
    const next = remove(e, 'hero-text');
    expect(findById(e, 'hero-text')).toBeUndefined();
    expect(next?.getId()).toBe('hero-cta');
    e.UndoManager.undo();
    expect(findById(e, 'hero-text')?.parent()?.getId()).toBe('hero');
    expect(findById(e, 'hero-text')?.index()).toBe(1);
  });
});

describe('Fase 0 · serializar e recarregar', () => {
  it('recarregar noutro editor mantém ids, tipos, hierarquia e conteúdo', () => {
    const a = freshEditor();
    setText(a, 'hero-title', 'Título persistido');
    duplicate(a, 'hero-cta');
    const json = JSON.parse(JSON.stringify(getProjectData(a)));

    const b = createBoltEditor({ projectData: json });
    expect(tree(wrapperOf(b))).toEqual(tree(wrapperOf(a)));
    expect(findById(b, 'hero-title')?.getInnerHTML()).toBe('Título persistido');
    expect(findById(b, 'logo-img')?.getAttributes().src).toBe(findById(a, 'logo-img')?.getAttributes().src);
  });

  it('o envelope BoltDocument valida o JSON do motor e recusa versões desconhecidas', () => {
    const e = freshEditor();
    const doc = {
      boltSchemaVersion: 1,
      engine: { name: 'grapesjs', version: 'test' },
      projectId: 'p1',
      revision: 0,
      projectData: JSON.parse(JSON.stringify(getProjectData(e))),
    };
    expect(parseBoltDocument(doc).ok).toBe(true);
    expect(parseBoltDocument({ ...doc, boltSchemaVersion: 99 }).ok).toBe(false);
    expect(parseBoltDocument({ foo: 'bar' }).ok).toBe(false);
  });
});
