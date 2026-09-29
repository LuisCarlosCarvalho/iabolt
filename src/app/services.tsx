import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LocalAiAdminClient, ServerAiAdminClient, type AiAdminClient } from '../admin/aiAdminClient';
import { LocalAssetStore, SupabaseAssetStore, type AssetStore } from '../assets/assetStore';
import { ENGINE_VERSION } from '../engine/createBoltEditor';
import { IndexedDbRepository } from '../persistence/indexedDbRepository';
import type { PersistenceMode, ProjectCatalog } from '../persistence/repository';
import { SupabaseRepository } from '../persistence/supabaseRepository';
import { SupabaseTemplateLibrary } from '../library/supabaseTemplateLibrary';
import { IndexedDbTemplateLibrary, type ImportLog, type TemplateLibrary } from '../library/templateLibrary';

/**
 * Escolha do destino de persistência. Há um único destino ativo por sessão:
 * - servidor (Supabase) quando VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY estão definidos;
 * - local (IndexedDB, só neste browser) quando não estão.
 * Nunca há recurso silencioso de um para o outro.
 */
export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function readSupabaseConfig(): SupabaseConfig | null {
  const url = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  return url && anonKey ? { url, anonKey } : null;
}

export interface AppServices {
  mode: PersistenceMode;
  catalog: ProjectCatalog;
  assets: AssetStore;
  /** Templates da equipa (mesmo destino que os projetos). */
  library: TemplateLibrary;
  imports: ImportLog;
  /** Só em modo servidor. */
  auth: { client: SupabaseClient; email: string } | null;
  /** Configurações de IA (função ai-admin) e estado público do assistente. */
  ai: AiAdminClient;
}

const ServicesContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('Serviços da aplicação indisponíveis');
  return s;
}

export function persistenceLabel(mode: PersistenceMode): string {
  return mode === 'server' ? 'no servidor' : 'neste browser';
}

let localServices: AppServices | null = null;
function getLocalServices(): AppServices {
  if (!localServices) {
    const library = new IndexedDbTemplateLibrary();
    localServices = { mode: 'local', catalog: new IndexedDbRepository(ENGINE_VERSION), assets: new LocalAssetStore(), library, imports: library, auth: null, ai: new LocalAiAdminClient() };
  }
  return localServices;
}

export function LocalServicesProvider({ children }: { children: ReactNode }) {
  return <ServicesContext.Provider value={getLocalServices()}>{children}</ServicesContext.Provider>;
}

export function ServerServicesProvider({ client, session, children }: { client: SupabaseClient; session: Session; children: ReactNode }) {
  // Instâncias estáveis: a renovação do token não deve recriar o repositório nem reabrir o editor.
  const catalog = useMemo(() => new SupabaseRepository(client, ENGINE_VERSION), [client]);
  const assets = useMemo(() => new SupabaseAssetStore(client), [client]);
  const library = useMemo(() => new SupabaseTemplateLibrary(client, ENGINE_VERSION), [client]);
  const ai = useMemo(() => new ServerAiAdminClient(client), [client]);
  const email = session.user.email ?? '';
  const value = useMemo<AppServices>(
    () => ({ mode: 'server', catalog, assets, library, imports: library, auth: { client, email }, ai }),
    [catalog, assets, library, client, email, ai],
  );
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

let supabaseClient: SupabaseClient | null = null;
export function getSupabaseClient(config: SupabaseConfig): SupabaseClient {
  supabaseClient ??= createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  return supabaseClient;
}

export type SessionState = { status: 'loading' } | { status: 'signed-out' } | { status: 'signed-in'; session: Session } | { status: 'error'; message: string };

export function useSupabaseSession(client: SupabaseClient): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setState({ status: 'error', message: error.message });
        else setState(data.session ? { status: 'signed-in', session: data.session } : { status: 'signed-out' });
      })
      .catch((e: unknown) => active && setState({ status: 'error', message: e instanceof Error ? e.message : String(e) }));
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (active) setState(session ? { status: 'signed-in', session } : { status: 'signed-out' });
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);
  return state;
}
