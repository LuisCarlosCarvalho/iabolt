import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { AssetUrlMap, collectAssetRefs } from '../../src/assets/assetRefs';
import type { AssetStore } from '../../src/assets/assetStore';
import { resolveForDisplay } from '../../src/assets/resolveForDisplay';
import type { GrapesProjectData } from '../../src/contract/boltDocument';
import { IndexedDbRepository } from '../../src/persistence/indexedDbRepository';
import { buildBackup, copyProjects } from '../../src/persistence/localProjects';
import { MemoryRepository } from '../../src/persistence/repository';

const REF = 'bolt-asset:ws-1/proj-1/foto.webp';
const SIGNED = 'https://exemplo.supabase.co/storage/v1/object/sign/project-assets/ws-1/proj-1/foto.webp?token=abc';

const withImage = (src: string): GrapesProjectData => ({
  pages: [
    {
      frames: [
        {
          component: {
            type: 'wrapper',
            attributes: { id: 'root' },
            components: [{ type: 'image', src, attributes: { id: 'img', src } }],
          },
        },
      ],
    },
  ],
});

const fakeStore = (urls: Record<string, string>): AssetStore => ({
  mode: 'server',
  upload: async () => {
    throw new Error('não usado');
  },
  resolve: async (refs) => new Map(refs.filter((r) => urls[r]).map((r) => [r, urls[r] ?? ''])),
});

describe('Imagens privadas · referências estáveis', () => {
  it('o documento para mostrar usa o URL assinado e o documento para gravar volta à referência', async () => {
    const stored = withImage(REF);
    expect(collectAssetRefs(stored)).toEqual([REF]);
    const { data, urls } = await resolveForDisplay(fakeStore({ [REF]: SIGNED }), stored);
    expect(JSON.stringify(data)).toContain(SIGNED);
    expect(JSON.stringify(data)).not.toContain(REF);
    const back = urls.forStorage(data);
    expect(back).toEqual(stored);
    expect(JSON.stringify(back)).not.toContain('token=');
  });

  it('uma imagem nova registada durante a edição é gravada como referência', () => {
    const urls = new AssetUrlMap();
    urls.register(REF, SIGNED);
    expect(urls.forStorage(withImage(SIGNED))).toEqual(withImage(REF));
  });

  it('referências sem acesso ficam como estão (imagem em falta, nunca dados de outro projeto)', async () => {
    const { data } = await resolveForDisplay(fakeStore({}), withImage(REF));
    expect(data).toEqual(withImage(REF));
  });

  it('modo local: data URLs e endereços externos não são tocados', async () => {
    const local = withImage('data:image/png;base64,AAAA');
    const { data, urls } = await resolveForDisplay(fakeStore({}), local);
    expect(data).toBe(local);
    expect(urls.forStorage(local)).toBe(local);
  });
});

const doc = (text: string): GrapesProjectData => ({
  pages: [{ frames: [{ component: { type: 'wrapper', attributes: { id: 'root' }, components: [{ type: 'text', attributes: { id: 't' }, content: text }] } }] }],
});

describe('Projetos do modo local ao ativar o servidor', () => {
  it('cópia de segurança contém todos os projetos, com metadados e documento completo', async () => {
    const local = new IndexedDbRepository('test', new IDBFactory());
    await local.create('00000000-0000-4000-8000-000000000001', doc('um'), { name: 'Um', templateId: 'nimbus-lancamento' });
    await local.create('00000000-0000-4000-8000-000000000002', doc('dois'), { name: 'Dois', templateId: null });
    const backup = await buildBackup(local);
    expect(backup.format).toBe('bolt-ia-backup');
    expect(backup.projects.map((p) => p.summary.name).sort()).toEqual(['Dois', 'Um']);
    expect(JSON.stringify(backup)).toContain('"um"');
  });

  it('copiar para a conta é idempotente e não altera nem apaga os projetos locais', async () => {
    const local = new IndexedDbRepository('test', new IDBFactory());
    const a = await local.create('k-a', doc('texto A'), { name: 'Projeto A', templateId: 'nimbus-lancamento' });
    await local.save(a.projectId, 0, doc('texto A editado'));
    const before = JSON.stringify(await buildBackup(local));

    const server = new MemoryRepository('test');
    const first = await copyProjects(local, server);
    const second = await copyProjects(local, server);
    expect(first).toHaveLength(1);
    expect(first[0]?.error).toBeUndefined();
    expect(second[0]?.serverId).toBe(first[0]?.serverId);
    const serverList = await server.list();
    expect(serverList).toHaveLength(1);
    expect(serverList[0]).toMatchObject({ name: 'Projeto A', templateId: 'nimbus-lancamento' });
    expect(JSON.stringify((await server.load(serverList[0]?.id ?? '')).projectData)).toContain('texto A editado');

    const after = await buildBackup(local);
    expect(JSON.stringify({ ...after, exportedAt: '' })).toBe(JSON.stringify({ ...JSON.parse(before), exportedAt: '' }));
  });

  it('uma falha a copiar um projeto é reportada sem interromper os outros', async () => {
    const local = new IndexedDbRepository('test', new IDBFactory());
    await local.create('k1', doc('1'), { name: 'Bom', templateId: null });
    await local.create('k2', doc('2'), { name: 'Mau', templateId: null });
    const server = new MemoryRepository('test');
    const failing = {
      ...server,
      mode: server.mode,
      list: server.list.bind(server),
      load: server.load.bind(server),
      save: server.save.bind(server),
      summary: server.summary.bind(server),
      rename: server.rename.bind(server),
      archive: server.archive.bind(server),
      create: async (key: string, data: GrapesProjectData, meta?: { name: string; templateId: string | null }) => {
        if (meta?.name === 'Mau') throw new Error('rede indisponível');
        return server.create(key, data, meta);
      },
    };
    const res = await copyProjects(local, failing);
    expect(res.find((r) => r.name === 'Bom')?.serverId).toBeDefined();
    expect(res.find((r) => r.name === 'Mau')?.error).toBe('rede indisponível');
  });
});
