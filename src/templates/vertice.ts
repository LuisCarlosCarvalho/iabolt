import { VERTICE_HERO, VERTICE_LOGO, VERTICE_LOGO_LIGHT, VERTICE_MEETING } from './illustrations';
import { box, button, image, link, text, type TemplateDefinition } from './types';

/** Site institucional de serviços profissionais. Logótipo em IMAGEM. */
export const VERTICE: TemplateDefinition = {
  id: 'vertice-servicos',
  name: 'Vértice · Serviços profissionais',
  description: 'Site institucional para consultoria ou agência: serviços, método de trabalho, equipa, contacto e rodapé.',
  category: 'Serviços e empresas',
  logo: 'image',
  theme: {
    '--bolt-primary': '#0f766e',
    '--bolt-on-primary': '#ffffff',
    '--bolt-text': '#44403c',
    '--bolt-heading': '#1c1917',
    '--bolt-bg': '#fffdf8',
    '--bolt-radius': '6px',
    '--bolt-font-body': "'Inter', 'Segoe UI', system-ui, sans-serif",
    '--bolt-font-heading': "Georgia, 'Times New Roman', serif",
  },
  rules: [
    { selector: '.vt-nav', style: { 'background-color': '#fffdf8', 'border-bottom': '1px solid #e7e5e4', padding: '0 24px' } },
    { selector: '.vt-nav-inner', style: { display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', gap: '24px', 'min-height': '80px' } },
    { selector: '.vt-logo', style: { display: 'block', width: '176px', height: 'auto' } },
    { selector: '.vt-menu', style: { display: 'flex', gap: '32px', 'align-items': 'center' } },
    { selector: '.vt-menu-link', style: { color: '#44403c', 'text-decoration': 'none', 'font-size': '15px', 'font-weight': '500' } },
    { selector: '.vt-hero', style: { 'padding-top': '64px' } },
    { selector: '.vt-hero-grid', style: { 'grid-template-columns': '1fr 1fr', gap: '64px', 'align-items': 'center' } },
    { selector: '.vt-kicker', style: { 'text-transform': 'uppercase', 'letter-spacing': '0.14em', 'font-size': '13px', 'font-weight': '700', color: '#b45309', margin: '0 0 18px' } },
    { selector: '.vt-title', style: { 'font-size': '54px', 'font-weight': '700', 'letter-spacing': '-0.01em' } },
    { selector: '.vt-lead', style: { 'font-size': '19px', margin: '0 0 32px', 'max-width': '520px' } },
    { selector: '.vt-actions', style: { display: 'flex', gap: '20px', 'align-items': 'center', 'flex-wrap': 'wrap' } },
    { selector: '.vt-text-link', style: { color: '#0f766e', 'font-weight': '600', 'text-decoration': 'underline', 'text-underline-offset': '4px' } },
    { selector: '.vt-band', style: { 'background-color': '#f5f5f4' } },
    { selector: '.vt-head', style: { 'max-width': '640px', margin: '0 0 48px' } },
    { selector: '.vt-h2', style: { 'font-size': '40px', 'font-weight': '700' } },
    { selector: '.vt-service', style: { 'border-top': '3px solid #0f766e', 'padding-top': '24px' } },
    { selector: '.vt-service-title', style: { 'font-size': '22px' } },
    { selector: '.vt-steps', style: { 'grid-template-columns': 'repeat(4, 1fr)', gap: '24px' } },
    { selector: '.vt-step', style: { 'background-color': '#ffffff', padding: '28px', 'border-radius': '6px', border: '1px solid #e7e5e4' } },
    { selector: '.vt-step-num', style: { 'font-family': "Georgia, 'Times New Roman', serif", 'font-size': '36px', color: '#f59e0b', margin: '0 0 8px', 'line-height': '1' } },
    { selector: '.vt-about', style: { 'grid-template-columns': '0.9fr 1.1fr', gap: '64px', 'align-items': 'center' } },
    { selector: '.vt-stat-row', style: { 'grid-template-columns': 'repeat(3, 1fr)', gap: '24px', 'margin-top': '32px' } },
    { selector: '.vt-stat', style: { 'font-family': "Georgia, 'Times New Roman', serif", 'font-size': '36px', color: '#0f766e', margin: '0' } },
    { selector: '.vt-stat-label', style: { 'font-size': '14px', margin: '0' } },
    { selector: '.vt-contact', style: { 'background-color': '#134e4a', color: '#ccfbf1' } },
    { selector: '.vt-contact-grid', style: { 'grid-template-columns': '1.2fr 0.8fr', gap: '48px', 'align-items': 'center' } },
    { selector: '.vt-contact-title', style: { color: '#ffffff', 'font-size': '40px' } },
    { selector: '.vt-btn-amber', style: { 'background-color': '#f59e0b', color: '#1c1917' } },
    { selector: '.vt-footer', style: { 'background-color': '#1c1917', color: '#a8a29e', padding: '56px 24px 32px' } },
    { selector: '.vt-footer-title', style: { color: '#fafaf9', 'font-weight': '700', margin: '0 0 12px', 'font-size': '15px' } },
    { selector: '.vt-footer-link', style: { display: 'block', color: '#d6d3d1', 'text-decoration': 'none', margin: '0 0 8px', 'font-size': '15px' } },
    { selector: '.vt-legal', style: { 'border-top': '1px solid #292524', 'margin-top': '40px', 'padding-top': '24px', 'font-size': '14px' } },
    // Tablet
    { selector: '.vt-hero-grid', style: { 'grid-template-columns': '1fr' }, maxWidth: '992px' },
    { selector: '.vt-steps', style: { 'grid-template-columns': 'repeat(2, 1fr)' }, maxWidth: '992px' },
    { selector: '.vt-about', style: { 'grid-template-columns': '1fr' }, maxWidth: '992px' },
    { selector: '.vt-contact-grid', style: { 'grid-template-columns': '1fr' }, maxWidth: '992px' },
    // Telemóvel
    { selector: '.vt-menu', style: { display: 'none' }, maxWidth: '480px' },
    { selector: '.vt-title', style: { 'font-size': '36px' }, maxWidth: '480px' },
    { selector: '.vt-h2', style: { 'font-size': '30px' }, maxWidth: '480px' },
    { selector: '.vt-steps', style: { 'grid-template-columns': '1fr' }, maxWidth: '480px' },
    { selector: '.vt-stat-row', style: { 'grid-template-columns': '1fr' }, maxWidth: '480px' },
  ],
  components: [
    box('bolt-navbar', ['vt-nav'], [
      box('bolt-container', ['bolt-container', 'vt-nav-inner'], [
        image(VERTICE_LOGO, 'Vértice Consultoria', ['vt-logo'], { 'data-bolt-role': 'logo' }),
        box('bolt-container', ['vt-menu'], [
          link('Serviços', '#servicos', ['vt-menu-link']),
          link('Método', '#metodo', ['vt-menu-link']),
          link('Sobre nós', '#sobre', ['vt-menu-link']),
        ]),
        button('Marcar reunião', '#contacto'),
      ]),
    ]),
    box('bolt-section', ['bolt-section', 'vt-hero'], [
      box('bolt-container', ['bolt-container'], [
        box('bolt-columns', ['bolt-columns', 'vt-hero-grid'], [
          box('bolt-column', ['bolt-column'], [
            text('p', 'Consultoria de gestão', ['vt-kicker']),
            text('h1', 'Estratégia clara para empresas que querem ir mais longe', ['vt-title']),
            text('p', 'Ajudamos equipas de direção a definir prioridades, organizar operações e crescer de forma sustentável.', ['vt-lead']),
            box('bolt-container', ['vt-actions'], [
              button('Marcar conversa inicial', '#contacto'),
              link('Conhecer os serviços', '#servicos', ['vt-text-link']),
            ]),
          ]),
          box('bolt-column', ['bolt-column'], [image(VERTICE_HERO, 'Ilustração de montanhas e sol a nascer')]),
        ]),
      ]),
    ]),
    { ...box('bolt-section', ['bolt-section', 'vt-band'], [
      box('bolt-container', ['bolt-container'], [
        box('bolt-container', ['vt-head'], [
          text('p', 'O que fazemos', ['vt-kicker']),
          text('h2', 'Serviços desenhados à medida da sua fase de crescimento', ['vt-h2']),
        ]),
        box('bolt-columns', ['bolt-columns'], [
          box('bolt-column', ['bolt-column', 'vt-service'], [
            text('h3', 'Estratégia', ['vt-service-title']),
            text('p', 'Plano a três anos com objetivos mensuráveis, prioridades e orçamento.'),
          ]),
          box('bolt-column', ['bolt-column', 'vt-service'], [
            text('h3', 'Operações', ['vt-service-title']),
            text('p', 'Processos mais simples, indicadores de desempenho e rotinas de gestão.'),
          ]),
          box('bolt-column', ['bolt-column', 'vt-service'], [
            text('h3', 'Pessoas', ['vt-service-title']),
            text('p', 'Estrutura, funções e liderança para uma equipa preparada para crescer.'),
          ]),
        ]),
      ]),
    ]), attributes: { id: 'servicos' } },
    { ...box('bolt-section', ['bolt-section'], [
      box('bolt-container', ['bolt-container'], [
        box('bolt-container', ['vt-head'], [
          text('p', 'Método', ['vt-kicker']),
          text('h2', 'Quatro etapas, resultados visíveis em cada uma', ['vt-h2']),
        ]),
        box('bolt-columns', ['bolt-columns', 'vt-steps'], [
          box('bolt-column', ['bolt-column', 'vt-step'], [text('p', '1', ['vt-step-num']), text('h3', 'Diagnóstico'), text('p', 'Entrevistas e análise de dados para perceber onde está hoje.')]),
          box('bolt-column', ['bolt-column', 'vt-step'], [text('p', '2', ['vt-step-num']), text('h3', 'Plano'), text('p', 'Prioridades acordadas com a direção e metas por trimestre.')]),
          box('bolt-column', ['bolt-column', 'vt-step'], [text('p', '3', ['vt-step-num']), text('h3', 'Execução'), text('p', 'Acompanhamento semanal com as equipas responsáveis.')]),
          box('bolt-column', ['bolt-column', 'vt-step'], [text('p', '4', ['vt-step-num']), text('h3', 'Revisão'), text('p', 'Resultados medidos e ajustes antes do próximo ciclo.')]),
        ]),
      ]),
    ]), attributes: { id: 'metodo' } },
    { ...box('bolt-section', ['bolt-section', 'vt-band'], [
      box('bolt-container', ['bolt-container'], [
        box('bolt-columns', ['bolt-columns', 'vt-about'], [
          box('bolt-column', ['bolt-column'], [image(VERTICE_MEETING, 'Três consultores numa reunião de trabalho')]),
          box('bolt-column', ['bolt-column'], [
            text('p', 'Sobre nós', ['vt-kicker']),
            text('h2', 'Uma equipa pequena, com experiência de quem já geriu empresas', ['vt-h2']),
            text('p', 'Somos consultores com percurso em direção comercial, financeira e de operações. Trabalhamos com poucas empresas de cada vez para estar presentes quando é preciso.'),
            box('bolt-columns', ['bolt-columns', 'vt-stat-row'], [
              box('bolt-column', ['bolt-column'], [text('p', '15', ['vt-stat']), text('p', 'anos de experiência', ['vt-stat-label'])]),
              box('bolt-column', ['bolt-column'], [text('p', '120+', ['vt-stat']), text('p', 'projetos concluídos', ['vt-stat-label'])]),
              box('bolt-column', ['bolt-column'], [text('p', '92%', ['vt-stat']), text('p', 'clientes que regressam', ['vt-stat-label'])]),
            ]),
          ]),
        ]),
      ]),
    ]), attributes: { id: 'sobre' } },
    { ...box('bolt-section', ['bolt-section', 'vt-contact'], [
      box('bolt-container', ['bolt-container'], [
        box('bolt-columns', ['bolt-columns', 'vt-contact-grid'], [
          box('bolt-column', ['bolt-column'], [
            text('h2', 'Vamos conversar sobre o próximo passo da sua empresa', ['vt-contact-title']),
            text('p', 'A primeira reunião é gratuita e sem compromisso. Respondemos em 24 horas úteis.'),
          ]),
          box('bolt-column', ['bolt-column'], [button('Marcar reunião', 'mailto:ola@vertice.pt', ['vt-btn-amber'])]),
        ]),
      ]),
    ]), attributes: { id: 'contacto' } },
    box('bolt-footer', ['vt-footer'], [
      box('bolt-container', ['bolt-container'], [
        box('bolt-columns', ['bolt-columns'], [
          box('bolt-column', ['bolt-column'], [
            image(VERTICE_LOGO_LIGHT, 'Vértice Consultoria', ['vt-logo'], { 'data-bolt-role': 'logo' }),
            text('p', 'Consultoria de gestão para pequenas e médias empresas.'),
          ]),
          box('bolt-column', ['bolt-column'], [
            text('p', 'Contactos', ['vt-footer-title']),
            link('ola@vertice.pt', 'mailto:ola@vertice.pt', ['vt-footer-link']),
            link('+351 210 000 000', 'tel:+351210000000', ['vt-footer-link']),
          ]),
          box('bolt-column', ['bolt-column'], [
            text('p', 'Morada', ['vt-footer-title']),
            text('p', 'Avenida da Liberdade, 100 · Lisboa'),
          ]),
        ]),
        text('p', '© 2026 Vértice Consultoria.', ['vt-legal']),
      ]),
    ]),
  ],
};
