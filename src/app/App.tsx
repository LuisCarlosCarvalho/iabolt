import { lazy, Suspense } from 'react';
import { LoginPage } from '../auth/LoginPage';
import { DashboardPage } from '../dashboard/DashboardPage';
import { EditorPage } from '../editor/EditorPage';
import { ImportPage } from '../importers/ImportPage';
import { TemplatesPage } from '../library/TemplatesPage';
import { AppShell } from './AppShell';
import { Link, useRoute } from './router';
import { getSupabaseClient, LocalServicesProvider, readSupabaseConfig, ServerServicesProvider, useSupabaseSession, type SupabaseConfig } from './services';
import { Button, Spinner, StatePanel } from './ui';

// A prova técnica da Fase 0 continua disponível para diagnóstico, fora da navegação.
const PocApp = lazy(() => import('../poc/PocApp').then((m) => ({ default: m.PocApp })));

function Routes() {
  const route = useRoute();
  switch (route.name) {
    case 'dashboard':
      return (
        <AppShell>
          <DashboardPage />
        </AppShell>
      );
    case 'templates':
      return (
        <AppShell>
          <TemplatesPage />
        </AppShell>
      );
    case 'import':
      return (
        <AppShell>
          <ImportPage />
        </AppShell>
      );
    case 'editor':
      // `key`: mudar de projeto monta um editor novo, sem estado herdado.
      return <EditorPage key={route.projectId} projectId={route.projectId} />;
    case 'poc':
      return (
        <Suspense fallback={<div className="center-fill"><Spinner /></div>}>
          <PocApp />
        </Suspense>
      );
    case 'not-found':
      return (
        <AppShell>
          <main className="page">
            <StatePanel title="Página não encontrada" actions={<Link to="/" className="btn btn-primary">Ir para os projetos</Link>}>
              O endereço {route.path} não existe no Bolt IA.
            </StatePanel>
          </main>
        </AppShell>
      );
  }
}

function ServerApp({ config }: { config: SupabaseConfig }) {
  const client = getSupabaseClient(config);
  const session = useSupabaseSession(client);
  if (session.status === 'loading') return <div className="center-fill"><Spinner label="A verificar a sessão…" /></div>;
  if (session.status === 'error')
    return (
      <main className="page">
        <StatePanel title="Não foi possível contactar o servidor" actions={<Button onClick={() => window.location.reload()}>Tentar de novo</Button>}>
          {session.message}
        </StatePanel>
      </main>
    );
  if (session.status === 'signed-out') return <LoginPage client={client} />;
  return (
    <ServerServicesProvider client={client} session={session.session}>
      <Routes />
    </ServerServicesProvider>
  );
}

export function App() {
  const config = readSupabaseConfig();
  if (config) return <ServerApp config={config} />;
  return (
    <LocalServicesProvider>
      <Routes />
    </LocalServicesProvider>
  );
}
