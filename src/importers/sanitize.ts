/**
 * Sanitização de conteúdo importado. Nada que execute código entra no documento:
 * scripts, manipuladores `on*`, URLs `javascript:`/`vbscript:`/`data:text/html`, iframes,
 * objetos embebidos e propriedades de script do motor (`script`, `script-props`).
 * Tudo o que é removido é devolvido para o relatório.
 */
const BLOCKED_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'applet', 'base', 'link', 'meta', 'noscript', 'frame', 'frameset', 'template']);
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'data', 'srcset']);

export function isUnsafeUrl(value: string): boolean {
  // Ignora espaços e caracteres de controlo que os browsers descartam (ex.: "java\tscript:").
  const v = [...value].filter((ch) => ch.charCodeAt(0) > 32).join('').toLowerCase();
  return v.startsWith('javascript:') || v.startsWith('vbscript:') || v.startsWith('data:text/html') || v.startsWith('data:application');
}

export interface SanitizedHtml {
  html: string;
  /** CSS dos elementos <style> encontrados (tratado à parte pelo importador). */
  css: string[];
  removed: string[];
}

export function sanitizeHtml(input: string): SanitizedHtml {
  const removed: string[] = [];
  const css: string[] = [];
  const parsed = new DOMParser().parseFromString(`<body>${input}</body>`, 'text/html');
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'style') {
        css.push(child.textContent ?? '');
        child.remove();
        continue;
      }
      if (BLOCKED_TAGS.has(tag)) {
        removed.push(`<${tag}> removido`);
        child.remove();
        continue;
      }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) {
          removed.push(`atributo ${name} em <${tag}>`);
          child.removeAttribute(attr.name);
        } else if (URL_ATTRS.has(name) && isUnsafeUrl(attr.value)) {
          removed.push(`${name}="${attr.value.slice(0, 30)}…" em <${tag}>`);
          child.removeAttribute(attr.name);
        }
      }
      walk(child);
    }
  };
  walk(parsed.body);
  return { html: parsed.body.innerHTML, css, removed };
}

/** Definição de componente do motor (JSON), tal como vem de um ficheiro GrapesJS. */
export interface ComponentJson {
  type?: string;
  tagName?: string;
  attributes?: Record<string, unknown>;
  classes?: unknown[];
  components?: ComponentJson[] | string;
  content?: string;
  [key: string]: unknown;
}

/** Remove, em profundidade, tudo o que o motor executaria num componente importado. */
export function sanitizeComponent(c: ComponentJson, removed: string[]): ComponentJson {
  const scriptKeys = ['script', 'script-props', 'script-export'];
  for (const key of scriptKeys.filter((k) => k in c)) removed.push(`propriedade «${key}» (${String(c.type ?? 'componente')})`);
  const out: ComponentJson = Object.fromEntries(Object.entries(c).filter(([k]) => !scriptKeys.includes(k)));
  if ((out.tagName ?? '').toLowerCase() === 'script' || out.type === 'script') {
    removed.push('componente <script>');
    return { type: 'textnode', content: '' };
  }
  if (out.attributes) {
    const attrs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(out.attributes)) {
      const name = k.toLowerCase();
      if (name.startsWith('on')) {
        removed.push(`atributo ${name}`);
        continue;
      }
      if (URL_ATTRS.has(name) && typeof v === 'string' && isUnsafeUrl(v)) {
        removed.push(`${name} com URL não segura`);
        continue;
      }
      attrs[k] = v;
    }
    out.attributes = attrs;
  }
  if (typeof out.content === 'string' && /<script|\son\w+\s*=/i.test(out.content)) {
    const clean = sanitizeHtml(out.content);
    removed.push(...clean.removed);
    out.content = clean.html;
  }
  if (Array.isArray(out.components)) out.components = out.components.map((ch) => sanitizeComponent(ch, removed));
  else if (typeof out.components === 'string') {
    const clean = sanitizeHtml(out.components);
    removed.push(...clean.removed);
    out.components = clean.html;
  }
  return out;
}
