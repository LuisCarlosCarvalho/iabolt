import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * Tema da INTERFACE do Bolt IA (claro, escuro ou automático). Aplica-se só ao documento da
 * aplicação, pelo atributo `data-ui-theme` no <html>; o canvas, as pré-visualizações e as
 * miniaturas são documentos próprios (iframes) e não o herdam.
 * O index.html aplica o mesmo cálculo antes da primeira pintura, para não haver flash.
 */
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'bolt-ia:tema';
/** Sem preferência guardada: escuro, o padrão do design system. */
export const DEFAULT_THEME: ThemePreference = 'dark';

const isPreference = (v: unknown): v is ThemePreference => v === 'light' || v === 'dark' || v === 'system';

export function readPreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(saved) ? saved : DEFAULT_THEME;
  } catch {
    // Armazenamento bloqueado (ex.: modo privado restrito): usa o padrão.
    return DEFAULT_THEME;
  }
}

const systemQuery = () => (typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: light)') : null);

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'system') return systemQuery()?.matches ? 'light' : 'dark';
  return pref;
}

function apply(pref: ThemePreference): void {
  document.documentElement.setAttribute('data-ui-theme', resolveTheme(pref));
}

const listeners = new Set<() => void>();
let current: ThemePreference | null = null;

function getPreference(): ThemePreference {
  current ??= readPreference();
  return current;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Outro separador mudou o tema: acompanhar.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    current = readPreference();
    apply(current);
    listeners.forEach((l) => l());
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function setPreference(pref: ThemePreference): void {
  current = pref;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Sem armazenamento: o tema muda nesta sessão, sem persistir.
  }
  apply(pref);
  listeners.forEach((l) => l());
}

/** Preferência atual e função para a mudar. Em «Automático» segue o sistema em tempo real. */
export function useThemePreference(): [ThemePreference, (p: ThemePreference) => void] {
  const pref = useSyncExternalStore(subscribe, getPreference, () => DEFAULT_THEME);
  useEffect(() => {
    apply(pref);
    if (pref !== 'system') return;
    const mq = systemQuery();
    if (!mq) return;
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);
  const set = useCallback((p: ThemePreference) => setPreference(p), []);
  return [pref, set];
}
