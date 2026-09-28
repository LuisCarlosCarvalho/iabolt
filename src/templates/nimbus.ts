import { NIMBUS_DASHBOARD, NIMBUS_TEAM } from './illustrations';
import { box, button, image, link, text, type TemplateDefinition } from './types';

/** Página de lançamento de produto digital. Logótipo em TEXTO. */
export const NIMBUS: TemplateDefinition = {
  id: 'nimbus-lancamento',
  name: 'Nimbus · Lançamento de produto',
  description: 'Página de produto digital com navegação, hero com demonstração, benefícios, prova social, chamada final e rodapé.',
  category: 'Produto e SaaS',
  logo: 'text',
  theme: {
    '--bolt-primary': '#4f46e5',
    '--bolt-on-primary': '#ffffff',
    '--bolt-text': '#475569',
    '--bolt-heading': '#0f172a',
    '--bolt-bg': '#ffffff',
    '--bolt-radius': '12px',
    '--bolt-font-body': "'Inter', 'Segoe UI', system-ui, sans-serif",
    '--bolt-font-heading': "'Inter', 'Segoe UI', system-ui, sans-serif",
  },
  rules: [
    { selector: '.nb-nav', style: { position: 'sticky', top: '0', 'z-index': '10', 'background-color': 'rgba(255,255,255,0.92)', 'border-bottom': '1px solid #e2e8f0', padding: '0 24px' } },
    { selector: '.nb-nav-inner', style: { display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', gap: '24px', 'min-height': '72px' } },
    { selector: '.nb-logo', style: { 'font-size': '22px', 'font-weight': '800', 'letter-spacing': '-0.02em', color: '#0f172a' } },
    { selector: '.nb-menu', style: { display: 'flex', gap: '28px', 'align-items': 'center', margin: '0' } },
    { selector: '.nb-menu-link', style: { color: '#334155', 'text-decoration': 'none', 'font-weight': '500', 'font-size': '15px' } },
    { selector: '.nb-btn-small', style: { padding: '10px 18px', 'font-size': '14px' } },
    { selector: '.nb-hero', style: { 'background-image': 'linear-gradient(180deg, #f5f3ff 0%, #ffffff 100%)', 'padding-top': '72px' } },
    { selector: '.nb-hero-grid', style: { 'grid-template-columns': '1.05fr 0.95fr', gap: '56px', 'align-items': 'center' } },
    { selector: '.nb-eyebrow', style: { display: 'inline-block', padding: '6px 14px', 'border-radius': '999px', 'background-color': '#e0e7ff', color: '#3730a3', 'font-size': '13px', 'font-weight': '600', margin: '0 0 20px' } },
    { selector: '.nb-title', style: { 'font-size': '52px', 'font-weight': '800', 'letter-spacing': '-0.03em' } },
    { selector: '.nb-lead', style: { 'font-size': '19px', 'max-width': '520px', margin: '0 0 32px' } },
    { selector: '.nb-actions', style: { display: 'flex', gap: '14px', 'flex-wrap': 'wrap', 'align-items': 'center' } },
    { selector: '.nb-btn-ghost', style: { 'background-color': '#ffffff', color: '#312e81', border: '1px solid #c7d2fe' } },
    { selector: '.nb-hero-img', style: { 'box-shadow': '0 30px 60px -20px rgba(49,46,129,0.35)' } },
    { selector: '.nb-center', style: { 'text-align': 'center', 'max-width': '680px', margin: '0 auto 56px' } },
    { selector: '.nb-h2', style: { 'font-size': '38px', 'font-weight': '800', 'letter-spacing': '-0.02em' } },
    { selector: '.nb-card', style: { padding: '32px', 'border-radius': '16px', border: '1px solid #e2e8f0', 'background-color': '#ffffff', 'box-shadow': '0 1px 2px rgba(15,23,42,0.04)' } },
    { selector: '.nb-num', style: { display: 'inline-block', 'font-size': '14px', 'font-weight': '700', color: '#4f46e5', 'background-color': '#eef2ff', padding: '6px 10px', 'border-radius': '8px', margin: '0 0 18px' } },
    { selector: '.nb-card-title', style: { 'font-size': '20px', 'font-weight': '700' } },
    { selector: '.nb-soft', style: { 'background-color': '#f8fafc' } },
    { selector: '.nb-split', style: { 'grid-template-columns': '1fr 1fr', gap: '64px', 'align-items': 'center' } },
    { selector: '.nb-check', style: { 'padding-left': '30px', position: 'relative', margin: '0 0 12px', color: '#334155' } },
    { selector: '.nb-check::before', style: { content: '"✓"', position: 'absolute', left: '0', top: '0', color: '#4f46e5', 'font-weight': '800' } },
    { selector: '.nb-quote', style: { 'font-size': '26px', 'line-height': '1.45', color: '#0f172a', 'font-weight': '600', margin: '0 0 24px' } },
    { selector: '.nb-author', style: { 'font-weight': '600', color: '#4f46e5', margin: '0' } },
    { selector: '.nb-cta', style: { 'background-image': 'linear-gradient(135deg, #4338ca 0%, #7c3aed 100%)', color: '#e0e7ff', 'text-align': 'center' } },
    { selector: '.nb-cta-title', style: { color: '#ffffff', 'font-size': '40px', 'font-weight': '800' } },
    { selector: '.nb-btn-light', style: { 'background-color': '#ffffff', color: '#312e81' } },
    { selector: '.nb-footer', style: { 'background-color': '#0f172a', color: '#94a3b8', padding: '64px 24px 32px' } },
    { selector: '.nb-footer-logo', style: { color: '#ffffff' } },
    { selector: '.nb-footer-title', style: { color: '#ffffff', 'font-size': '15px', 'font-weight': '700', margin: '0 0 14px' } },
    { selector: '.nb-footer-link', style: { display: 'block', color: '#cbd5e1', 'text-decoration': 'none', margin: '0 0 10px', 'font-size': '15px' } },
    { selector: '.nb-legal', style: { 'border-top': '1px solid #1e293b', 'margin-top': '40px', 'padding-top': '24px', 'font-size': '14px' } },
    // Tablet
    { selector: '.nb-title', style: { 'font-size': '42px' }, maxWidth: '992px' },
    { selector: '.nb-hero-grid', style: { 'grid-template-columns': '1fr' }, maxWidth: '992px' },
    { selector: '.nb-split', style: { 'grid-template-columns': '1fr' }, maxWidth: '992px' },
    // Telemóvel
    { selector: '.nb-menu', style: { display: 'none' }, maxWidth: '480px' },
    { selector: '.nb-title', style: { 'font-size': '34px' }, maxWidth: '480px' },
    { selector: '.nb-h2', style: { 'font-size': '28px' }, maxWidth: '480px' },
    { selector: '.nb-cta-title', style: { 'font-size': '30px' }, maxWidth: '480px' },
  ],
  components: [
    box('bolt-navbar', ['nb-nav'], [
      box('bolt-container', ['bolt-container', 'nb-nav-inner'], [
        { ...text('span', 'Nimbus', ['nb-logo']), attributes: { 'data-bolt-role': 'logo' } },
        box('bolt-container', ['nb-menu'], [
          link('Recursos', '#recursos', ['nb-menu-link']),
          link('Como funciona', '#como-funciona', ['nb-menu-link']),
          link('Clientes', '#clientes', ['nb-menu-link']),
        ]),
        button('Pedir demonstração', '#contacto', ['nb-btn-small']),
      ]),
    ]),
    box('bolt-section', ['bolt-section', 'nb-hero'], [
      box('bolt-container', ['bolt-container'], [
        box('bolt-columns', ['bolt-columns', 'nb-hero-grid'], [
          box('bolt-column', ['bolt-column'], [
            text('p', 'Novo · Relatórios automáticos', ['nb-eyebrow']),
            text('h1', 'Decisões de marketing com dados, não com palpites', ['nb-title']),
            text('p', 'O Nimbus junta campanhas, vendas e tráfego num só painel e mostra, todas as manhãs, onde investir o próximo euro.', ['nb-lead']),
            box('bolt-container', ['nb-actions'], [
              button('Experimentar 14 dias', '#contacto'),
              button('Ver como funciona', '#como-funciona', ['nb-btn-ghost']),
            ]),
          ]),
          box('bolt-column', ['bolt-column'], [image(NIMBUS_DASHBOARD, 'Painel do Nimbus com métricas de campanhas', ['bolt-image', 'nb-hero-img'])]),
        ]),
      ]),
    ]),
    { ...box('bolt-section', ['bolt-section'], [
      box('bolt-container', ['bolt-container'], [
        box('bolt-container', ['nb-center'], [
          text('h2', 'Tudo o que a equipa precisa para crescer', ['nb-h2']),
          text('p', 'Menos folhas de cálculo, mais tempo para criar campanhas que funcionam.'),
        ]),
        box('bolt-columns', ['bolt-columns'], [
          box('bolt-column', ['bolt-column', 'nb-card'], [
            text('span', '01', ['nb-num']),
            text('h3', 'Tudo num só painel', ['nb-card-title']),
            text('p', 'Ligue anúncios, CRM e analytics em minutos e veja os resultados lado a lado.'),
          ]),
          box('bolt-column', ['bolt-column', 'nb-card'], [
            text('span', '02', ['nb-num']),
            text('h3', 'Alertas que importam', ['nb-card-title']),
            text('p', 'Receba um aviso quando uma campanha gasta demais ou quando surge uma oportunidade.'),
          ]),
          box('bolt-column', ['bolt-column', 'nb-card'], [
            text('span', '03', ['nb-num']),
            text('h3', 'Relatórios prontos', ['nb-card-title']),
            text('p', 'Partilhe relatórios claros com a direção sem montar apresentações à mão.'),
          ]),
        ]),
      ]),
    ]), attributes: { id: 'recursos' } },
    { ...box('bolt-section', ['bolt-section', 'nb-soft'], [
      box('bolt-container', ['bolt-container'], [
        box('bolt-columns', ['bolt-columns', 'nb-split'], [
          box('bolt-column', ['bolt-column'], [image(NIMBUS_TEAM, 'Equipa a analisar um relatório de desempenho')]),
          box('bolt-column', ['bolt-column'], [
            text('h2', 'Configure numa tarde. Veja resultados na primeira semana.', ['nb-h2']),
            text('p', 'Não precisa de equipa técnica. Escolha as fontes de dados, defina os objetivos e o Nimbus faz o resto.'),
            text('p', 'Ligação nativa a mais de 40 plataformas de anúncios e comércio eletrónico.', ['nb-check']),
            text('p', 'Metas por canal com previsão de fecho do mês.', ['nb-check']),
            text('p', 'Acesso por equipa, com permissões por cliente.', ['nb-check']),
          ]),
        ]),
      ]),
    ]), attributes: { id: 'como-funciona' } },
    { ...box('bolt-section', ['bolt-section'], [
      box('bolt-container', ['bolt-container', 'nb-center'], [
        text('p', '«Deixámos de discutir números nas reuniões. Agora discutimos o que fazer com eles.»', ['nb-quote']),
        text('p', 'Marta Ribeiro · Diretora de Marketing, Lumen', ['nb-author']),
      ]),
    ]), attributes: { id: 'clientes' } },
    { ...box('bolt-section', ['bolt-section', 'nb-cta'], [
      box('bolt-container', ['bolt-container'], [
        text('h2', 'Pronto para ver os seus números com clareza?', ['nb-cta-title']),
        text('p', 'Comece hoje. Sem cartão de crédito e com apoio na configuração.'),
        button('Começar agora', '#', ['nb-btn-light']),
      ]),
    ]), attributes: { id: 'contacto' } },
    box('bolt-footer', ['nb-footer'], [
      box('bolt-container', ['bolt-container'], [
        box('bolt-columns', ['bolt-columns'], [
          box('bolt-column', ['bolt-column'], [
            { ...text('span', 'Nimbus', ['nb-logo', 'nb-footer-logo']), attributes: { 'data-bolt-role': 'logo' } },
            text('p', 'Análise de marketing para equipas que querem crescer com método.'),
          ]),
          box('bolt-column', ['bolt-column'], [
            text('p', 'Produto', ['nb-footer-title']),
            link('Recursos', '#recursos', ['nb-footer-link']),
            link('Como funciona', '#como-funciona', ['nb-footer-link']),
          ]),
          box('bolt-column', ['bolt-column'], [
            text('p', 'Empresa', ['nb-footer-title']),
            link('Clientes', '#clientes', ['nb-footer-link']),
            link('Contacto', '#contacto', ['nb-footer-link']),
          ]),
        ]),
        text('p', '© 2026 Nimbus. Todos os direitos reservados.', ['nb-legal']),
      ]),
    ]),
  ],
};
