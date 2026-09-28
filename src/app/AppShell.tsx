import { Cloud, HardDrive, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useRoute } from './router';
import { useServices } from './services';
import { useThemePreference, type ThemePreference } from './theme';
import { IconButton } from './ui';

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <img src="/assets/brand/bolt-ia-logo.png" alt="" width={350} height={283} />
    </span>
  );
}

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: ReactNode }> = [
  { value: 'light', label: 'Claro', icon: <Sun /> },
  { value: 'dark', label: 'Escuro', icon: <Moon /> },
  { value: 'system', label: 'Automático (segue o sistema)', icon: <Monitor /> },
];

/** Seletor do tema da interface (grupo de opções: setas mudam, Tab entra e sai). */
export function ThemeSwitcher() {
  const [pref, setPref] = useThemePreference();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent, index: number) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + THEME_OPTIONS.length) % THEME_OPTIONS.length;
    const option = THEME_OPTIONS[next];
    if (!option) return;
    setPref(option.value);
    refs.current[next]?.focus();
  };
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Tema da interface" data-testid="theme-switch">
      {THEME_OPTIONS.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={pref === o.value}
          aria-label={o.label}
          title={o.label}
          tabIndex={pref === o.value ? 0 : -1}
          className="theme-switch-option"
          data-value={o.value}
          onClick={() => setPref(o.value)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

/** Indica onde os dados ficam guardados. Em modo local nunca diz «servidor». */
export function ModeBadge({ compact = false }: { compact?: boolean }) {
  const { mode } = useServices();
  // Compacto (editor): o estado de gravação ao lado já diz onde se guarda; aqui fica só o ícone,
  // com a mesma informação na legenda e para leitores de ecrã.
  const server = mode === 'server';
  const label = server ? 'Guardado no servidor' : 'Modo local · só neste browser';
  const title = server ? 'Os projetos são guardados na base de dados do Bolt IA.' : 'Servidor não configurado: os projetos ficam só neste browser.';
  return (
    <span className={`mode-badge ${server ? 'mode-server' : 'mode-local'} ${compact ? 'is-compact' : ''}`} title={compact ? `${label}. ${title}` : title} role={compact ? 'img' : undefined} aria-label={compact ? label : undefined} data-testid="mode-badge">
      {server ? <Cloud aria-hidden="true" /> : <HardDrive aria-hidden="true" />}
      {!compact && <span>{label}</span>}
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const route = useRoute();
  const { auth } = useServices();
  return (
    <div className="shell">
      <header className="shell-head">
        <Link to="/" className="brand">
          <BrandMark />
          Bolt IA
        </Link>
        <nav className="shell-nav" aria-label="Principal">
          <Link to="/" aria-current={route.name === 'dashboard' ? 'page' : undefined}>
            Projetos
          </Link>
          <Link to="/templates" aria-current={route.name === 'templates' ? 'page' : undefined}>
            Templates
          </Link>
        </nav>
        <div className="shell-spacer" />
        <ModeBadge />
        <ThemeSwitcher />
        {auth && (
          <div className="shell-user">
            <span>{auth.email}</span>
            <IconButton label="Terminar sessão" onClick={() => void auth.client.auth.signOut()}>
              <LogOut />
            </IconButton>
          </div>
        )}
      </header>
      {children}
    </div>
  );
}
