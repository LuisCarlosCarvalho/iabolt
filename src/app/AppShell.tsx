import { Cloud, HardDrive, LogOut, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useRoute } from './router';
import { useServices } from './services';
import { IconButton } from './ui';

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Zap />
    </span>
  );
}

/** Indica onde os dados ficam guardados. Em modo local nunca diz «servidor». */
export function ModeBadge() {
  const { mode } = useServices();
  return mode === 'server' ? (
    <span className="mode-badge mode-server" title="Os projetos são guardados na base de dados do Bolt IA.">
      <Cloud aria-hidden="true" />
      <span>Guardado no servidor</span>
    </span>
  ) : (
    <span className="mode-badge mode-local" title="Servidor não configurado: os projetos ficam só neste browser.">
      <HardDrive aria-hidden="true" />
      <span>Modo local · só neste browser</span>
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
