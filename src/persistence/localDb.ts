/**
 * Base de dados local (IndexedDB) partilhada pelo catálogo de projetos, pela biblioteca de
 * templates e pelo registo de importações. Uma única definição de versão e de lojas, para que
 * abrir por qualquer um deles faça a mesma atualização sem perder dados.
 *
 * v1: projects, idempotency. v2 (+): templates, templateVersions, imports.
 */
export const DB_NAME = 'bolt-ia';
export const DB_VERSION = 2;

export const STORES = {
  projects: 'projects',
  keys: 'idempotency',
  templates: 'templates',
  templateVersions: 'templateVersions',
  imports: 'imports',
} as const;

export function openBoltDb(factory: IDBFactory | undefined, name: string = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!factory) {
      reject(new Error('Este browser não permite guardar dados localmente (IndexedDB indisponível).'));
      return;
    }
    const open = factory.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      // Só cria o que falta: as lojas existentes (e os seus dados) ficam intactas.
      if (!db.objectStoreNames.contains(STORES.projects)) db.createObjectStore(STORES.projects, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.keys)) db.createObjectStore(STORES.keys, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORES.templates)) db.createObjectStore(STORES.templates, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.templateVersions)) db.createObjectStore(STORES.templateVersions, { keyPath: ['templateId', 'version'] });
      if (!db.objectStoreNames.contains(STORES.imports)) db.createObjectStore(STORES.imports, { keyPath: 'id' });
    };
    // Outro separador com a versão antiga aberta: pede-lhe para fechar em vez de bloquear.
    open.onblocked = () => reject(new Error('Feche os outros separadores do Bolt IA para atualizar a base de dados local.'));
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    open.onerror = () => reject(open.error ?? new Error('Não foi possível abrir a base de dados local.'));
  });
}

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Erro de IndexedDB'));
  });
}

export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Transação IndexedDB falhou'));
    tx.onabort = () => reject(tx.error ?? new Error('Transação IndexedDB cancelada'));
  });
}
