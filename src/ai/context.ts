import type { Component, Editor } from 'grapesjs';
import { AI_STYLE_PROPS, HARD_LIMITS, type AiDevice, type AiElementContext } from '../../supabase/functions/_shared/ai/contract.ts';
import { readGlobalStyles, resolveValue, variableOf } from '../engine/globalStyles';
import { displayName } from '../engine/labels';
import { hasHref, isLinkBox, isPlainText, isTextLike, textTag } from '../engine/operations';
import { pageLabel } from '../engine/pages';
import { styleSources } from '../engine/styleSources';

/**
 * Contexto do elemento para o assistente: só o elemento do âmbito, em JSON reduzido.
 * Inclui a ORIGEM de cada estilo (próprio, de outro dispositivo, de uma regra do site ou herdado)
 * e as ligações a variáveis globais, para o modelo não substituir sem necessidade valores herdados.
 * Textos e atributos são dados do projeto (possivelmente importados): o servidor delimita-os como
 * dados e o modelo é instruído a nunca os seguir como instruções.
 */
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Texto visível do elemento, lido do modelo (funciona sem canvas). */
export function plainText(c: Component): string {
  const walk = (x: Component): string => {
    if (x.get('type') === 'textnode') return String(x.get('content') ?? '');
    const own = String(x.get('content') ?? '');
    return own + x.components().models.map(walk).join('');
  };
  return walk(c).replace(/\s+/g, ' ').trim();
}

export interface ElementCapabilities {
  text: boolean;
  link: boolean;
  tag: boolean;
}

export function capabilitiesOf(c: Component): ElementCapabilities {
  return { text: isTextLike(c) && !isLinkBox(c), link: hasHref(c), tag: textTag(c) !== null };
}

export function buildElementContext(editor: Editor, component: Component, device: AiDevice): AiElementContext {
  const caps = capabilitiesOf(component);
  const g = readGlobalStyles(editor);
  const labels = new Map(g.slots.filter((s) => s.name.startsWith('--')).map((s) => [s.name, s.label]));
  const attrs = component.getAttributes();
  const href = typeof attrs.href === 'string' ? attrs.href : undefined;
  const tag = textTag(component);

  // Sem canvas (headless) não há origem calculada: o contexto segue só com o resto.
  const sources = (() => {
    try {
      return styleSources(editor, component, device);
    } catch {
      return null;
    }
  })();
  const styles: AiElementContext['styles'] = {};
  for (const prop of AI_STYLE_PROPS) {
    const s = sources?.get(prop);
    if (!s || !s.value) continue;
    const variable = variableOf(s.value);
    styles[prop] = {
      value: cut(s.value, 300),
      source: s.kind,
      from: cut(s.label, 200),
      ...(variable ? { variable, variableLabel: cut(labels.get(variable) ?? variable, 80) } : {}),
    };
  }

  const pages = editor.Pages.getAll();
  const page = editor.Pages.getSelected();
  return {
    id: component.getId(),
    kind: cut(displayName(component), 60),
    tagName: cut(String(component.get('tagName') ?? ''), 20),
    capabilities: caps,
    content: {
      ...(caps.text ? { text: cut(plainText(component), 4000), richText: !isPlainText(component) } : {}),
      ...(href !== undefined ? { href: cut(href, HARD_LIMITS.hrefChars), newTab: attrs.target === '_blank' } : {}),
      ...(tag ? { tag } : {}),
    },
    styles,
    variables: g.slots
      .filter((s) => s.name.startsWith('--'))
      .slice(0, HARD_LIMITS.variables)
      .map((s) => ({ name: cut(s.name, 80), label: cut(s.label, 80), value: cut(resolveValue(s.value || s.fallback, g.variables), 300), kind: s.kind })),
    page: { name: cut(page ? pageLabel(page, pages.indexOf(page)) : '', 120) },
  };
}
