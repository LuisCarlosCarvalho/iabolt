import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { GrapesProjectData } from '../../src/contract/boltDocument';
import { IndexedDbRepository } from '../../src/persistence/indexedDbRepository';
import { ProjectNotFoundError } from '../../src/persistence/repository';
import { SaveQueue } from '../../src/persistence/saveQueue';

const data = (text: string): GrapesProjectData => ({
  pages: [{ frames: [{ component: { type: 'wrapper', attributes: { id: 'root' }, components: [{ type: 'text', attributes: { id: 't' }, content: text }] } }] }],
});

/** Cada teste tem uma base IndexedDB nova (equivalente a um browser limpo). */
const repo = () => new IndexedDbRepository('test', new IDBFactory());

describe('Persistência local · IndexedDB', () => {
  it('lista vazia até criar; criar é idempotente e guarda nome e template', async () => {
    const r = repo();
    expect(await r.list()).toEqual([]);
    const a = await r.create('k1', data('a'), { name: '  Campanha   Outono ', templateId: 'nimbus-lancamento' });
    const b = await r.create('k1', data('a'), { name: 'outro', templateId: null });
    expect(b.projectId).toBe(a.projectId);
    const list = await r.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: a.projectId, name: 'Campanha Outono', templateId: 'nimbus-lancamento', revision: 0 });
  });

  it('gravar exige a revisão atual e não sobrescreve em conflito', async () => {
    const r = repo();
    const { projectId } = await r.create('k', data('v0'));
    expect(await r.save(projectId, 0, data('v1'))).toEqual({ status: 'saved', revision: 1 });
    expect(await r.save(projectId, 0, data('atrasada'))).toEqual({ status: 'conflict', serverRevision: 1 });
    expect(JSON.stringify((await r.load(projectId)).projectData)).toContain('v1');
    expect((await r.summary(projectId)).revision).toBe(1);
  });

  it('a lista vem da mais recente para a mais antiga e mudar o nome atualiza', async () => {
    const r = repo();
    const a = await r.create('a', data('a'), { name: 'A', templateId: null });
    await new Promise((res) => setTimeout(res, 5));
    const b = await r.create('b', data('b'), { name: 'B', templateId: null });
    expect((await r.list()).map((p) => p.id)).toEqual([b.projectId, a.projectId]);
    await new Promise((res) => setTimeout(res, 5));
    await r.save(a.projectId, 0, data('a1'));
    expect((await r.list()).map((p) => p.id)).toEqual([a.projectId, b.projectId]);
    await r.rename(b.projectId, 'Novo nome');
    expect((await r.summary(b.projectId)).name).toBe('Novo nome');
  });

  it('arquivar retira da lista e o projeto deixa de abrir', async () => {
    const r = repo();
    const { projectId } = await r.create('k', data('x'));
    await r.archive(projectId);
    expect(await r.list()).toEqual([]);
    await expect(r.load(projectId)).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(r.save(projectId, 0, data('y'))).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('documento inválido é recusado sem alterar o guardado', async () => {
    const r = repo();
    const { projectId } = await r.create('k', data('ok'));
    const broken: GrapesProjectData = { pages: [{ frames: [{ component: { type: 'wrapper', components: [] } }] }] };
    await expect(r.save(projectId, 0, broken)).rejects.toThrow(/sem id estável/);
    expect((await r.load(projectId)).revision).toBe(0);
  });

  it('a SaveQueue só marca «guardado» depois da revisão persistida no IndexedDB', async () => {
    const r = repo();
    const { projectId } = await r.create('k', data('v0'));
    const states: string[] = [];
    const q = new SaveQueue({ repository: r, projectId, loadedRevision: 0, snapshot: () => data('v1'), onState: (s) => states.push(s) });
    q.markDirty();
    await q.flush();
    expect(states).toEqual(['dirty', 'saving', 'saved']);
    expect((await r.load(projectId)).revision).toBe(1);
  });
});
