import type { ComponentDefinition } from 'grapesjs';
import type { StyleRule } from '../engine/styles';

/**
 * Template de produto: definição imutável a partir da qual se criam cópias independentes.
 * Nesta entrega os templates vivem no código; a biblioteca persistida (templates
 * importados e modificados, com versões) chega nas fases seguintes com o mesmo formato
 * de saída: o JSON de projeto do motor.
 */
export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  /** Como o logótipo é representado: texto editável ou imagem. */
  logo: 'text' | 'image' | null;
  theme: Readonly<Record<string, string>>;
  rules: readonly StyleRule[];
  components: readonly ComponentDefinition[];
}

export const text = (tagName: string, content: string, classes: string[] = []): ComponentDefinition => ({
  type: 'text',
  tagName,
  content,
  ...(classes.length ? { classes } : {}),
});

export const link = (content: string, href: string, classes: string[] = []): ComponentDefinition => ({
  type: 'link',
  content,
  attributes: { href },
  ...(classes.length ? { classes } : {}),
});

export const button = (content: string, href: string, extra: string[] = []): ComponentDefinition => ({
  type: 'bolt-button',
  content,
  attributes: { href },
  classes: ['bolt-btn', ...extra],
});

export const image = (src: string, alt: string, classes: string[] = ['bolt-image'], attributes: Record<string, string> = {}): ComponentDefinition => ({
  type: 'image',
  classes,
  attributes: { src, alt, ...attributes },
});

export const box = (type: string, classes: string[], components: ComponentDefinition[]): ComponentDefinition => ({
  type,
  classes,
  components,
});
