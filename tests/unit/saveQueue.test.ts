import { describe, expect, it } from 'vitest';
import { MemoryRepository, type ProjectRepository } from '../../src/persistence/repository';
import { SaveQueue, type SaveState } from '../../src/persistence/saveQueue';
import type { GrapesProjectData } from '../../src/contract/boltDocument';

const data = (text: string): GrapesProjectData => ({
  pages: [{ frames: [{ component: { type: 'wrapper', attributes: { id: 'root' }, components: [{ type: 'text', attributes: { id: 't' }, content: text }] } }] }],
});

describe('Persistência · repositório', () => {
  it('criar é idempotente pela chave', async () => {
    const repo = new MemoryRepository('test');
    const a = await repo.create('k1', data('a'));
    const b = await repo.create('k1', data('a'));
    expect(b.projectId).toBe(a.projectId);
  });

  it('uma gravação com revisão antiga devolve conflito e não sobrescreve', async () => {
    const repo = new MemoryRepository('test');
    const { projectId } = await repo.create('k', data('v0'));
    expect(await repo.save(projectId, 0, data('v1'))).toEqual({ status: 'saved', revision: 1 });
    expect(await repo.save(projectId, 0, data('atrasada'))).toEqual({ status: 'conflict', serverRevision: 1 });
    const loaded = await repo.load(projectId);
    expect(JSON.stringify(loaded.projectData)).toContain('v1');
  });
});

describe('Persistência · SaveQueue', () => {
  it('«saved» só aparece depois da confirmação, com a revisão devolvida', async () => {
    const repo = new MemoryRepository('test');
    const { projectId } = await repo.create('k', data('v0'));
    const states: SaveState[] = [];
    const q = new SaveQueue({ repository: repo, projectId, loadedRevision: 0, snapshot: () => data('v1'), onState: (s) => states.push(s) });
    q.markDirty();
    await q.flush();
    expect(states).toEqual(['dirty', 'saving', 'saved']);
    expect(q.currentRevision).toBe(1);
  });

  it('falha de rede preserva o estado para repetir, e a repetição grava', async () => {
    const repo = new MemoryRepository('test');
    const { projectId } = await repo.create('k', data('v0'));
    let fail = true;
    const flaky: ProjectRepository = {
      create: repo.create.bind(repo),
      load: repo.load.bind(repo),
      save: async (...args) => {
        if (fail) throw new Error('rede indisponível');
        return repo.save(...args);
      },
    };
    const q = new SaveQueue({ repository: flaky, projectId, loadedRevision: 0, snapshot: () => data('v1') });
    await q.flush();
    expect(q.currentState).toBe('error');
    expect(q.currentRevision).toBe(0);
    fail = false;
    await q.flush();
    expect(q.currentState).toBe('saved');
    expect(q.currentRevision).toBe(1);
  });

  it('pedidos são serializados: alterações durante a gravação geram uma segunda gravação', async () => {
    const repo = new MemoryRepository('test');
    const { projectId } = await repo.create('k', data('v0'));
    let n = 0;
    const q = new SaveQueue({ repository: repo, projectId, loadedRevision: 0, snapshot: () => data(`v${++n}`) });
    const p1 = q.flush();
    q.markDirty();
    const p2 = q.flush();
    await Promise.all([p1, p2]);
    expect(q.currentRevision).toBe(2);
    expect(JSON.stringify((await repo.load(projectId)).projectData)).toContain('v2');
  });

  it('outro separador com revisão desatualizada entra em conflito sem sobrescrever', async () => {
    const repo = new MemoryRepository('test');
    const { projectId } = await repo.create('k', data('v0'));
    const tabA = new SaveQueue({ repository: repo, projectId, loadedRevision: 0, snapshot: () => data('A') });
    const tabB = new SaveQueue({ repository: repo, projectId, loadedRevision: 0, snapshot: () => data('B') });
    await tabA.flush();
    await tabB.flush();
    expect(tabB.currentState).toBe('conflict');
    expect(JSON.stringify((await repo.load(projectId)).projectData)).toContain('"A"');
  });

  it('respostas depois de dispose (navegação) não alteram o estado', async () => {
    const repo = new MemoryRepository('test');
    const { projectId } = await repo.create('k', data('v0'));
    const states: SaveState[] = [];
    const q = new SaveQueue({ repository: repo, projectId, loadedRevision: 0, snapshot: () => data('v1'), onState: (s) => states.push(s) });
    const p = q.flush();
    q.dispose();
    await p;
    expect(states).toEqual(['saving']);
  });
});
