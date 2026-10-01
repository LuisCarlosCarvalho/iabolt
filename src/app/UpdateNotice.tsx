import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './ui';

/**
 * Versão publicada mais recente: o build grava `version.json` com o identificador do build (ver
 * vite.config.ts). Um separador aberto com uma versão anterior mostra um aviso para recarregar;
 * nunca recarrega sozinho (o editor grava automaticamente; o aviso diz para esperar por isso).
 * Só em produção (no desenvolvimento não há `version.json`).
 */
const CHECK_MS = 5 * 60 * 1000;

async function latestBuild(): Promise<string | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const id = body && typeof body === 'object' ? Reflect.get(body, 'build') : null;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

export function UpdateNotice() {
  const [outdated, setOutdated] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let alive = true;
    const check = () =>
      void latestBuild().then((id) => {
        if (alive && id && id !== __BOLT_BUILD__) setOutdated(true);
      });
    check();
    const timer = window.setInterval(check, CHECK_MS);
    window.addEventListener('focus', check);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, []);
  if (!outdated) return null;
  return (
    <div className="update-notice" role="status" data-testid="update-notice">
      <span>Há uma versão nova do Bolt IA. Espere por «Alterações guardadas» e recarregue a página.</span>
      <Button variant="primary" onClick={() => window.location.reload()}>
        <RefreshCw aria-hidden="true" /> Recarregar
      </Button>
    </div>
  );
}
