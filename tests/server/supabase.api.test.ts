import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetPath } from '../../src/assets/assetRefs';
import { ASSET_BUCKET, SupabaseAssetStore } from '../../src/assets/assetStore';
import type { GrapesProjectData } from '../../src/contract/boltDocument';
import { ProjectNotFoundError } from '../../src/persistence/repository';
import { SupabaseRepository } from '../../src/persistence/supabaseRepository';
import { cleanupProjects, newClient, signedIn } from './testAccounts';

/**
 * Validação contra o projeto Supabase REAL (Auth, PostgREST/RPC e Storage), com o código
 * de produção do Bolt IA. Executar com `npm run test:server` depois de configurar (docs/07).
 * Só usa as contas de teste A e B (`testAccounts.ts`). Cria projetos «[teste automático] …»
 * e, no fim, apaga as imagens deles e arquiva-os (só os ids que o próprio teste criou).
 */
const ENGINE = '0.23.6';
// PNG 1×1 válido.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

const page = (text: string, src?: string): GrapesProjectData => ({
  pages: [
    {
      frames: [
        {
          component: {
            type: 'wrapper',
            attributes: { id: 'root' },
            components: [
              { type: 'text', attributes: { id: 't' }, content: text },
              ...(src ? [{ type: 'image', src, attributes: { id: 'img', src } }] : []),
            ],
          },
        },
      ],
    },
  ],
});

let a: SupabaseClient;
let b: SupabaseClient;
let repoA: SupabaseRepository;
let repoB: SupabaseRepository;
let projectId = '';
let workspaceId = '';
let imageRef = '';
const createdIds: string[] = [];

beforeAll(async () => {
  a = await signedIn('A');
  b = await signedIn('B');
  repoA = new SupabaseRepository(a, ENGINE);
  repoB = new SupabaseRepository(b, ENGINE);
  const key = crypto.randomUUID();
  const created = await repoA.create(key, page('v0'), { name: '[teste automático] API', templateId: 'em-branco' });
  projectId = created.projectId;
  createdIds.push(projectId);
  workspaceId = (await repoA.summary(projectId)).workspaceId ?? '';
});

afterAll(async () => {
  await a?.auth.signOut();
  await b?.auth.signOut();
  const problems = await cleanupProjects('A', createdIds);
  if (problems.length > 0) console.warn(`Limpeza incompleta:\n${problems.join('\n')}`);
});

describe('Supabase real · conta A', () => {
  it('o projeto criado tem workspace, revisão 0 e aparece na lista', async () => {
    expect(workspaceId).toMatch(/^[0-9a-f-]{36}$/);
    const list = await repoA.list();
    expect(list.map((p) => p.id)).toContain(projectId);
    expect((await repoA.load(projectId)).revision).toBe(0);
  });

  it('criar com a mesma chave não duplica', async () => {
    const key = crypto.randomUUID();
    const first = await repoA.create(key, page('x'), { name: '[teste automático] idempotente', templateId: null });
    createdIds.push(first.projectId);
    const again = await repoA.create(key, page('x'), { name: '[teste automático] idempotente', templateId: null });
    expect(again.projectId).toBe(first.projectId);
  });

  it('gravar devolve a nova revisão; revisão antiga dá conflito sem sobrescrever', async () => {
    expect(await repoA.save(projectId, 0, page('v1'))).toEqual({ status: 'saved', revision: 1 });
    expect(await repoA.save(projectId, 0, page('atrasada'))).toEqual({ status: 'conflict', serverRevision: 1 });
    expect(JSON.stringify((await repoA.load(projectId)).projectData)).toContain('v1');
  });

  it('imagem: carrega para o bucket privado, grava a referência e continua acessível ao dono', async () => {
    const store = new SupabaseAssetStore(a);
    const uploaded = await store.upload(new File([PNG], 'teste.png', { type: 'image/png' }), { projectId, workspaceId });
    imageRef = uploaded.stored;
    expect(imageRef).toMatch(new RegExp(`^bolt-asset:${workspaceId}/${projectId}/`));
    expect(uploaded.display).toMatch(/^https:\/\/.+token=/);

    expect((await repoA.save(projectId, 1, page('com imagem', imageRef))).status).toBe('saved');
    const reloaded = await repoA.load(projectId);
    expect(JSON.stringify(reloaded.projectData)).toContain(imageRef);
    expect(JSON.stringify(reloaded.projectData)).not.toContain('token=');

    const fresh = (await store.resolve([imageRef])).get(imageRef);
    expect(fresh).toBeDefined();
    const res = await fetch(fresh ?? '');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^image\/png/);
  });

  it('o bucket é privado: o endereço público não serve a imagem', async () => {
    const publicUrl = a.storage.from(ASSET_BUCKET).getPublicUrl(assetPath(imageRef)).data.publicUrl;
    const res = await fetch(publicUrl);
    expect(res.status).not.toBe(200);
  });
});

describe('Supabase real · conta B não acede ao que é de A', () => {
  it('não vê o projeto na lista nem o consegue abrir', async () => {
    expect((await repoB.list()).map((p) => p.id)).not.toContain(projectId);
    await expect(repoB.load(projectId)).rejects.toBeInstanceOf(ProjectNotFoundError);
    const { data } = await b.from('project_revisions').select('revision').eq('project_id', projectId);
    expect(data ?? []).toHaveLength(0);
  });

  it('não grava, não muda o nome e não arquiva', async () => {
    await expect(repoB.save(projectId, 2, page('intruso'))).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(repoB.rename(projectId, 'intruso')).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(repoB.archive(projectId)).rejects.toBeInstanceOf(ProjectNotFoundError);
    const doc = await repoA.load(projectId);
    expect(doc.revision).toBe(2);
    expect(JSON.stringify(doc.projectData)).not.toContain('intruso');
    expect((await repoA.summary(projectId)).name).toBe('[teste automático] API');
  });

  it('não descarrega, não obtém URL assinado e não escreve na pasta de A', async () => {
    const path = assetPath(imageRef);
    const download = await b.storage.from(ASSET_BUCKET).download(path);
    expect(download.error).not.toBeNull();
    expect((await new SupabaseAssetStore(b).resolve([imageRef])).has(imageRef)).toBe(false);
    const upload = await b.storage.from(ASSET_BUCKET).upload(`${workspaceId}/${projectId}/intruso.png`, PNG, { contentType: 'image/png' });
    expect(upload.error).not.toBeNull();
    const remove = await b.storage.from(ASSET_BUCKET).remove([path]);
    expect(remove.data ?? []).toHaveLength(0);
    const stillThere = (await new SupabaseAssetStore(a).resolve([imageRef])).get(imageRef);
    expect(stillThere).toBeDefined();
  });
});

describe('Supabase real · sem sessão', () => {
  it('um cliente anónimo não lê projetos nem grava', async () => {
    const anon = newClient();
    const list = await anon.from('projects').select('id');
    expect(list.error !== null || (list.data ?? []).length === 0).toBe(true);
    const save = await anon.rpc('save_project', { p_project_id: projectId, p_base_revision: 2, p_project_data: page('anon') });
    expect(save.error).not.toBeNull();
    expect(JSON.stringify((await repoA.load(projectId)).projectData)).not.toContain('anon');
  });
});
