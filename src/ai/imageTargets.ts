import type { Component } from 'grapesjs';
import { displayName } from '../engine/labels';
import { plainText } from './context';

/**
 * Pedido sobre uma imagem («troca a imagem por…») com um BLOCO selecionado (ex.: a legenda que
 * cobre a fotografia do portfólio). O âmbito «Elemento» do assistente só permite alterar o próprio
 * elemento; aqui encontra-se a imagem a que o pedido se refere, para a janela a mostrar (uma) ou
 * a dar a escolher (várias) ANTES de enviar. Nada é alterado aqui.
 *
 * Procura: imagens dentro do bloco; se não houver, no antepassado mais próximo que as tenha (até à
 * secção). Fundos: quando o pedido fala de «fundo», ou quando não há imagens.
 */
export interface ImageTarget {
  component: Component;
  kind: 'image' | 'background';
  /** Miniatura (endereço já mostrado no canvas), quando existe. */
  thumb: string | null;
  label: string;
}

const IMAGE_WORDS = /(^|[^\p{L}])(imagem|imagens|foto|fotos|fotografia|figura|ilustra[çc][ãa]o|image|picture|photo)([^\p{L}]|$)/iu;
const BACKGROUND_WORDS = /(^|[^\p{L}])(fundo|background)([^\p{L}]|$)/iu;
const TOP = new Set(['section', 'header', 'footer', 'nav', 'main', 'aside', 'article']);

export function imageIntent(text: string): { image: boolean; background: boolean } {
  const background = BACKGROUND_WORDS.test(text);
  return { image: IMAGE_WORDS.test(text) && !background, background };
}

function backgroundUrl(c: Component): string | null {
  const el = c.getEl();
  const view = el?.ownerDocument.defaultView;
  if (!el || !view) return null;
  const m = /url\("?([^")]+)"?\)/.exec(view.getComputedStyle(el).backgroundImage);
  return m?.[1] ?? null;
}

function imagesIn(root: Component): Component[] {
  const out: Component[] = [];
  const walk = (c: Component) => {
    if (c.is('image')) out.push(c);
    else c.components().models.forEach(walk);
  };
  root.components().models.forEach(walk);
  return out;
}

const isTop = (c: Component) => c.is('wrapper') || TOP.has(String(c.get('tagName') ?? '').toLowerCase());

const asImage = (c: Component): ImageTarget => {
  const attrs = c.getAttributes();
  const src = typeof attrs.src === 'string' && attrs.src ? attrs.src : null;
  const alt = typeof attrs.alt === 'string' && attrs.alt.trim() && attrs.alt.trim() !== '...' ? attrs.alt.trim() : '';
  // Sem descrição útil (ex.: alt="..."): o texto do bloco onde a imagem está (ex.: «Stationary»).
  const near = c.parent() ? plainText(c.parent() as Component).slice(0, 40).trim() : '';
  return { component: c, kind: 'image', thumb: src, label: alt ? `Imagem «${alt}»` : near ? `Imagem · ${near}${near.length >= 40 ? '…' : ''}` : displayName(c) };
};

/**
 * Destinos possíveis, ou `null` quando não se aplica (o pedido não fala de imagens, ou o elemento
 * selecionado já é a imagem / tem o fundo pedido — então o pedido segue como está).
 */
export function imageTargets(selected: Component, text: string): ImageTarget[] | null {
  const intent = imageIntent(text);
  if (!intent.image && !intent.background) return null;
  if (selected.is('image')) return null;
  if (intent.background && backgroundUrl(selected)) return null;

  const chain: Component[] = [selected];
  for (let p = selected.parent(); p && !p.is('wrapper'); p = p.parent()) {
    chain.push(p);
    if (isTop(p)) break;
  }
  if (intent.image) {
    for (const c of chain) {
      const imgs = imagesIn(c);
      if (imgs.length) return imgs.map(asImage);
      if (isTop(c)) break;
    }
  }
  // Fundos do bloco e dos antepassados (até à secção).
  const bgs = chain
    .map((c) => ({ c, url: backgroundUrl(c) }))
    .filter((x): x is { c: Component; url: string } => x.url !== null)
    .map((x) => ({ component: x.c, kind: 'background' as const, thumb: x.url, label: `Fundo de ${displayName(x.c)}` }));
  return bgs;
}
