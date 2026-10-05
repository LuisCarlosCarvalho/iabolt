import { describe, expect, it } from 'vitest';
import { createBoltEditor, getProjectData, renderProjectHtml } from '../../src/engine/createBoltEditor';
import { cleanFamily, ensureGoogleFont, googleCssUrls, googleFontStack, hasFontFace, type FontFetch } from '../../src/engine/googleFonts';
import { projectFontFamilies } from '../../src/engine/globalStyles';

/** Resposta de exemplo no formato do css2 da Google (fixture de teste, sem rede). */
const FIXTURE_CSS = (family: string) => `
/* latin-ext */
@font-face { font-family: '${family}'; font-style: normal; font-weight: 400; font-display: swap; src: url(https://fonts.gstatic.com/s/x/v1/a.woff2) format('woff2'); unicode-range: U+0100-02BA; }
/* latin */
@font-face { font-family: '${family}'; font-style: normal; font-weight: 400; font-display: swap; src: url(https://fonts.gstatic.com/s/x/v1/b.woff2) format('woff2'); unicode-range: U+0000-00FF; }
@font-face { font-family: '${family}'; font-style: normal; font-weight: 700; font-display: swap; src: url(https://fonts.gstatic.com/s/x/v1/c.woff2) format('woff2'); unicode-range: U+0000-00FF; }
`;

function stub(responses: Array<{ status: number; body?: string }>) {
  const calls: string[] = [];
  const fetcher: FontFetch = async (url) => {
    calls.push(url);
    const r = responses[Math.min(calls.length - 1, responses.length - 1)] ?? { status: 500 };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body ?? '' };
  };
  return { fetcher, calls };
}

describe('Google Fonts no projeto', () => {
  it('nomes e endereços', () => {
    expect(cleanFamily('  Playfair   Display ')).toBe('Playfair Display');
    expect(cleanFamily('x}; @import url(a)')).toBeNull();
    expect(cleanFamily('')).toBeNull();
    expect(googleFontStack('Playfair Display')).toBe("'Playfair Display', serif");
    expect(googleFontStack('Dancing Script')).toBe("'Dancing Script', cursive");
    expect(googleFontStack('Quicksand')).toBe("'Quicksand', sans-serif");
    expect(googleCssUrls('Open Sans')[0]).toBe('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700;800&display=swap');
  });

  it('acrescenta cada @font-face uma única vez e o site exportado inclui-as', async () => {
    const editor = createBoltEditor();
    const { fetcher, calls } = stub([{ status: 200, body: FIXTURE_CSS('Poppins') }]);
    expect(hasFontFace(editor, 'Poppins')).toBe(false);
    const stack = await ensureGoogleFont(editor, 'Poppins', fetcher);
    expect(stack).toBe("'Poppins', sans-serif");
    const faces = editor.Css.getRules().filter((r) => r.get('atRuleType') === 'font-face');
    expect(faces).toHaveLength(3); // não são fundidas numa só regra
    expect(projectFontFamilies(editor)).toContain('Poppins');
    // Segunda escolha: já está no projeto, nada é pedido.
    await ensureGoogleFont(editor, 'poppins', fetcher);
    expect(calls).toHaveLength(1);
    const { css } = renderProjectHtml(getProjectData(editor));
    expect(css.match(/@font-face/g)).toHaveLength(3);
    expect(css).toContain('https://fonts.gstatic.com/s/x/v1/c.woff2');
    editor.destroy();
  });

  it('sem os pesos pedidos tenta sem pesos; família inexistente dá erro legível e não altera o projeto', async () => {
    const editor = createBoltEditor();
    const ok = stub([{ status: 400 }, { status: 200, body: FIXTURE_CSS('Pacifico') }]);
    await ensureGoogleFont(editor, 'Pacifico', ok.fetcher);
    expect(ok.calls[1]).toBe('https://fonts.googleapis.com/css2?family=Pacifico&display=swap');
    expect(hasFontFace(editor, 'Pacifico')).toBe(true);

    const before = editor.Css.getRules().length;
    const bad = stub([{ status: 400 }]);
    await expect(ensureGoogleFont(editor, 'Nao Existe Mesmo', bad.fetcher)).rejects.toThrow('a família não existe no Google Fonts');
    // Resposta sem ficheiros da Google: ignorada.
    const odd = stub([{ status: 200, body: "@font-face { font-family: 'X'; src: url(https://exemplo.pt/x.woff2); }" }]);
    await expect(ensureGoogleFont(editor, 'X', odd.fetcher)).rejects.toThrow('resposta sem fontes');
    expect(editor.Css.getRules().length).toBe(before);
    editor.destroy();
  });
});
