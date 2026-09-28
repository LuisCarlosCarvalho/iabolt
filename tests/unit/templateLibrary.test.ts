import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { GrapesProjectData } from '../../src/contract/boltDocument';
import { IndexedDbTemplateLibrary, parseTeamTemplateRef, teamTemplateRef, TemplateNotFoundError } from '../../src/library/templateLibrary';
import { IndexedDbRepository } from '../../src/persistence/indexedDbRepository';
import { emptyTotals, type ImportReport } from '../../src/importers/types';

const data = (text: string): GrapesProjectData => ({
  pages: [{ frames: [{ component: { type: 'wrapper', attributes: { id: 'root' }, components: [{ type: 'text', attributes: { id: 't' }, content: text }] } }] }],
});
const textOf = (d: GrapesProjectData) => JSON.stringify(d);

describe('Biblioteca de templates · local (IndexedDB)', () => {
  it('guardar como template cria a versão 1; guardar de novo acrescenta versões sem mudar as anteriores', async () => {
    const lib = new IndexedDbTemplateLibrary(new IDBFactory());
    expect(await lib.list()).toEqual([]);
    const t = await lib.create('k1', { name: '  Loja  ', description: 'd', sourceProjectId: 'p1', projectData: data('v1') });
    expect(await lib.create('k1', { name: 'outra', description: '', sourceProjectId: null, projectData: data('x') })).toEqual(t);
    expect(t).toMatchObject({ name: 'Loja', currentVersion: 1, sourceProjectId: 'p1' });
    expect(await lib.addVersion(t.id, 1, data('v2'), 'nova cor', 'p1')).toEqual({ status: 'saved', version: 2 });
    expect(await lib.addVersion(t.id, 1, data('atrasada'), '', null)).toEqual({ status: 'conflict', currentVersion: 2 });
    expect((await lib.versions(t.id)).map((v) => [v.version, v.note])).toEqual([[2, 'nova cor'], [1, '']]);
    expect(textOf((await lib.loadVersion(t.id, 1)).projectData)).toContain('v1');
    expect(textOf((await lib.loadVersion(t.id)).projectData)).toContain('v2');
  });

  it('o documento devolvido é uma cópia: alterá-lo não altera o template', async () => {
    const lib = new IndexedDbTemplateLibrary(new IDBFactory());
    const source = data('original');
    const t = await lib.create('k', { name: 'T', description: '', sourceProjectId: null, projectData: source });
    const text = source.pages[0]?.frames[0]?.component.components?.[0];
    if (text) text.content = 'mudado na origem';
    const copy = await lib.loadVersion(t.id);
    const node = copy.projectData.pages[0]?.frames[0]?.component.components?.[0];
    if (node) node.content = 'mudado na cópia';
    expect(textOf((await lib.loadVersion(t.id)).projectData)).toContain('original');
  });

  it('arquivar retira da lista; renomear atualiza', async () => {
    const lib = new IndexedDbTemplateLibrary(new IDBFactory());
    const t = await lib.create('k', { name: 'A', description: '', sourceProjectId: null, projectData: data('a') });
    await lib.rename(t.id, 'B');
    expect((await lib.get(t.id)).name).toBe('B');
    await lib.archive(t.id);
    expect(await lib.list()).toEqual([]);
    await expect(lib.get(t.id)).rejects.toBeInstanceOf(TemplateNotFoundError);
    await expect(lib.addVersion(t.id, 1, data('x'), '', null)).rejects.toBeInstanceOf(TemplateNotFoundError);
  });

  it('documento inválido é recusado', async () => {
    const lib = new IndexedDbTemplateLibrary(new IDBFactory());
    await expect(lib.create('k', { name: 'x', description: '', sourceProjectId: null, projectData: { pages: [] } })).rejects.toThrow();
  });

  it('regista importações com o original para recuperação', async () => {
    const lib = new IndexedDbTemplateLibrary(new IDBFactory());
    const report: ImportReport = { format: 'elementor', formatLabel: 'Elementor', fileName: 'a.json', fileSize: 3, items: [], assets: [], fonts: [], notes: [], removed: [], totals: emptyTotals() };
    await lib.record({ projectId: 'p1', format: 'elementor', fileName: 'a.json', fileSize: 3, originalText: '{}', report });
    const recs = await lib.forProject('p1');
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ originalText: '{}', fileName: 'a.json' });
    expect(await lib.forProject('p2')).toEqual([]);
  });

  it('atualizar a base local para a v2 mantém os projetos já guardados (v1)', async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const open = factory.open('bolt-ia', 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore('projects', { keyPath: 'id' });
        open.result.createObjectStore('idempotency', { keyPath: 'key' });
      };
      open.onerror = () => reject(open.error ?? new Error('open'));
      open.onsuccess = () => {
        const doc = { boltSchemaVersion: 1, engine: { name: 'grapesjs', version: 't' }, projectId: 'antigo', revision: 2, projectData: data('antes da v2') };
        const tx = open.result.transaction('projects', 'readwrite');
        tx.objectStore('projects').put({ id: 'antigo', name: 'Antigo', templateId: null, revision: 2, createdAt: 'x', updatedAt: 'x', archivedAt: null, document: JSON.stringify(doc) });
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
      };
    });
    const lib = new IndexedDbTemplateLibrary(factory);
    await lib.create('k', { name: 'T', description: '', sourceProjectId: null, projectData: data('t') });
    const repo = new IndexedDbRepository('t', factory);
    expect(textOf((await repo.load('antigo')).projectData)).toContain('antes da v2');
    expect(await lib.list()).toHaveLength(1);
  });

  it('referência ao template de origem num projeto', () => {
    expect(teamTemplateRef('abc', 3)).toBe('team:abc@3');
    expect(parseTeamTemplateRef('team:abc@3')).toEqual({ templateId: 'abc', version: 3 });
    expect(parseTeamTemplateRef('nimbus-lancamento')).toBeNull();
    expect(parseTeamTemplateRef(null)).toBeNull();
  });
});
