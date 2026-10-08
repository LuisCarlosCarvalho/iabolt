import { describe, expect, it } from 'vitest';
import { convertElementor, isElementorDocument } from '../../src/importers/elementor/elementor';
import { normalizeSettings } from '../../src/importers/elementor/settings';

/**
 * Modelo Elementor no formato ANTIGO (version 0.4: secções e colunas clássicas, `isInner: ""`),
 * como «3 Página de venda MKT.json» do utilizador, que era
 * recusado inteiro a 08/10/2026. FIXTURE SINTÉTICA: estrutura igual, conteúdo inventado.
 */
const j = (v: unknown) => JSON.stringify(v);
const LEGACY = {
  version: '0.4',
  title: 'Página de vendas (teste)',
  type: 'page',
  content: [
    {
      id: 'sec1',
      elType: 'section',
      isInner: '',
      settings: { structure: '20', background_background: 'classic', background_color: '#1C186F' },
      elements: [
        {
          id: 'col1',
          elType: 'column',
          isInner: '',
          settings: { _column_size: 100 },
          elements: [
            { id: 'h1', elType: 'widget', widgetType: 'heading', isInner: '', settings: { title: 'Oferta especial', header_size: 'h1', typography_typography: 'custom', typography_font_family: 'Ubuntu', typography_font_size: j({ unit: 'px', size: '40' }) }, elements: [] },
            { id: 'dv1', elType: 'widget', widgetType: 'divider', isInner: '', settings: { color: '#E69B07', width: j({ unit: '%', size: '11' }), weight: j({ unit: 'px', size: 3.5 }), align: 'left', gap: j({ unit: 'px', size: 10 }) }, elements: [] },
            { id: 'sp1', elType: 'widget', widgetType: 'spacer', isInner: '', settings: { space: j({ unit: 'px', size: 30 }) }, elements: [] },
            {
              id: 'tm1',
              elType: 'widget',
              widgetType: 'testimonial',
              isInner: '',
              settings: { testimonial_content: 'Recomendo a todos.', testimonial_name: 'Ana Teste', testimonial_job: 'Cliente', testimonial_image: j({ id: 1, url: 'https://exemplo.pt/foto.jpg' }), content_content_color: '#ffffff' },
              elements: [],
            },
            { id: 'ct1', elType: 'widget', widgetType: 'counter', isInner: '', settings: { prefix: 'R$', ending_number: '197', title: 'por mês', number_color: '#343666' }, elements: [] },
            { id: 'vd1', elType: 'widget', widgetType: 'video', isInner: '', settings: { youtube_url: 'https://www.youtube.com/watch?v=abc', image_overlay: j({ url: 'https://exemplo.pt/capa.jpg' }), play_icon_color: '#ffffff' }, elements: [] },
            { id: 'ic1', elType: 'widget', widgetType: 'icon', isInner: '', settings: { selected_icon: j({ value: 'fas fa-brain', library: 'fa-solid' }) }, elements: [] },
            {
              id: 'ac1',
              elType: 'widget',
              widgetType: 'accordion',
              isInner: '',
              settings: { tabs: j([{ tab_title: 'Pergunta 1?', tab_content: '<p>Resposta 1</p>' }, { tab_title: 'Pergunta 2?', tab_content: '<p>Resposta 2</p>' }]), title_background: '#1C186F', title_color: '#ffffff' },
              elements: [],
            },
          ],
        },
      ],
    },
  ],
  page_settings: j({ background_color: '#ffffff' }),
};

describe('Elementor no formato antigo (0.4) — regressão de 08/10/2026', () => {
  it('valores em texto JSON passam a objetos; texto normal e «[shortcode]» ficam iguais', () => {
    expect(normalizeSettings({ width: j({ unit: '%', size: '11' }), title: 'Olá', code: '[contact-form id=1]', html: '<p>x</p>', n: 3 })).toEqual({
      width: { unit: '%', size: '11' },
      title: 'Olá',
      code: '[contact-form id=1]',
      html: '<p>x</p>',
      n: 3,
    });
  });

  it('é reconhecido e importado (antes: «não tem a estrutura de um modelo Elementor»), sem widgets perdidos', () => {
    expect(isElementorDocument(LEGACY)).toBe(true);
    const r = convertElementor(LEGACY, 'pagina.json', 1000);
    const lost = r.report.items.filter((i) => i.status === 'nao-suportado');
    expect(lost).toEqual([]);
    const sources = r.report.items.map((i) => i.source);
    for (const w of ['divider', 'spacer', 'testimonial', 'counter', 'video', 'icon', 'accordion']) expect(sources).toContain(w);
    const data = JSON.stringify(r.projectData);
    // Conteúdo presente.
    for (const t of ['Oferta especial', 'Recomendo a todos.', 'Ana Teste', 'R$197', 'por mês', 'Pergunta 2?', 'Resposta 2', 'https://www.youtube.com/watch?v=abc']) expect(data).toContain(t);
    // Valores que vinham em texto JSON foram aplicados: largura do divisor, espessura, altura do espaço.
    expect(data).toContain('"width":"11%"');
    expect(data).toContain('"border-top-width":"3.5px"');
    expect(data).toContain('"height":"30px"');
    // Imagens em texto JSON registadas (testemunho e capa do vídeo); fontes reconhecidas.
    expect(r.report.assets.map((a) => a.url).sort()).toEqual(['https://exemplo.pt/capa.jpg', 'https://exemplo.pt/foto.jpg']);
    expect(r.fontRequests.map((f) => f.family)).toContain('Ubuntu');
  });

  it('limitações explicadas no relatório: ícone de fonte, vídeo como capa com ligação, contador sem animação', () => {
    const r = convertElementor(LEGACY, 'pagina.json', 1000);
    const detail = (src: string) => r.report.items.find((i) => i.source === src)?.detail ?? '';
    expect(detail('icon')).toContain('fas fa-brain');
    expect(detail('video')).toContain('abre no site de origem');
    expect(detail('counter')).toContain('sem a animação');
  });

  it('secções e colunas clássicas: altura do ecrã, larguras das colunas, empilhar no telemóvel e «hidden-phone»', () => {
    const doc = {
      version: '0.4',
      content: [
        {
          id: 'hero',
          elType: 'section',
          isInner: '',
          settings: { height: 'full', content_position: 'middle' },
          elements: [
            { id: 'c1', elType: 'column', isInner: '', settings: { _column_size: '50', _inline_size: '40.225' }, elements: [{ id: 'b1', elType: 'widget', widgetType: 'button', isInner: '', settings: { text: 'Comprar', hide_mobile: 'hidden-phone' }, elements: [] }] },
            { id: 'c2', elType: 'column', isInner: '', settings: { _column_size: '50', _inline_size: '59.775' }, elements: [] },
          ],
        },
      ],
    };
    const r = convertElementor(doc, 'x.json', 10);
    const rules = JSON.stringify(r.projectData);
    expect(rules).toContain('"min-height":"100vh"');
    expect(rules).toContain('"align-items":"center"');
    expect(rules).toContain('"width":"40.225%"');
    expect(rules).toContain('"width":"59.775%"');
    // No telemóvel (até 767px): a secção empilha e as colunas ocupam 100%; «hidden-phone» (forma
    // antiga de «hidden-mobile») esconde o botão.
    const mobile = (r.projectData.styles ?? [])
      .map((st) => (st && typeof st === 'object' ? st : {}))
      .filter((st) => String(Reflect.get(st, 'mediaText') ?? '').includes('max-width: 767px'))
      .map((st) => {
        const style: unknown = Reflect.get(st, 'style');
        return style && typeof style === 'object' ? style : {};
      });
    expect(mobile.some((st) => Reflect.get(st, 'flex-direction') === 'column')).toBe(true);
    expect(mobile.some((st) => Reflect.get(st, 'width') === '100%')).toBe(true);
    expect(mobile.some((st) => Reflect.get(st, 'display') === 'none')).toBe(true);
  });
});
