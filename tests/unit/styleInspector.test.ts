import type { Component, Editor } from 'grapesjs';
import { describe, expect, it } from 'vitest';
import { AssetUrlMap, collectAssetRefs } from '../../src/assets/assetRefs';
import { createBoltEditor, getProjectData } from '../../src/engine/createBoltEditor';
import { createContinuousEdit, styleSources } from '../../src/engine/styleSources';
import { getOwnStyle, setOwnStyle } from '../../src/engine/styles';
import { buildProjectData, getTemplate } from '../../src/templates/registry';

/** Inspetor de estilos: escrita na regra própria por dispositivo, sem efeitos colaterais. */
const all = (c: Component): Component[] => [c, ...c.components().models.flatMap(all)];
function setup(): { e: Editor; h1: Component } {
  const t = getTemplate('nimbus-lancamento');
  if (!t) throw new Error('template');
  const e = createBoltEditor({ projectData: buildProjectData(t) });
  e.UndoManager.clear();
  const w = e.getWrapper();
  const h1 = w ? all(w).find((c) => c.get('tagName') === 'h1') : undefined;
  if (!h1) throw new Error('h1');
  return { e, h1 };
}
const snapshot = (e: Editor) => JSON.stringify(getProjectData(e));

describe('Inspetor de estilos · motor', () => {
  it('ler origens e repor um valor inexistente não altera o documento nem o histórico', () => {
    const { e, h1 } = setup();
    const before = snapshot(e);
    for (const device of ['desktop', 'tablet', 'mobile'] as const) styleSources(e, h1, device);
    setOwnStyle(e, h1, 'mobile', { 'padding-top': '' }); // repor sem valor próprio
    setOwnStyle(e, h1, 'desktop', {}); // sem alterações
    expect(snapshot(e)).toBe(before);
    expect(e.UndoManager.hasUndo()).toBe(false);
    expect(e.Css.getRule(`#${h1.getId()}`, { atRuleType: 'media', atRuleParams: '(max-width: 480px)' })).toBeFalsy();
  });

  it('telemóvel escreve no breakpoint próprio e preserva o computador; repor volta ao herdado', () => {
    const { e, h1 } = setup();
    setOwnStyle(e, h1, 'desktop', { 'padding-top': '40px', display: 'flex' });
    setOwnStyle(e, h1, 'mobile', { 'padding-top': '8px' });
    expect(getOwnStyle(e, h1, 'desktop')).toMatchObject({ 'padding-top': '40px', display: 'flex' });
    expect(getOwnStyle(e, h1, 'mobile')).toEqual({ 'padding-top': '8px' });
    const mobile = styleSources(e, h1, 'mobile');
    expect(mobile.get('padding-top')).toMatchObject({ kind: 'own', value: '8px' });
    expect(mobile.get('display')).toMatchObject({ kind: 'device', label: 'Computador', value: 'flex' });
    setOwnStyle(e, h1, 'mobile', { 'padding-top': '' });
    expect(styleSources(e, h1, 'mobile').get('padding-top')).toMatchObject({ kind: 'device', value: '40px' });
    expect(getOwnStyle(e, h1, 'desktop')['padding-top']).toBe('40px');
  });

  it('abreviaturas na regra própria são reconhecidas (padding → padding-top)', () => {
    const { e, h1 } = setup();
    e.Css.setRule(`#${h1.getId()}`, { padding: '12px' });
    expect(styleSources(e, h1, 'desktop').get('padding-left')).toMatchObject({ kind: 'own', value: '12px', label: 'Neste dispositivo (padding)' });
  });

  it('interação contínua: pré-visualizações sem histórico e um único passo no fim', () => {
    const { e, h1 } = setup();
    setOwnStyle(e, h1, 'desktop', { opacity: '1' });
    e.UndoManager.clear();
    const live = createContinuousEdit(e, h1, 'desktop', 'opacity');
    for (const v of ['0.9', '0.8', '0.7', '0.6', '0.5']) live.preview(v);
    expect(getOwnStyle(e, h1, 'desktop').opacity).toBe('0.5');
    expect(e.UndoManager.hasUndo()).toBe(false);
    live.commit();
    expect(getOwnStyle(e, h1, 'desktop').opacity).toBe('0.5');
    e.UndoManager.undo();
    expect(getOwnStyle(e, h1, 'desktop').opacity).toBe('1');
    expect(e.UndoManager.hasUndo()).toBe(false);
    e.UndoManager.redo();
    expect(getOwnStyle(e, h1, 'desktop').opacity).toBe('0.5');
  });

  it('imagem de fundo: grava a referência durável dentro de url(...) e volta a mostrar o URL ao abrir', () => {
    const { e, h1 } = setup();
    const ref = 'bolt-asset:ws-1/library/fundo.webp';
    const signed = 'https://exemplo.supabase.co/storage/v1/object/sign/project-assets/ws-1/library/fundo.webp?token=abc';
    const urls = new AssetUrlMap();
    urls.register(ref, signed);
    setOwnStyle(e, h1, 'desktop', { 'background-image': `url("${signed}")` });
    const stored = urls.forStorage(getProjectData(e));
    const text = JSON.stringify(stored);
    expect(text).toContain(ref);
    expect(text).not.toContain('token=abc');
    expect(collectAssetRefs(stored)).toContain(ref);
    const reopened = createBoltEditor({ projectData: urls.forDisplay(stored) });
    const again = all(reopened.getWrapper() ?? h1).find((c) => c.getId() === h1.getId());
    if (!again) throw new Error('h1 reaberto');
    expect(getOwnStyle(reopened, again, 'desktop')['background-image']).toBe(`url("${signed}")`);
  });

  it('interação contínua cancelada volta ao valor inicial sem deixar histórico', () => {
    const { e, h1 } = setup();
    const live = createContinuousEdit(e, h1, 'tablet', 'opacity');
    live.preview('0.3');
    live.cancel();
    expect(getOwnStyle(e, h1, 'tablet').opacity).toBeUndefined();
    expect(e.UndoManager.hasUndo()).toBe(false);
  });
});
