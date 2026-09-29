import type { Component, Editor } from 'grapesjs';
import { describe, expect, it } from 'vitest';
import { AssetUrlMap, collectAssetRefs } from '../../src/assets/assetRefs';
import { createBoltEditor, getProjectData, renderProjectHtml } from '../../src/engine/createBoltEditor';
import { addPage, affectedPages, duplicatePage, historySnapshot, linksToPage, listPages, pageHref, removePage, renamePage, selectPage, setHomePage } from '../../src/engine/pages';
import { pageForHref } from '../../src/editor/ProjectPreview';
import { duplicate } from '../../src/engine/operations';
import { setOwnStyle } from '../../src/engine/styles';
import { analyzeImport, type Dependencies } from '../../src/importers/pipeline';
import { buildProjectData, getTemplate } from '../../src/templates/registry';

const all = (c: Component): Component[] => [c, ...c.components().models.flatMap(all)];
function legacy(): Editor {
  const t = getTemplate('nimbus-lancamento');
  if (!t) throw new Error('template');
  const e = createBoltEditor({ projectData: buildProjectData(t) });
  e.UndoManager.clear();
  return e;
}
const data = (e: Editor) => JSON.stringify(getProjectData(e));
const allIds = (e: Editor) => e.Pages.getAll().flatMap((p) => all(p.getMainComponent()).filter((c) => c.get('type') !== 'textnode').map((c) => c.getId()));
/** Cada ação da interface é um evento próprio: o motor agrupa no histórico o que acontece no mesmo ciclo. */
const tick = () => new Promise((r) => setTimeout(r, 30));
const reopen = (e: Editor) => createBoltEditor({ projectData: JSON.parse(data(e)) });

describe('Páginas · compatibilidade e operações', () => {
  it('projeto antigo abre como uma página inicial; listar e mudar de página não alteram o documento', () => {
    const e = legacy();
    const before = data(e);
    expect(listPages(e)).toEqual([{ id: expect.any(String), name: 'Página inicial', slug: 'inicio', isHome: true, index: 0, selected: true }]);
    const p = addPage(e, 'Sobre');
    e.UndoManager.clear();
    const withTwo = data(e);
    selectPage(e, listPages(e)[0]?.id ?? '');
    selectPage(e, p.getId());
    expect(e.UndoManager.hasUndo()).toBe(false);
    expect(data(e)).toBe(withTwo);
    expect(before).not.toBe(withTwo);
  });

  it('criar grava nome e slug estáveis; desfazer remove a página e refazer repõe', async () => {
    const e = legacy();
    const p = addPage(e, 'Sobre nós');
    await tick();
    expect(listPages(e).map((x) => [x.name, x.slug, x.isHome])).toEqual([
      ['Página inicial', 'inicio', true],
      ['Sobre nós', 'sobre-nos', false],
    ]);
    expect(e.Pages.getSelected()).toBe(p);
    const again = addPage(e, 'Sobre nós');
    await tick();
    expect(listPages(e).find((x) => x.id === again.getId())).toMatchObject({ name: 'Sobre nós 2', slug: 'sobre-nos-2' });
    e.UndoManager.undo();
    expect(e.Pages.getAll()).toHaveLength(2);
    e.UndoManager.redo();
    expect(e.Pages.getAll()).toHaveLength(3);
  });

  it('duplicar: conteúdo e estilos copiados com ids novos, sem colisões, a seguir à origem', () => {
    const e = legacy();
    const home = e.Pages.getAll()[0];
    if (!home) throw new Error('home');
    const h1 = all(home.getMainComponent()).find((c) => c.get('tagName') === 'h1');
    if (!h1) throw new Error('h1');
    setOwnStyle(e, h1, 'desktop', { color: '#123456' });
    setOwnStyle(e, h1, 'mobile', { 'font-size': '21px' });
    addPage(e, 'Contactos');
    const copy = duplicatePage(e, home.getId());
    expect(listPages(e).map((p) => p.name)).toEqual(['Página inicial', 'Página inicial (cópia)', 'Contactos']);
    const ids = allIds(e);
    expect(new Set(ids).size).toBe(ids.length);
    const h1c = all(copy.getMainComponent()).find((c) => c.get('tagName') === 'h1');
    expect(h1c?.getId()).not.toBe(h1.getId());
    const rules = e.Css.getRules(`#${h1c?.getId() ?? ''}`).map((r) => [String(r.get('mediaText') ?? ''), r.getStyle()]);
    expect(rules).toEqual(expect.arrayContaining([['', { color: '#123456' }], ['(max-width: 480px)', { 'font-size': '21px' }]]));
  });

  it('duplicar copia também as regras compostas que referem os ids (menu, ::before), sem mexer nas originais', () => {
    const e = legacy();
    const home = e.Pages.getAll()[0];
    const nav = home ? all(home.getMainComponent()).find((c) => c.get('type') === 'bolt-navbar') : undefined;
    const inner = nav?.components().models[0];
    if (!nav || !inner) throw new Error('navbar');
    e.Css.setRule(`#${nav.getId()}[data-bolt-menu-open] #${inner.getId()}`, { display: 'block' }, { atRuleType: 'media', atRuleParams: '(max-width: 768px)' });
    // Regra composta com estado (como as sobreposições ::before importadas).
    e.Css.getAll().add({ selectorsAdd: `#${nav.getId()} .overlay`, state: 'before', style: { opacity: '0.5' } });
    const before = e.Css.getRules().length;
    // Elemento duplicado pela operação do editor.
    const copyNav = duplicate(e, nav.getId());
    const copyInner = copyNav.components().models[0];
    expect(e.Css.getRule(`#${copyNav.getId()}[data-bolt-menu-open] #${copyInner?.getId() ?? ''}`, { atRuleType: 'media', atRuleParams: '(max-width: 768px)' })?.getStyle()).toEqual({ display: 'block' });
    expect(e.Css.getRule(`#${nav.getId()}[data-bolt-menu-open] #${inner.getId()}`, { atRuleType: 'media', atRuleParams: '(max-width: 768px)' })).toBeTruthy();
    expect(e.Css.getRules().length).toBeGreaterThan(before);
    const withState = e.Css.getAll().models.find((r) => r.get('selectorsAdd') === `#${copyNav.getId()} .overlay`);
    expect(withState?.get('state')).toBe('before');
    expect(withState?.getStyle()).toEqual({ opacity: '0.5' });
    // Página duplicada.
    const copyPage = duplicatePage(e, home?.getId() ?? '');
    const pageNav = all(copyPage.getMainComponent()).find((c) => c.get('type') === 'bolt-navbar');
    const pageInner = pageNav?.components().models[0];
    expect(e.Css.getRule(`#${pageNav?.getId() ?? ''}[data-bolt-menu-open] #${pageInner?.getId() ?? ''}`, { atRuleType: 'media', atRuleParams: '(max-width: 768px)' })).toBeTruthy();
  });

  it('mudar o nome não muda o slug; ligações entre páginas usam /slug e são contadas', () => {
    const e = legacy();
    const p = addPage(e, 'Serviços');
    renamePage(e, p.getId(), 'O que fazemos');
    const info = listPages(e).find((x) => x.id === p.getId());
    expect(info).toMatchObject({ name: 'O que fazemos', slug: 'servicos' });
    const home = e.Pages.getAll()[0];
    const link = home ? all(home.getMainComponent()).find((c) => c.is('link')) : undefined;
    link?.addAttributes({ href: pageHref('servicos') });
    expect(linksToPage(e, p.getId())).toBe(1);
  });

  it('página inicial: definir outra; eliminar a inicial passa a seguinte; nunca eliminar a última', async () => {
    const e = legacy();
    const oldHome = e.Pages.getAll()[0];
    const b = addPage(e, 'B');
    const c = addPage(e, 'C');
    setHomePage(e, c.getId());
    expect(listPages(e).map((p) => p.name)).toEqual(['C', 'Página inicial', 'B']);
    expect(e.Pages.getMain()).toBe(c);
    expect(oldHome?.get('type')).not.toBe('main');
    const re = reopen(e);
    expect(re.Pages.getMain()?.getName()).toBe('C');
    expect(listPages(re)[0]?.name).toBe('C');

    await tick();
    const { newHomeId } = removePage(e, c.getId());
    expect(newHomeId).toBe(oldHome?.getId());
    expect(e.Pages.getMain()).toBe(oldHome);
    expect(listPages(e)[0]?.isHome && listPages(e)[0]?.id).toBe(oldHome?.getId());
    await tick();
    removePage(e, b.getId());
    await tick();
    expect(() => removePage(e, oldHome?.getId() ?? '')).toThrow(/pelo menos uma página/);
    e.UndoManager.undo(); // repõe «B»
    expect(e.Pages.getAll().map((p) => p.getName())).toContain('B');
  });

  it('guardar e reabrir mantém páginas, estilos e referências de imagens de todas as páginas', () => {
    const e = legacy();
    const p = addPage(e, 'Galeria');
    p.getMainComponent().append({ type: 'image', attributes: { src: 'https://signed/x.png?token=1', alt: '' } });
    const img = all(p.getMainComponent()).find((c) => c.is('image'));
    if (!img) throw new Error('img');
    setOwnStyle(e, img, 'desktop', { 'border-radius': '9px' });
    const urls = new AssetUrlMap();
    urls.register('bolt-asset:ws/library/x.png', 'https://signed/x.png?token=1');
    const stored = urls.forStorage(getProjectData(e));
    expect(stored.pages).toHaveLength(2);
    expect(collectAssetRefs(stored)).toContain('bolt-asset:ws/library/x.png');
    expect(JSON.stringify(stored)).not.toContain('token=1');
    const re = createBoltEditor({ projectData: urls.forDisplay(stored) });
    const pages = listPages(re);
    expect(pages.map((x) => [x.name, x.slug])).toEqual([
      ['Página inicial', 'inicio'],
      ['Galeria', 'galeria'],
    ]);
    const galeria = re.Pages.get(pages[1]?.id ?? '');
    const reImg = galeria ? all(galeria.getMainComponent()).find((c) => c.is('image')) : undefined;
    expect(reImg?.get('src')).toBe('https://signed/x.png?token=1');
    expect(re.Css.getRule(`#${reImg?.getId() ?? ''}`)?.getStyle()).toMatchObject({ 'border-radius': '9px' });
  });

  it('as operações emitem os eventos de página que a gravação escuta; mudar de página não', () => {
    const e = legacy();
    const seen: string[] = [];
    e.on('page:add', () => seen.push('add'));
    e.on('page:remove', () => seen.push('remove'));
    e.on('page:update', () => seen.push('update'));
    const p = addPage(e, 'X');
    expect(seen).toContain('add');
    seen.length = 0;
    selectPage(e, e.Pages.getAll()[0]?.getId() ?? '');
    expect(seen).toEqual([]);
    renamePage(e, p.getId(), 'Y');
    expect(seen).toContain('update');
    removePage(e, p.getId());
    expect(seen).toContain('remove');
  });

  it('importação GrapesJS com várias páginas: nenhuma é descartada e os nomes mantêm-se', async () => {
    const doc = {
      pages: [
        { id: 'p1', name: 'Home', frames: [{ component: { type: 'wrapper', components: [{ type: 'text', tagName: 'h1', content: 'Início' }] } }] },
        { id: 'p2', name: 'Contactos', frames: [{ component: { type: 'wrapper', components: [{ type: 'text', tagName: 'h2', content: 'Fale connosco' }] } }] },
      ],
    };
    const text = JSON.stringify(doc);
    const offline: Dependencies = { fetch: async () => { throw new TypeError('offline'); }, probeImage: async () => false };
    const a = await analyzeImport({ name: 'dois.json', type: 'application/json', size: text.length, text: async () => text }, offline);
    expect(a.projectData.pages).toHaveLength(2);
    const re = createBoltEditor({ projectData: a.projectData });
    expect(listPages(re).map((p) => p.name)).toEqual(['Home', 'Contactos']);
    expect(JSON.stringify(a.projectData)).toContain('Fale connosco');
  });
});

describe('Páginas · identidade, caminhos e referências', () => {
  it('slugs únicos ao criar e duplicar; colisão com /inicio de projetos antigos; estáveis ao renomear', async () => {
    const e = legacy();
    const p = addPage(e, 'Início'); // colide com o «/inicio» implícito da página antiga
    await tick();
    const d = duplicatePage(e, p.getId());
    await tick();
    const d2 = duplicatePage(e, p.getId());
    const before = listPages(e);
    expect(before[0]?.slug).toBe('inicio');
    expect(before.find((x) => x.id === p.getId())?.slug).toBe('inicio-2');
    expect(new Set(before.map((x) => x.slug)).size).toBe(before.length);
    const slugOf = (id: string) => listPages(e).find((x) => x.id === id)?.slug;
    const dSlug = slugOf(d.getId());
    const d2Slug = slugOf(d2.getId());
    renamePage(e, d.getId(), 'Outro nome');
    renamePage(e, d2.getId(), 'Início'); // nome repetido: o slug não muda
    expect(slugOf(d.getId())).toBe(dSlug);
    expect(slugOf(d2.getId())).toBe(d2Slug);
    const after = listPages(e);
    expect(new Set(after.map((x) => x.slug)).size).toBe(after.length);
  });

  it('importação com nomes de página repetidos: slugs únicos derivados sem perder páginas', async () => {
    const mk = (id: string) => ({ id, name: 'Home', frames: [{ component: { type: 'wrapper', components: [{ type: 'text', tagName: 'p', content: id }] } }] });
    const text = JSON.stringify({ pages: [mk('a'), mk('b'), mk('c')] });
    const offline: Dependencies = {
      fetch: async () => {
        throw new TypeError('offline');
      },
      probeImage: async () => false,
    };
    const a = await analyzeImport({ name: 'tres.json', type: 'application/json', size: text.length, text: async () => text }, offline);
    const re = createBoltEditor({ projectData: a.projectData });
    expect(listPages(re).map((p) => p.slug)).toEqual(['home', 'home-2', 'home-3']);
  });

  it('duplicar: referências internas (#âncora, for, ARIA) apontam para a cópia; as externas mantêm-se', () => {
    const e = legacy();
    const wrapper = e.getWrapper();
    if (!wrapper) throw new Error('wrapper');
    wrapper.append({ type: 'text', tagName: 'p', attributes: { id: 'fora' }, content: 'Fora da cópia' });
    const [section] = wrapper.append({
      type: 'bolt-section',
      attributes: { id: 'sec' },
      components: [
        { type: 'text', tagName: 'h2', attributes: { id: 'titulo' }, content: 'Título' },
        { tagName: 'label', attributes: { id: 'rotulo', for: 'campo' }, components: [{ type: 'textnode', content: 'E-mail' }] },
        { type: 'bolt-input', attributes: { id: 'campo', 'aria-labelledby': 'rotulo titulo', 'aria-describedby': 'fora' } },
        { type: 'link', attributes: { id: 'l1', href: '#titulo' }, components: [{ type: 'textnode', content: 'topo' }] },
        { type: 'link', attributes: { id: 'l2', href: '#fora' }, components: [{ type: 'textnode', content: 'fora' }] },
        { type: 'link', attributes: { id: 'l3', href: '/contactos' }, components: [{ type: 'textnode', content: 'página' }] },
      ],
    });
    if (!section) throw new Error('secção');
    const copy = duplicate(e, section.getId());
    const find = (root: Component, pred: (c: Component) => boolean) => all(root).find(pred);
    const cTitle = find(copy, (c) => c.get('tagName') === 'h2');
    const cLabel = find(copy, (c) => c.get('tagName') === 'label');
    const cInput = find(copy, (c) => c.is('bolt-input'));
    const links = all(copy).filter((c) => c.is('link'));
    expect(cLabel?.getAttributes().for).toBe(cInput?.getId());
    expect(cInput?.getAttributes()['aria-labelledby']).toBe(`${cLabel?.getId() ?? ''} ${cTitle?.getId() ?? ''}`);
    expect(cInput?.getAttributes()['aria-describedby']).toBe('fora'); // fora da cópia: igual
    expect(links.map((l) => l.getAttributes().href)).toEqual([`#${cTitle?.getId() ?? ''}`, '#fora', '/contactos']);
    // A origem não mudou.
    expect(find(section, (c) => c.get('tagName') === 'label')?.getAttributes().for).toBe('campo');
    // Página duplicada: todos os elementos são copiados, por isso também «fora» passa ao id da cópia.
    const pageCopy = duplicatePage(e, e.Pages.getAll()[0]?.getId() ?? '');
    const pAll = all(pageCopy.getMainComponent());
    const pLabel = pAll.find((c) => c.get('tagName') === 'label');
    const pInput = pAll.find((c) => c.is('bolt-input') && c.getAttributes()['aria-describedby'] !== undefined);
    const forId = String(pLabel?.getAttributes().for ?? '');
    expect(forId).not.toBe('campo');
    expect(pAll.some((c) => c.getId() === forId)).toBe(true);
    const described = String(pInput?.getAttributes()['aria-describedby'] ?? '');
    expect(described).not.toBe('fora');
    expect(pAll.some((c) => c.getId() === described)).toBe(true);
  });

  it('efeito do histórico: identifica a página alterada por conteúdo ou por estilo, e páginas removidas', async () => {
    const e = legacy();
    const other = addPage(e, 'Outra');
    other.getMainComponent().append({ type: 'text', tagName: 'p', attributes: { id: 'px' }, content: 'x' });
    await tick();
    selectPage(e, e.Pages.getAll()[0]?.getId() ?? '');
    const target = all(other.getMainComponent()).find((c) => c.getId() === 'px');
    if (!target) throw new Error('px');
    setOwnStyle(e, target, 'desktop', { color: '#010203' });
    await tick();
    const before = historySnapshot(e);
    e.UndoManager.undo();
    expect(affectedPages(e, before, historySnapshot(e)).changed).toEqual([other.getId()]);
    const b2 = historySnapshot(e);
    removePage(e, other.getId());
    expect(affectedPages(e, b2, historySnapshot(e)).removed).toEqual([{ id: other.getId(), name: 'Outra' }]);
  });

  it('pré-visualização: cada página é desenhada à parte; /slug e / resolvem para a página certa', () => {
    const e = legacy();
    const p = addPage(e, 'Contactos');
    p.getMainComponent().append({ type: 'text', tagName: 'h2', content: 'Fale connosco' });
    const d = getProjectData(e);
    expect(renderProjectHtml(d, p.getId()).html).toContain('Fale connosco');
    expect(renderProjectHtml(d).html).not.toContain('Fale connosco');
    const pages = listPages(e);
    expect(pageForHref(pages, '/contactos')?.id).toBe(p.getId());
    expect(pageForHref(pages, '/')?.isHome).toBe(true);
    expect(pageForHref(pages, '/contactos#topo')?.id).toBe(p.getId());
    expect(pageForHref(pages, '/nao-existe')).toBeNull();
  });
});
