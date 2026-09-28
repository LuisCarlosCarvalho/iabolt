import type { GrapesProjectData } from '../contract/boltDocument';
import type { ProjectRepository } from './repository';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

export interface SaveQueueOptions {
  repository: ProjectRepository;
  projectId: string;
  /** Revisão carregada e validada. A fila só existe depois do carregamento. */
  loadedRevision: number;
  /** Lê o estado atual do motor no momento da gravação. */
  snapshot: () => GrapesProjectData;
  onState?: (state: SaveState, info?: { revision?: number; error?: string }) => void;
}

/**
 * Via única de gravação (manual e autosave). Um pedido de cada vez; alterações
 * feitas durante uma gravação provocam nova gravação a seguir.
 * «saved» só depois de o repositório devolver a revisão persistida.
 */
export class SaveQueue {
  private revision: number;
  private state: SaveState = 'saved';
  private inFlight: Promise<void> | null = null;
  private pendingAfterFlight = false;
  private disposed = false;

  constructor(private readonly opts: SaveQueueOptions) {
    this.revision = opts.loadedRevision;
  }

  get currentRevision(): number {
    return this.revision;
  }

  get currentState(): SaveState {
    return this.state;
  }

  markDirty(): void {
    if (this.disposed || this.state === 'conflict') return;
    if (this.state === 'saving') {
      this.pendingAfterFlight = true;
      return;
    }
    this.setState('dirty');
  }

  /** Grava agora (ou encadeia depois da gravação em curso). */
  flush(): Promise<void> {
    if (this.disposed || this.state === 'conflict') return Promise.resolve();
    if (this.inFlight) {
      this.pendingAfterFlight = true;
      return this.inFlight;
    }
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Ao navegar para outro projeto: respostas tardias deixam de ter efeito. */
  dispose(): void {
    this.disposed = true;
  }

  private async run(): Promise<void> {
    this.pendingAfterFlight = false;
    this.setState('saving');
    const data = this.opts.snapshot();
    try {
      const result = await this.opts.repository.save(this.opts.projectId, this.revision, data);
      if (this.disposed) return;
      if (result.status === 'conflict') {
        this.setState('conflict', { revision: result.serverRevision });
        return;
      }
      this.revision = result.revision;
      if (this.pendingAfterFlight) {
        this.setState('dirty');
        await this.run();
        return;
      }
      this.setState('saved', { revision: result.revision });
    } catch (e) {
      if (this.disposed) return;
      // Alterações continuam no motor; o estado permite repetir com segurança.
      this.setState('error', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  private setState(state: SaveState, info?: { revision?: number; error?: string }): void {
    this.state = state;
    this.opts.onState?.(state, info);
  }
}
