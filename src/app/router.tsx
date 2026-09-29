import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/** Router mínimo sobre a History API. Rotas: `/`, `/templates`, `/importar`, `/projetos/:id`, `/configuracoes/ia`, `/prova-tecnica`. */
export type Route =
  | { name: 'dashboard' }
  | { name: 'templates' }
  | { name: 'import' }
  | { name: 'editor'; projectId: string }
  | { name: 'poc' }
  | { name: 'ai-settings' }
  | { name: 'not-found'; path: string };

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener('popstate', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('popstate', cb);
  };
}

const getPath = () => window.location.pathname;

export function parseRoute(path: string): Route {
  const clean = path.replace(/\/+$/, '') || '/';
  if (clean === '/') return { name: 'dashboard' };
  if (clean === '/templates') return { name: 'templates' };
  if (clean === '/importar') return { name: 'import' };
  if (clean === '/prova-tecnica') return { name: 'poc' };
  if (clean === '/configuracoes/ia') return { name: 'ai-settings' };
  const m = /^\/projetos\/([^/]+)$/.exec(clean);
  if (m?.[1]) return { name: 'editor', projectId: decodeURIComponent(m[1]) };
  return { name: 'not-found', path };
}

export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, getPath));
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (to === window.location.pathname + window.location.search) return;
  if (opts.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  listeners.forEach((l) => l());
}

export const projectPath = (id: string) => `/projetos/${encodeURIComponent(id)}`;

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

export function Link({ to, onClick, ...rest }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}
