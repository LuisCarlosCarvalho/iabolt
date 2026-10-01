import type { Component, Editor, Page } from 'grapesjs';
import { cloneScopedRules, idMapOf, remapReferences } from './cloneRules';
import { STYLESHEET_TYPE } from './boltTypes';
import { remapCssIds } from './cssText';
import { ensureStableIdsDeep } from './identity';

/**
 * Páginas do projeto, sobre o gestor de páginas do próprio motor (o documento já guarda
 * `pages[]`; não há outro modelo nem outra via de gravação).
 *
 * Convenções (compatíveis com projetos e templates antigos, que têm uma só página `main`):
 *  - Página inicial = a primeira da lista e a marcada `type: 'main'` (as duas andam juntas).
 *  - Cada página tem um `slug` estável (gravado na página na primeira operação sobre páginas).
 *    Ligações entre páginas usam `/<slug>`; mudar o nome NÃO muda o slug, por isso não partem.
 *  - Mudar de página não altera o documento nem cria passos de desfazer.
 *  - Criar, duplicar, eliminar e definir a inicial entram no histórico do motor (desfazer repõe).
 */
export interface PageInfo {
  id: string;
  name: string;
  slug: string;
  isHome: boolean;
  index: number;
  selected: boolean;
}

const MAIN = 'main';

export function slugify(text: string): string {
  const s = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'pagina';
}

const pages = (editor: Editor) => editor.Pages.getAll();

/** Nome para mostrar (páginas antigas não têm nome). */
export function pageLabel(page: Page, index: number): string {
  const name = page.getName();
  if (name) return name;
  return index === 0 ? 'Página inicial' : `Página ${index + 1}`;
}

function storedSlug(page: Page): string {
  const v: unknown = page.get('slug');
  return typeof v === 'string' ? v : '';
}

/** Slug a usar: o gravado; senão um derivado estável do nome (sem gravar). */
function effectiveSlug(page: Page, index: number, taken: Set<string>): string {
  const own = storedSlug(page);
  if (own) return own;
  const base = index === 0 && !page.getName() ? 'inicio' : slugify(pageLabel(page, index));
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  return slug;
}

export function listPages(editor: Editor): PageInfo[] {
  const selected = editor.Pages.getSelected();
  const taken = new Set(pages(editor).map(storedSlug).filter(Boolean));
  return pages(editor).map((p, index) => {
    const slug = effectiveSlug(p, index, taken);
    taken.add(slug);
    return { id: p.getId(), name: pageLabel(p, index), slug, isHome: index === 0, index, selected: p === selected };
  });
}

/** Grava nome e slug nas páginas que ainda não os têm (parte de uma operação do utilizador). */
export function persistMeta(editor: Editor): void {
  for (const info of listPages(editor)) {
    const page = editor.Pages.get(info.id);
    if (!page) continue;
    if (!page.getName()) page.set('name', info.name);
    if (!storedSlug(page)) page.set('slug', info.slug);
  }
}

function uniqueSlug(editor: Editor, base: string, except?: Page): string {
  const taken = new Set(listPages(editor).filter((p) => p.id !== except?.getId()).map((p) => p.slug));
  let slug = slugify(base);
  const root = slug;
  for (let n = 2; taken.has(slug); n += 1) slug = `${root}-${n}`;
  return slug;
}

function uniqueName(editor: Editor, base: string): string {
  const names = new Set(listPages(editor).map((p) => p.name));
  let name = base;
  for (let n = 2; names.has(name); n += 1) name = `${base} ${n}`;
  return name;
}

/** Mudar de página: só interface. Sem histórico e sem alterar o documento. */
export function selectPage(editor: Editor, id: string): void {
  const page = editor.Pages.get(id);
  if (!page || editor.Pages.getSelected() === page) return;
  const um = editor.UndoManager;
  um.stop();
  try {
    editor.selectRemove(editor.getSelectedAll());
    editor.Pages.select(page);
  } finally {
    um.start();
  }
}

/**
 * Classes do corpo (wrapper) passam para a página nova: é aí que alguns projetos ligam os estilos
 * globais do corpo (ex.: `gjs-t-body` do Studio). Só classes; o id e os atributos não se copiam.
 */
function copyBodyClasses(from: Page | undefined, to: Page): void {
  const classes = from?.getMainComponent().getClasses() ?? [];
  if (classes.length) to.getMainComponent().addClass(classes);
}

function finish(editor: Editor, page: Page): Page {
  ensureStableIdsDeep(page.getMainComponent());
  selectPage(editor, page.getId());
  return page;
}

export function addPage(editor: Editor, name = 'Nova página'): Page {
  persistMeta(editor);
  const finalName = uniqueName(editor, name.trim() || 'Nova página');
  const page = editor.Pages.add({ name: finalName, slug: uniqueSlug(editor, finalName), component: [] });
  if (!page) throw new Error('Não foi possível criar a página.');
  copyBodyClasses(editor.Pages.getMain(), page);
  return finish(editor, page);
}

export function renamePage(editor: Editor, id: string, name: string): void {
  const page = editor.Pages.get(id);
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!page || !clean || page.getName() === clean) return;
  persistMeta(editor); // o slug fica fixo antes de mudar o nome
  page.set('name', clean);
}

/** Cópia completa: componentes com ids novos e as regras de estilo próprias copiadas pelo motor. */
export function duplicatePage(editor: Editor, id: string): Page {
  const source = editor.Pages.get(id);
  if (!source) throw new Error('Página inexistente.');
  persistMeta(editor);
  const index = pages(editor).indexOf(source);
  const name = uniqueName(editor, `${pageLabel(source, index)} (cópia)`);
  // clone(): ids novos e cópia das regras #id (incl. breakpoints). Os próprios clones entram na
  // página nova (não as definições), para os ids e as regras copiadas coincidirem.
  const originals = source.getMainComponent().components().models;
  const clones = originals.map((c) => c.clone());
  const page = editor.Pages.add({ name, slug: uniqueSlug(editor, name), component: [] }, { at: index + 1 });
  page?.getMainComponent().components().add(clones);
  // Regras compostas que referem ids (menu móvel, ::before, CSS importado) seguem para a cópia.
  const ids = new Map<string, string>();
  originals.forEach((o, i) => {
    const c = clones[i];
    if (c) idMapOf(o, c, ids);
  });
  if (!page) throw new Error('Não foi possível duplicar a página.');
  // Id do corpo (sites importados: ex. «page-top», alvo do «voltar ao topo»): a cópia tem o seu.
  const bodyId = source.getMainComponent().getAttributes().id;
  if (typeof bodyId === 'string' && bodyId) {
    const taken = new Set(pages(editor).map((p) => p.getMainComponent().getAttributes().id));
    let next = `${bodyId}-2`;
    for (let n = 3; taken.has(next); n += 1) next = `${bodyId}-${n}`;
    page.getMainComponent().addAttributes({ id: next });
    ids.set(bodyId, next);
  }
  cloneScopedRules(editor, ids);
  // Referências internas (#âncoras, for, ARIA) passam aos ids da cópia; as externas mantêm-se.
  clones.forEach((c) => remapReferences(c, ids));
  // Folha literal de um site importado: os seletores com ids passam aos da cópia.
  for (const c of clones) {
    if (c.get('type') === STYLESHEET_TYPE) c.set('content', remapCssIds(String(c.get('content') ?? ''), ids));
  }
  copyBodyClasses(source, page);
  return finish(editor, page);
}

/** Primeira da lista e marcada como principal. */
export function setHomePage(editor: Editor, id: string): void {
  const page = editor.Pages.get(id);
  if (!page) return;
  persistMeta(editor);
  for (const p of pages(editor)) if (p !== page && p.get('type') === MAIN) p.set('type', '');
  page.set('type', MAIN);
  if (pages(editor).indexOf(page) !== 0) editor.Pages.move(page, { at: 0 });
}

/** Ligações (href) que apontam para a página, em todas as páginas. */
export function linksToPage(editor: Editor, id: string): number {
  const info = listPages(editor).find((p) => p.id === id);
  if (!info) return 0;
  const href = pageHref(info.slug);
  let n = 0;
  const walk = (c: Component) => {
    if (c.getAttributes().href === href) n += 1;
    c.components().models.forEach(walk);
  };
  for (const p of pages(editor)) walk(p.getMainComponent());
  return n;
}

export const pageHref = (slug: string) => `/${slug}`;

/**
 * Elimina uma página. Nunca a última. Se for a inicial, a seguinte passa a inicial (e é isso
 * que a interface anuncia antes de confirmar). Devolve o id da nova página inicial, se mudou.
 */
export function removePage(editor: Editor, id: string): { newHomeId: string | null } {
  const all = pages(editor);
  const page = editor.Pages.get(id);
  if (!page) throw new Error('Página inexistente.');
  if (all.length <= 1) throw new Error('Um projeto tem sempre pelo menos uma página.');
  persistMeta(editor);
  const wasHome = all.indexOf(page) === 0;
  const next = all.find((p) => p !== page);
  if (!next) throw new Error('Um projeto tem sempre pelo menos uma página.');
  if (editor.Pages.getSelected() === page) selectPage(editor, next.getId());
  editor.Pages.remove(page);
  if (wasHome) setHomePage(editor, next.getId());
  return { newHomeId: wasHome ? next.getId() : null };
}

/**
 * Instantâneo leve para saber que páginas um desfazer/refazer alterou: árvore de cada página e
 * conjunto das regras CSS (as regras são partilhadas; atribuem-se à página pelos ids que referem).
 */
export interface HistorySnapshot {
  pages: Map<string, string>;
  names: Map<string, string>;
  rules: Set<string>;
}

export function historySnapshot(editor: Editor): HistorySnapshot {
  const list = pages(editor);
  return {
    pages: new Map(list.map((p) => [p.getId(), JSON.stringify(p.getMainComponent().toJSON())])),
    names: new Map(list.map((p, i) => [p.getId(), pageLabel(p, i)])),
    rules: new Set(editor.Css.getAll().models.map((r) => JSON.stringify(r.toJSON()))),
  };
}

export interface HistoryEffect {
  /** Páginas existentes cujo conteúdo ou estilos mudaram. */
  changed: string[];
  /** Páginas que deixaram de existir (nome guardado no instantâneo anterior). */
  removed: Array<{ id: string; name: string }>;
  /** Páginas que passaram a existir. */
  added: string[];
}

export function affectedPages(editor: Editor, before: HistorySnapshot, after: HistorySnapshot): HistoryEffect {
  const changed = new Set<string>();
  for (const [id, json] of after.pages) {
    const prev = before.pages.get(id);
    if (prev !== undefined && prev !== json) changed.add(id);
  }
  // Regras que mudaram → ids referidos → página que os contém.
  const diff = [...after.rules].filter((r) => !before.rules.has(r)).concat([...before.rules].filter((r) => !after.rules.has(r)));
  if (diff.length) {
    const owner = new Map<string, string>();
    const walk = (c: Component, pageId: string) => {
      owner.set(c.getId(), pageId);
      c.components().models.forEach((k) => walk(k, pageId));
    };
    for (const p of pages(editor)) walk(p.getMainComponent(), p.getId());
    for (const r of diff) {
      for (const m of r.matchAll(/#([A-Za-z0-9_-]+)/g)) {
        const pageId = m[1] ? owner.get(m[1]) : undefined;
        if (pageId) changed.add(pageId);
      }
    }
  }
  const removed = [...before.pages.keys()].filter((id) => !after.pages.has(id)).map((id) => ({ id, name: before.names.get(id) ?? id }));
  const added = [...after.pages.keys()].filter((id) => !before.pages.has(id));
  return { changed: [...changed], removed, added };
}
