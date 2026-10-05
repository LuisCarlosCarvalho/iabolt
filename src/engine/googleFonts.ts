import type { Editor } from 'grapesjs';
import { parseCss } from '../importers/css';

/**
 * Biblioteca do Google Fonts no editor. Ao escolher uma família, as regras @font-face da Google
 * (ficheiros em fonts.gstatic.com, licenças abertas) passam a fazer parte dos estilos do projeto,
 * tal como na importação: o canvas, as pré-visualizações e o site publicado usam a mesma fonte.
 */

export type FontCategory = 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace';

/** Famílias populares do Google Fonts (lista curada; outras podem ser escritas pelo nome). */
export const GOOGLE_FONTS: ReadonlyArray<readonly [string, FontCategory]> = [
  ['Roboto', 'sans-serif'],
  ['Open Sans', 'sans-serif'],
  ['Montserrat', 'sans-serif'],
  ['Poppins', 'sans-serif'],
  ['Lato', 'sans-serif'],
  ['Inter', 'sans-serif'],
  ['Nunito', 'sans-serif'],
  ['Raleway', 'sans-serif'],
  ['Work Sans', 'sans-serif'],
  ['DM Sans', 'sans-serif'],
  ['Rubik', 'sans-serif'],
  ['Manrope', 'sans-serif'],
  ['Outfit', 'sans-serif'],
  ['Source Sans 3', 'sans-serif'],
  ['Barlow', 'sans-serif'],
  ['Mulish', 'sans-serif'],
  ['Oswald', 'sans-serif'],
  ['Playfair Display', 'serif'],
  ['Merriweather', 'serif'],
  ['Lora', 'serif'],
  ['PT Serif', 'serif'],
  ['Libre Baskerville', 'serif'],
  ['Cormorant Garamond', 'serif'],
  ['EB Garamond', 'serif'],
  ['DM Serif Display', 'serif'],
  ['Bebas Neue', 'display'],
  ['Anton', 'display'],
  ['Abril Fatface', 'display'],
  ['Righteous', 'display'],
  ['Dancing Script', 'handwriting'],
  ['Pacifico', 'handwriting'],
  ['Caveat', 'handwriting'],
  ['Great Vibes', 'handwriting'],
  ['Roboto Mono', 'monospace'],
  ['Fira Code', 'monospace'],
  ['JetBrains Mono', 'monospace'],
];

const FALLBACK: Record<FontCategory, string> = {
  'sans-serif': 'sans-serif',
  serif: 'serif',
  display: 'sans-serif',
  handwriting: 'cursive',
  monospace: 'monospace',
};

/** Prefixo dos valores do seletor que pedem uma família do Google Fonts. */
export const GOOGLE_PREFIX = 'google:';

/** Nome de família aceite (letras, números, espaços e hífenes; como no Google Fonts). */
export function cleanFamily(name: string): string | null {
  const family = name.trim().replace(/\s+/g, ' ');
  return /^[\p{L}\p{N}][\p{L}\p{N} -]{0,59}$/u.test(family) ? family : null;
}

/** Valor CSS de `font-family` para uma família do Google (com a alternativa da categoria). */
export function googleFontStack(family: string): string {
  const category = GOOGLE_FONTS.find(([f]) => f.toLowerCase() === family.toLowerCase())?.[1] ?? 'sans-serif';
  return `'${family}', ${FALLBACK[category]}`;
}

/** Endereços do CSS da Google: primeiro com os pesos habituais; sem pesos se a família não os tiver. */
export function googleCssUrls(family: string): string[] {
  const q = encodeURIComponent(family).replace(/%20/g, '+');
  return [`https://fonts.googleapis.com/css2?family=${q}:wght@400;500;600;700;800&display=swap`, `https://fonts.googleapis.com/css2?family=${q}&display=swap`];
}

const unquote = (v: string) => (v.split(',')[0] ?? '').trim().replace(/^['"]|['"]$/g, '');

/** A família já tem @font-face no projeto? */
export function hasFontFace(editor: Editor, family: string): boolean {
  const want = family.toLowerCase();
  return editor.Css.getRules().some((r) => {
    if (r.get('atRuleType') !== 'font-face') return false;
    const fam = r.getStyle()['font-family'];
    return typeof fam === 'string' && unquote(fam).toLowerCase() === want;
  });
}

export type FontFetch = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * Garante que a família está carregada no projeto (acrescenta as regras @font-face da Google uma
 * única vez). Devolve o valor de `font-family` a usar. Falha com uma mensagem legível.
 */
export async function ensureGoogleFont(editor: Editor, name: string, fetcher: FontFetch = (url) => fetch(url, { credentials: 'omit' })): Promise<string> {
  const family = cleanFamily(name);
  if (!family) throw new Error('Nome de fonte inválido.');
  const stack = googleFontStack(family);
  if (hasFontFace(editor, family)) return stack;
  let lastError = '';
  for (const url of googleCssUrls(family)) {
    let css: string;
    try {
      const res = await fetcher(url);
      if (!res.ok) {
        lastError = res.status === 400 ? 'a família não existe no Google Fonts' : `HTTP ${res.status}`;
        continue;
      }
      css = await res.text();
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      continue;
    }
    const faces = parseCss(css).rules.filter((r) => r.atRuleType === 'font-face' && /fonts\.gstatic\.com/.test(r.style.src ?? ''));
    if (!faces.length) {
      lastError = 'resposta sem fontes';
      continue;
    }
    // Cada @font-face é uma regra própria (o `addCollection` juntaria as regras sem seletor numa só).
    if (hasFontFace(editor, family)) return stack; // outro pedido concluiu entretanto
    editor.Css.getAll().add(faces.map((f) => ({ ...f, style: { ...f.style } })));
    return stack;
  }
  throw new Error(`Não foi possível carregar «${family}» do Google Fonts (${lastError || 'sem resposta'}).`);
}
