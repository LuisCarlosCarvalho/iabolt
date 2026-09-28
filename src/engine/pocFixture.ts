import type { ComponentDefinition } from 'grapesjs';

/**
 * FIXTURE DE TESTE — prova técnica da Fase 0. Não é um template de produto.
 * Navbar com logo textual e logo de imagem, Hero com título, texto, botão e imagem.
 * Cada elemento é um componente real do motor, com id explícito.
 */
const PIXEL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#2563eb"/></svg>');

export const POC_FIXTURE: ComponentDefinition[] = [
  {
    type: 'bolt-navbar',
    attributes: { id: 'nav' },
    components: [
      { type: 'text', tagName: 'span', attributes: { id: 'logo-text', 'data-bolt-role': 'logo' }, content: 'Blue Bolt' },
      { type: 'image', attributes: { id: 'logo-img', 'data-bolt-role': 'logo', src: PIXEL, alt: 'Logótipo Blue Bolt' } },
    ],
  },
  {
    type: 'bolt-section',
    attributes: { id: 'hero' },
    components: [
      { type: 'text', tagName: 'h1', attributes: { id: 'hero-title' }, content: 'Websites que convertem' },
      { type: 'text', tagName: 'p', attributes: { id: 'hero-text' }, content: 'Construa e edite visualmente.' },
      { type: 'link', attributes: { id: 'hero-cta', href: '#contacto' }, content: 'Falar connosco' },
      { type: 'image', attributes: { id: 'hero-img', src: PIXEL, alt: 'Ilustração do hero' } },
    ],
  },
];
