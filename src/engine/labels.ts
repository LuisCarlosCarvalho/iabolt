import type { Component } from 'grapesjs';

/**
 * Nomes compreensíveis para o utilizador. Derivados do modelo (tipo, tag, papel),
 * nunca guardados: o modelo continua a ser a única fonte.
 */
const TYPE_NAMES: Record<string, string> = {
  wrapper: 'Página',
  'bolt-navbar': 'Barra de navegação',
  'bolt-section': 'Secção',
  'bolt-footer': 'Rodapé',
  'bolt-container': 'Contentor',
  'bolt-columns': 'Colunas',
  'bolt-column': 'Coluna',
  'bolt-button': 'Botão',
  link: 'Ligação',
  video: 'Vídeo',
  map: 'Mapa',
};

const TAG_NAMES: Record<string, string> = {
  h1: 'Título',
  h2: 'Título',
  h3: 'Subtítulo',
  h4: 'Subtítulo',
  h5: 'Subtítulo',
  h6: 'Subtítulo',
  p: 'Texto',
  span: 'Texto',
  small: 'Texto',
  blockquote: 'Citação',
  li: 'Item de lista',
  ul: 'Lista',
  ol: 'Lista',
  nav: 'Menu',
  header: 'Cabeçalho',
  footer: 'Rodapé',
  section: 'Secção',
  figure: 'Figura',
  div: 'Bloco',
};

export function isLogo(component: Component): boolean {
  return component.getAttributes()['data-bolt-role'] === 'logo';
}

export function displayName(component: Component): string {
  const type = component.get('type') ?? 'default';
  const tag = String(component.get('tagName') ?? '').toLowerCase();
  if (type === 'image') return isLogo(component) ? 'Logótipo (imagem)' : 'Imagem';
  if (type === 'text' && isLogo(component)) return 'Logótipo (texto)';
  const byType = TYPE_NAMES[type];
  if (byType) return byType;
  const byTag = TAG_NAMES[tag];
  if (byTag) return byTag;
  return type === 'text' ? 'Texto' : 'Elemento';
}

/** Primeiras palavras do texto visível, para distinguir elementos com o mesmo nome. */
export function contentHint(component: Component, max = 40): string {
  const type = component.get('type');
  if (type === 'image') return String(component.getAttributes().alt ?? '');
  if (type !== 'text' && type !== 'link' && type !== 'bolt-button') return '';
  const text = component
    .getInnerHTML()
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
