import sampleZip from '../../amostra/startbootstrap-stylish-portfolio-gh-pages.zip?inline';
import type { Component } from 'grapesjs';
import { describe, expect, it } from 'vitest';
import { imageIntent, imageTargets } from '../../src/ai/imageTargets';
import { createBoltEditor } from '../../src/engine/createBoltEditor';
import { analyzeImport } from '../../src/importers/pipeline';

/**
 * Pedido sobre uma imagem com um BLOCO selecionado (caso do print: a legenda «Stationary» por cima
 * da fotografia do portfólio, na amostra real importada). Sem canvas: os fundos calculados só são
 * verificados no E2E.
 */
async function stylish() {
  const bin = atob(sampleZip.slice(sampleZip.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  let n = 0;
  const a = await analyzeImport(
    { name: 's.zip', type: 'application/zip', size: bytes.length, text: async () => '', arrayBuffer: async () => bytes.slice().buffer },
    { fetch: async () => { throw new TypeError('offline'); }, probeImage: async () => false, objectUrl: () => `blob:t/${(n += 1)}`, revokeObjectUrl: () => undefined },
  );
  return createBoltEditor({ projectData: a.projectData });
}

const find = (root: Component, pred: (c: Component) => boolean): Component => {
  const walk = (c: Component): Component | undefined => (pred(c) ? c : c.components().models.map(walk).find(Boolean));
  const r = walk(root);
  if (!r) throw new Error('não encontrado');
  return r;
};
const hasClass = (cls: string) => (c: Component) => c.getClasses().includes(cls);

describe('Imagem a que o pedido se refere', () => {
  it('reconhece pedidos sobre imagens e sobre fundos', () => {
    expect(imageIntent('Troca a imagem por um livro de matemática.')).toEqual({ image: true, background: false });
    expect(imageIntent('criar uma imagem de fundo com alunos')).toEqual({ image: false, background: true });
    expect(imageIntent('muda o título para azul')).toEqual({ image: false, background: false });
  });

  it('legenda «Stationary» selecionada: UMA imagem candidata (a fotografia do mesmo cartão), com o texto do cartão', async () => {
    const editor = await stylish();
    try {
      const root = editor.getWrapper() as Component;
      const caption = find(root, hasClass('caption'));
      const t = imageTargets(caption, 'Troca a imagem por um livro de matemática.');
      expect(t).toHaveLength(1);
      expect(t?.[0]?.kind).toBe('image');
      expect(t?.[0]?.label).toBe('Imagem · Stationary A yellow pencil with envelope…');
      const card = caption.parent();
      expect(t?.[0]?.component.parent()).toBe(card);
    } finally {
      editor.destroy();
    }
  });

  it('secção do portfólio: as quatro imagens para escolher; imagem selecionada ou pedido sem imagem: segue como está', async () => {
    const editor = await stylish();
    try {
      const root = editor.getWrapper() as Component;
      const portfolio = find(root, (c) => c.getAttributes().id === 'portfolio');
      expect(imageTargets(portfolio, 'troca a imagem por um livro')).toHaveLength(4);
      const img = find(portfolio, (c) => c.is('image'));
      expect(imageTargets(img, 'troca a imagem por um livro')).toBeNull();
      expect(imageTargets(portfolio, 'muda o título')).toBeNull();
    } finally {
      editor.destroy();
    }
  });
});
