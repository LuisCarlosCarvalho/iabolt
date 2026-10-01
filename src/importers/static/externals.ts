/**
 * Dependências externas conhecidas de sites estáticos (CDN de ícones, fontes e bibliotecas).
 * Nenhum script externo é carregado nem executado: os que só servem para desenhar ícones têm
 * equivalente em CSS publicado pelo mesmo fornecedor e são convertidos; os restantes são
 * removidos e descritos no relatório.
 */

export interface ScriptConversion {
  /** Folha de estilos equivalente, do mesmo fornecedor e versão. */
  css: string;
  label: string;
  detail: string;
  license: string;
}

/** Font Awesome em JavaScript (SVG) → a folha CSS com fontes de ícones da mesma versão. */
export function fontAwesomeCssFor(src: string): ScriptConversion | null {
  const detail =
    'O script original desenha os ícones em SVG; foi substituído pela folha CSS oficial da mesma versão, que desenha os mesmos ícones com fontes. Tamanho e alinhamento podem diferir ligeiramente do SVG (não comparado visualmente com o script a correr).';
  const license = 'Font Awesome Free: ícones CC BY 4.0, fontes SIL OFL 1.1, código MIT';
  const official = /^(?:https?:)?\/\/use\.fontawesome\.com\/releases\/(v[\d.]+)\/js\/(all|fontawesome|solid|regular|brands)(?:\.min)?\.js/i.exec(src);
  if (official?.[1] && official[2]) return { css: `https://use.fontawesome.com/releases/${official[1]}/css/${official[2]}.css`, label: `Font Awesome ${official[1]} (JavaScript)`, detail, license };
  const cdnjs = /^(?:https?:)?\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/([\d.]+)\/js\/(all|fontawesome|solid|regular|brands)(?:\.min)?\.js/i.exec(src);
  if (cdnjs?.[1] && cdnjs[2]) return { css: `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/${cdnjs[1]}/css/${cdnjs[2]}.min.css`, label: `Font Awesome ${cdnjs[1]} (JavaScript)`, detail, license };
  const jsdelivr = /^(?:https?:)?\/\/cdn\.jsdelivr\.net\/npm\/@fortawesome\/fontawesome-free@([\d.]+)\/js\/(all|fontawesome|solid|regular|brands)(?:\.min)?\.js/i.exec(src);
  if (jsdelivr?.[1] && jsdelivr[2]) return { css: `https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@${jsdelivr[1]}/css/${jsdelivr[2]}.min.css`, label: `Font Awesome ${jsdelivr[1]} (JavaScript)`, detail, license };
  return null;
}

export interface KnownScript {
  label: string;
  kind: 'bootstrap' | 'jquery' | 'fontawesome-kit' | 'analytics' | 'other';
}

export function knownScript(src: string): KnownScript {
  const s = src.toLowerCase();
  if (/bootstrap(\.bundle)?(\.min)?\.js/.test(s)) return { label: 'Bootstrap (JavaScript)', kind: 'bootstrap' };
  if (/jquery(-[\d.]+)?(\.min)?\.js/.test(s)) return { label: 'jQuery', kind: 'jquery' };
  if (/kit\.fontawesome\.com/.test(s)) return { label: 'Font Awesome Kit', kind: 'fontawesome-kit' };
  if (/googletagmanager|google-analytics|gtag\/js|analytics\.js/.test(s)) return { label: 'Estatísticas (Google Analytics/Tag Manager)', kind: 'analytics' };
  return { label: 'Script', kind: 'other' };
}

/** Licença conhecida de uma folha de estilos ou fonte externa, pelo endereço. */
export function knownLicense(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('fonts.googleapis.com') || u.includes('fonts.gstatic.com')) return 'Licença aberta do Google Fonts (SIL OFL 1.1 ou Apache 2.0)';
  if (u.includes('fontawesome')) return 'Font Awesome Free: ícones CC BY 4.0, fontes SIL OFL 1.1, código MIT';
  if (u.includes('simple-line-icons')) return 'Simple Line Icons: MIT';
  if (u.includes('bootstrap-icons')) return 'Bootstrap Icons: MIT';
  if (/\/bootstrap(@|\/)/.test(u)) return 'Bootstrap: MIT';
  return 'Por verificar';
}

export function hostOf(url: string): string {
  try {
    return new URL(url.startsWith('//') ? `https:${url}` : url).host;
  } catch {
    return url.slice(0, 60);
  }
}

/** Mapas incorporados aceites (iframe do Google Maps). Os outros iframes não entram no documento. */
export function isAllowedMapEmbed(src: string): boolean {
  let u: URL;
  try {
    u = new URL(src.startsWith('//') ? `https:${src}` : src);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'www.google.com' || host === 'google.com') return u.pathname.startsWith('/maps/embed');
  if (host === 'maps.google.com') return u.pathname.startsWith('/maps') && u.searchParams.get('output') === 'embed';
  return false;
}

/** Endereço https do mapa (os incorporados antigos usam http://maps.google.com). */
export function secureMapSrc(src: string): string {
  return src.replace(/^\/\//, 'https://').replace(/^http:\/\//i, 'https://');
}
