import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Contas e limpeza dos testes contra o Supabase real. Usado por `tests/server` e `tests/e2e-server`.
 *
 * - Só as contas BOLT_TEST_USER_A e BOLT_TEST_USER_B de `.env.local` são usadas.
 * - Salvaguardas: A e B têm de ser contas diferentes; contas `admin@…` são recusadas
 *   (os testes criam, editam e arquivam dados).
 * - A limpeza só toca nos projetos cujo id o próprio teste registou.
 */
export type Who = 'A' | 'B';

export const env = (name: string): string => {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Falta ${name} em .env.local (ver docs/07-configurar-supabase.md).`);
  return v;
};

export function account(who: Who): { email: string; password: string } {
  const email = env(`BOLT_TEST_USER_${who}_EMAIL`);
  const password = env(`BOLT_TEST_USER_${who}_PASSWORD`);
  const other = env(`BOLT_TEST_USER_${who === 'A' ? 'B' : 'A'}_EMAIL`);
  if (email.toLowerCase() === other.toLowerCase()) throw new Error('As contas de teste A e B têm de ser diferentes.');
  if (/^admin@/i.test(email)) throw new Error(`A conta de teste ${who} parece administrativa (admin@…). Use uma conta só de teste.`);
  return { email, password };
}

export const SUPABASE_URL = () => env('VITE_SUPABASE_URL');
export const SUPABASE_KEY = () => env('VITE_SUPABASE_ANON_KEY');
export const BUCKET = 'project-assets';

export const newClient = (): SupabaseClient => createClient(SUPABASE_URL(), SUPABASE_KEY(), { auth: { persistSession: false, autoRefreshToken: false } });

export async function signedIn(who: Who): Promise<SupabaseClient> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword(account(who));
  if (error) throw new Error(`Login da conta de teste ${who} falhou: ${error.message}`);
  return client;
}

/**
 * Remove as imagens da pasta de cada projeto indicado e arquiva o projeto (a base de dados
 * não permite apagar projetos: ficam arquivados com o histórico). Só ids criados pelo teste.
 */
export async function cleanupProjects(who: Who, projectIds: readonly string[]): Promise<string[]> {
  const problems: string[] = [];
  if (projectIds.length === 0) return problems;
  const client = await signedIn(who);
  try {
    for (const id of projectIds) {
      const { data, error } = await client.from('projects').select('workspace_id, name').eq('id', id).maybeSingle();
      if (error || !data) {
        problems.push(`${id}: não encontrado (${error?.message ?? 'sem acesso'})`);
        continue;
      }
      const row: { workspace_id: string; name: string } = data;
      if (!row.name.startsWith('[teste automático]')) {
        problems.push(`${id}: ignorado, não é um projeto de teste`);
        continue;
      }
      const folder = `${row.workspace_id}/${id}`;
      const listed = await client.storage.from(BUCKET).list(folder, { limit: 1000 });
      const files = (listed.data ?? []).map((f) => `${folder}/${f.name}`);
      if (files.length > 0) {
        const removed = await client.storage.from(BUCKET).remove(files);
        if (removed.error) problems.push(`${id}: imagens não removidas (${removed.error.message})`);
      }
      const archived = await client.from('projects').update({ archived_at: new Date().toISOString() }).eq('id', id).is('archived_at', null);
      if (archived.error) problems.push(`${id}: não arquivado (${archived.error.message})`);
    }
  } finally {
    await client.auth.signOut();
  }
  return problems;
}

export const projectIdFromUrl = (url: string): string => {
  const id = /\/projetos\/([0-9a-f-]{36})/.exec(url)?.[1];
  if (!id) throw new Error(`URL de projeto inesperado: ${url}`);
  return id;
};
