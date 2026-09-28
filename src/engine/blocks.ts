import type { ComponentDefinition, Editor } from 'grapesjs';

/** Imagem neutra usada até o utilizador escolher a sua (SVG embutido, sem pedidos externos). */
export const IMAGE_PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">' +
      '<rect width="800" height="500" fill="#e2e8f0"/>' +
      '<path d="M250 340l110-130 80 90 60-60 110 100z" fill="#94a3b8"/>' +
      '<circle cx="520" cy="170" r="36" fill="#94a3b8"/></svg>',
  );

export type BlockId = 'section' | 'columns' | 'heading' | 'text' | 'image' | 'button';

export interface BoltBlock {
  id: BlockId;
  label: string;
  description: string;
  content: () => ComponentDefinition;
}

const column = (title: string): ComponentDefinition => ({
  type: 'bolt-column',
  classes: ['bolt-column'],
  components: [
    { type: 'text', tagName: 'h3', content: title },
    { type: 'text', tagName: 'p', content: 'Descreva aqui este ponto em uma ou duas frases.' },
  ],
});

export const BLOCKS: readonly BoltBlock[] = [
  {
    id: 'section',
    label: 'Secção',
    description: 'Faixa de largura total com título e texto',
    content: () => ({
      type: 'bolt-section',
      classes: ['bolt-section'],
      components: [
        {
          type: 'bolt-container',
          classes: ['bolt-container'],
          components: [
            { type: 'text', tagName: 'h2', content: 'Título da secção' },
            { type: 'text', tagName: 'p', content: 'Escreva aqui o texto desta secção.' },
          ],
        },
      ],
    }),
  },
  {
    id: 'columns',
    label: 'Colunas',
    description: 'Duas colunas lado a lado',
    content: () => ({ type: 'bolt-columns', classes: ['bolt-columns'], components: [column('Primeira coluna'), column('Segunda coluna')] }),
  },
  { id: 'heading', label: 'Título', description: 'Título de secção', content: () => ({ type: 'text', tagName: 'h2', content: 'Novo título' }) },
  { id: 'text', label: 'Texto', description: 'Parágrafo de texto', content: () => ({ type: 'text', tagName: 'p', content: 'Novo parágrafo. Clique duas vezes para editar.' }) },
  {
    id: 'image',
    label: 'Imagem',
    description: 'Imagem carregada do seu computador ou de um endereço',
    content: () => ({ type: 'image', classes: ['bolt-image'], attributes: { src: IMAGE_PLACEHOLDER, alt: '' } }),
  },
  {
    id: 'button',
    label: 'Botão',
    description: 'Ligação com aspeto de botão',
    content: () => ({ type: 'bolt-button', classes: ['bolt-btn'], attributes: { href: '#' }, content: 'Botão' }),
  },
];

export function blockById(id: BlockId): BoltBlock | undefined {
  return BLOCKS.find((b) => b.id === id);
}

/** Regista os blocos no motor para arrastar do painel para o canvas. */
export function blocksPlugin(editor: Editor): void {
  for (const b of BLOCKS) {
    // `activate` na imagem abre o fluxo de escolha de imagem logo após largar o bloco.
    editor.Blocks.add(b.id, { label: b.label, content: b.content(), select: true, activate: b.id === 'image' });
  }
}
