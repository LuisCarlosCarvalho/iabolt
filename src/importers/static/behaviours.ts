/**
 * Comportamentos dos scripts de um site importado, reconhecidos por LEITURA do código (nunca
 * executado) e passados para o runtime do Bolt como atributos `data-bolt-*`:
 *
 *  - alternar classe ao clicar (menus laterais, «hambúrguer»): `data-bolt-toggle` (seletor do
 *    alvo), `data-bolt-toggle-class`, `data-bolt-toggle-self` e `data-bolt-toggle-swap`;
 *  - mostrar depois de rolar (botão «voltar ao topo»): `data-bolt-show-after` (px) e
 *    `data-bolt-show-effect` («fade» ou nenhum).
 *
 * O que não for reconhecido não é «declarado equivalente»: fica no relatório como não suportado.
 */

export interface ToggleBehaviour {
  kind: 'toggle';
  /** Seletor dos elementos que recebem o clique. */
  trigger: string;
  /** Seletor dos elementos cuja classe alterna. */
  target: string;
  targetClass: string;
  /** Classe que alterna no próprio botão (se o script o fizer). */
  selfClass?: string;
  /** Classes trocadas num ícone dentro do botão (ex.: «fa-bars fa-xmark»). */
  swap?: [string, string];
  origin: string;
}

export interface ShowAfterBehaviour {
  kind: 'show-after';
  target: string;
  threshold: number;
  effect: 'fade' | 'none';
  origin: string;
}

export type Behaviour = ToggleBehaviour | ShowAfterBehaviour;

export interface ListenerFinding {
  event: string;
  /** Seletor do alvo, quando foi possível determiná-lo. */
  selector: string | null;
  recognized: boolean;
  detail: string;
}

export interface ScriptAnalysis {
  behaviours: Behaviour[];
  listeners: ListenerFinding[];
  /** Comentários de autoria/licença («/*! … *\/»), para preservar. */
  notices: string[];
}

const STR = `['"\`]([^'"\`]+)['"\`]`;

/** Bloco entre chavetas a partir de `start` (o índice de «{»). Ignora chavetas em strings e comentários. */
function blockAt(code: string, start: number): string {
  let depth = 0;
  let i = start;
  let quote: string | null = null;
  for (; i < code.length; i += 1) {
    const ch = code[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && code[i + 1] === '/') {
      const nl = code.indexOf('\n', i);
      i = nl < 0 ? code.length : nl;
      continue;
    }
    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end < 0 ? code.length : end + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(start + 1, i);
    }
  }
  return code.slice(start + 1);
}

/** Variáveis ligadas a elementos: `const x = document.getElementById('a')` / `querySelector('.b')`. */
function bindings(code: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:\\[\\]\\.slice\\.call\\(\\s*)?document(?:\\.body)?\\.(getElementById|querySelector|querySelectorAll|getElementsByClassName)\\(\\s*${STR}\\s*\\)`, 'g');
  for (const m of code.matchAll(re)) {
    const [, name, fn, arg] = m;
    if (!name || !fn || !arg) continue;
    out.set(name, fn === 'getElementById' ? `#${arg}` : fn === 'getElementsByClassName' ? `.${arg.trim().split(/\s+/).join('.')}` : arg);
  }
  // Aliases de iteração: `lista.map(x => …)` / `lista.forEach(function (x) …)`.
  for (const m of code.matchAll(/(\w+)\.(?:map|forEach)\(\s*(?:function\s*)?\(?\s*(\w+)/g)) {
    const [, list, item] = m;
    const sel = list ? out.get(list) : undefined;
    if (sel && item) out.set(item, sel);
  }
  return out;
}

/** Corpos das funções declaradas (`function nome() {…}`), para seguir chamadas simples. */
function functions(code: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of code.matchAll(/function\s+(\w+)\s*\([^)]*\)\s*\{/g)) {
    if (m[1] && m.index !== undefined) out.set(m[1], blockAt(code, m.index + m[0].length - 1));
  }
  return out;
}

/** Corpo com as funções chamadas lá dentro (um nível), para reconhecer o que o clique faz. */
function expand(body: string, fns: Map<string, string>): string {
  let out = body;
  for (const m of body.matchAll(/\b(\w+)\s*\(\s*\)/g)) {
    const fn = m[1] ? fns.get(m[1]) : undefined;
    if (fn) out += `\n${fn}`;
  }
  return out;
}

function selectorOfReceiver(receiver: string, binds: Map<string, string>): string | null {
  const r = receiver.trim();
  if (r === 'document' || r === 'window' || r === 'document.body' || r === 'document.documentElement') return r;
  const direct = binds.get(r);
  if (direct) return direct;
  const q = new RegExp(`document(?:\\.body)?\\.(querySelector|getElementById)\\(\\s*${STR}\\s*\\)$`).exec(r);
  if (q?.[1] && q[2]) return q[1] === 'getElementById' ? `#${q[2]}` : q[2];
  return null;
}

export function licenseNotices(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/\/\*!?([\s\S]*?)\*\//g)) {
    const text = (m[1] ?? '').trim();
    if (/licen[cs]e|copyright|\(c\)|©/i.test(text)) out.push(text.replace(/^\s*\*\s?/gm, '').trim());
  }
  return out;
}

/** Analisa um script (sem o executar). `origin` é o nome do ficheiro, para o relatório. */
export function analyzeScript(code: string, origin: string): ScriptAnalysis {
  const binds = bindings(code);
  const fns = functions(code);
  const behaviours: Behaviour[] = [];
  const listeners: ListenerFinding[] = [];

  const re = /([\w.$]+(?:\([^()]*\))?)\.addEventListener\(\s*['"`](\w+)['"`]\s*,\s*(?:\(?[\w\s,]*\)?\s*=>|function\s*\w*\s*\([^)]*\))\s*\{/g;
  for (const m of code.matchAll(re)) {
    const [whole, receiver = '', event = ''] = m;
    if (m.index === undefined) continue;
    const body = blockAt(code, m.index + whole.length - 1);
    const selector = selectorOfReceiver(receiver, binds);
    if (event === 'DOMContentLoaded' || event === 'load') {
      listeners.push({ event, selector, recognized: true, detail: 'arranque do script (o conteúdo é analisado à parte)' });
      continue;
    }
    if (event === 'click' && selector) {
      const all = expand(body, fns);
      const toggles = [...all.matchAll(/(\w+)\.classList\.toggle\(\s*['"`]([\w-]+)['"`]\s*\)/g)];
      const swapRemove = /classList\.remove\(\s*['"`]([\w-]+)['"`]\s*\)\s*;?\s*[\w.]*classList\.add\(\s*['"`]([\w-]+)['"`]\s*\)/.exec(all);
      let target: { sel: string; cls: string } | null = null;
      let selfClass: string | undefined;
      for (const t of toggles) {
        const [, who = '', cls = ''] = t;
        const sel = binds.get(who);
        if (!sel) continue;
        if (sel === selector) selfClass = cls;
        else target ??= { sel, cls };
      }
      if (target) {
        const swap: [string, string] | undefined = swapRemove?.[1] && swapRemove[2] ? [swapRemove[1], swapRemove[2]] : undefined;
        behaviours.push({ kind: 'toggle', trigger: selector, target: target.sel, targetClass: target.cls, ...(selfClass ? { selfClass } : {}), ...(swap ? { swap } : {}), origin });
        listeners.push({ event, selector, recognized: true, detail: `alterna a classe «${target.cls}» em ${target.sel}` });
        continue;
      }
      const removes = [...body.matchAll(/(\w+)\.classList\.remove\(\s*['"`]([\w-]+)['"`]\s*\)/g)];
      if (removes.length) {
        const byClass = new Map<string, string[]>();
        for (const x of removes) {
          const who = binds.get(x[1] ?? '') ?? x[1] ?? '?';
          const list = byClass.get(x[2] ?? '') ?? [];
          if (!list.includes(who)) list.push(who);
          byClass.set(x[2] ?? '', list);
        }
        const what = [...byClass].map(([cls, who]) => `a classe «${cls}» de ${who.join(' e ')}`);
        listeners.push({ event, selector, recognized: false, detail: `retira ${what.join('; ')}` });
        continue;
      }
    }
    if (event === 'scroll') {
      const threshold = /scroll(?:Top|Y)\s*>\s*(\d+)/.exec(body);
      const q = new RegExp(`querySelector\\(\\s*${STR}\\s*\\)`).exec(body);
      const targetSel = q?.[1] ?? null;
      if (threshold?.[1] && targetSel) {
        const effect = /fadeIn|fadeOut|opacity/.test(expand(body, fns)) ? 'fade' : 'none';
        behaviours.push({ kind: 'show-after', target: targetSel, threshold: Number(threshold[1]), effect, origin });
        listeners.push({ event, selector: targetSel, recognized: true, detail: `mostra ${targetSel} depois de rolar ${threshold[1]} px` });
        continue;
      }
    }
    listeners.push({ event, selector, recognized: false, detail: 'comportamento não reconhecido' });
  }
  return { behaviours, listeners, notices: licenseNotices(code) };
}

/** Componentes do Bootstrap ativados por atributos `data-bs-*` (sem JavaScript importado). */
export interface BootstrapUse {
  kind: string;
  count: number;
}

export function bootstrapUses(doc: Document): BootstrapUse[] {
  const counts = new Map<string, number>();
  for (const el of doc.querySelectorAll('[data-bs-toggle], [data-toggle], [data-bs-spy], [data-bs-ride]')) {
    const kind = el.getAttribute('data-bs-toggle') ?? el.getAttribute('data-toggle') ?? (el.hasAttribute('data-bs-spy') ? 'scrollspy' : 'carousel');
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()].map(([kind, count]) => ({ kind, count }));
}

/** Escreve os comportamentos nos elementos da página. Devolve quantos elementos ficaram ligados. */
export function applyBehaviour(doc: Document, b: Behaviour): number {
  const pick = (sel: string): Element[] => {
    try {
      return [...doc.querySelectorAll(sel)];
    } catch {
      return [];
    }
  };
  if (b.kind === 'toggle') {
    const triggers = pick(b.trigger);
    if (pick(b.target).length === 0) return 0;
    for (const el of triggers) {
      el.setAttribute('data-bolt-toggle', b.target);
      el.setAttribute('data-bolt-toggle-class', b.targetClass);
      if (b.selfClass) el.setAttribute('data-bolt-toggle-self', b.selfClass);
      if (b.swap) el.setAttribute('data-bolt-toggle-swap', b.swap.join(' '));
      el.setAttribute('aria-expanded', 'false');
    }
    return triggers.length;
  }
  const targets = pick(b.target);
  for (const el of targets) {
    el.setAttribute('data-bolt-show-after', String(b.threshold));
    if (b.effect === 'fade') el.setAttribute('data-bolt-show-effect', 'fade');
  }
  return targets.length;
}

/** Colapsos do Bootstrap (`data-bs-toggle="collapse"`) passam a alternar a classe «show» pelo runtime. */
export function convertBootstrapCollapse(doc: Document): number {
  let n = 0;
  for (const el of doc.querySelectorAll('[data-bs-toggle="collapse"], [data-toggle="collapse"]')) {
    const target = el.getAttribute('data-bs-target') ?? el.getAttribute('data-target') ?? (el.getAttribute('href')?.startsWith('#') ? el.getAttribute('href') : null);
    if (!target) continue;
    el.setAttribute('data-bolt-toggle', target);
    el.setAttribute('data-bolt-toggle-class', 'show');
    el.setAttribute('aria-expanded', 'false');
    n += 1;
  }
  return n;
}
