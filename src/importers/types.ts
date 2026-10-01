import type { ComponentJson } from './sanitize';

/** Formatos conhecidos. Só os marcados como disponíveis no registo são oferecidos na interface. */
export type ImportFormatId = 'grapesjs' | 'elementor' | 'bolt' | 'html' | 'zip' | 'unknown';

export type ItemStatus = 'preservado' | 'convertido' | 'parcial' | 'nao-suportado';

/** Linha do relatório: um tipo de origem com o que lhe aconteceu. */
export interface ReportItem {
  status: ItemStatus;
  /** Tipo na origem (ex.: `linkBox`, `widget:image-carousel`). */
  source: string;
  /** O que ficou no Bolt IA (ex.: «Bloco de ligação (<a>)»). */
  target: string;
  count: number;
  detail: string;
}

export type AssetStatus = 'pendente' | 'disponivel' | 'copiada' | 'externa' | 'em-falta' | 'rejeitada';

export interface AssetEntry {
  url: string;
  status: AssetStatus;
  /** Referência gravada no documento depois da cópia (`bolt-asset:` ou data URL). */
  stored?: string;
  reason?: string;
  /** Onde aparece (tipo de origem), para o relatório. */
  usedBy: string[];
  /** Caminho no arquivo importado (sites estáticos): é guardada sempre, porque não há endereço original. */
  local?: string;
}

/** Ficheiro referido por um site estático que não está no arquivo (ou que não pode ser usado). */
export interface MissingFile {
  /** Caminho resolvido no site (ou a referência, se sair da raiz). */
  path: string;
  /** Referência tal como está escrita. */
  ref: string;
  /** Ficheiros que a referem. */
  from: string[];
  kind: 'css' | 'imagem' | 'fonte' | 'script' | 'recurso';
  reason?: string;
}

/** Página importada de um site estático. */
export interface ImportedPage {
  path: string;
  slug: string;
  title: string;
  home: boolean;
}

export interface FontEntry {
  family: string;
  source: string;
  license: string;
  status: 'carregada' | 'nao-carregada';
  detail: string;
}

export interface ImportReport {
  format: ImportFormatId;
  formatLabel: string;
  fileName: string;
  fileSize: number;
  items: ReportItem[];
  assets: AssetEntry[];
  fonts: FontEntry[];
  /** Ambiguidades e conversões que limitam a edição futura. */
  notes: string[];
  /** Conteúdo ativo removido por segurança (scripts, manipuladores de eventos, URLs javascript:). */
  removed: string[];
  totals: Record<ItemStatus, number>;
  /** Sites estáticos: ficheiros referidos que faltam (o utilizador pode acrescentá-los). */
  missingFiles?: MissingFile[];
  /** Sites estáticos: páginas importadas. */
  pages?: ImportedPage[];
}

/**
 * Documento produzido por um adaptador, antes de passar pelo motor: os componentes podem ainda
 * conter HTML em texto (analisado pelo motor ao carregar). Só depois de `normalize` é um
 * `GrapesProjectData` canónico.
 */
export interface RawProjectData {
  pages: Array<{ id?: string; frames: Array<{ component: ComponentJson; [key: string]: unknown }>; [key: string]: unknown }>;
  styles?: unknown[];
  assets?: unknown[];
  symbols?: unknown[];
  dataSources?: unknown[];
  [key: string]: unknown;
}

/** Resultado de um adaptador, antes de copiar imagens. */
export interface AdapterResult {
  projectData: RawProjectData;
  report: ImportReport;
  suggestedName: string;
}

export function emptyTotals(): Record<ItemStatus, number> {
  return { preservado: 0, convertido: 0, parcial: 0, 'nao-suportado': 0 };
}

/** Acumula linhas do relatório por (estado, origem, destino). */
export class ReportBuilder {
  private readonly rows = new Map<string, ReportItem>();
  readonly notes: string[] = [];
  readonly removed: string[] = [];

  add(status: ItemStatus, source: string, target: string, detail: string, count = 1): void {
    const key = `${status}|${source}|${target}|${detail}`;
    const row = this.rows.get(key);
    if (row) row.count += count;
    else this.rows.set(key, { status, source, target, count, detail });
  }

  note(text: string): void {
    if (!this.notes.includes(text)) this.notes.push(text);
  }

  remove(text: string): void {
    this.removed.push(text);
  }

  items(): ReportItem[] {
    const order: ItemStatus[] = ['nao-suportado', 'parcial', 'convertido', 'preservado'];
    return [...this.rows.values()].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.count - a.count);
  }

  totals(): Record<ItemStatus, number> {
    const t = emptyTotals();
    for (const r of this.rows.values()) t[r.status] += r.count;
    return t;
  }
}
