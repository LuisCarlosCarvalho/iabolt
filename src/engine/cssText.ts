import postcss from 'postcss';

/**
 * CSS em texto (folhas literais dos sites importados): troca de ids nos SELETORES, nunca nos
 * valores (ex.: a cor `#add` não é o id «add»).
 */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function remapSelectorIds(selector: string, ids: ReadonlyMap<string, string>): string {
  let out = selector;
  for (const [from, to] of ids) out = out.replace(new RegExp(`#${escapeRe(from)}(?![\\w-])`, 'g'), `#${to}`);
  return out;
}

export function remapCssIds(css: string, ids: ReadonlyMap<string, string>): string {
  if (!ids.size) return css;
  try {
    const root = postcss.parse(css);
    root.walkRules((rule) => {
      rule.selector = remapSelectorIds(rule.selector, ids);
    });
    return root.toString();
  } catch {
    return css;
  }
}
