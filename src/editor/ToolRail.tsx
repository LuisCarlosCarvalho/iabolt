import { Images, Layers, Palette, Plus, Sparkles } from 'lucide-react';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';

/**
 * Barra vertical de ferramentas do painel esquerdo. Cada ferramenta abre o seu painel ao lado;
 * clicar na ativa recolhe o painel (a barra continua visível).
 *
 * Para acrescentar ferramentas, junta-se uma entrada
 * a TOOLS e o respetivo painel no editor. Só entram ferramentas que já funcionam: a barra
 * nunca mostra botões sem função.
 */
export type ToolId = 'blocks' | 'layers' | 'images' | 'styles' | 'ai';

export interface ToolDef {
  id: ToolId;
  label: string;
  hint: string;
  icon: ReactNode;
}

export const TOOLS: readonly ToolDef[] = [
  { id: 'blocks', label: 'Adicionar', hint: 'Adicionar componentes', icon: <Plus /> },
  { id: 'layers', label: 'Páginas e camadas', hint: 'Páginas e camadas', icon: <Layers /> },
  { id: 'images', label: 'Imagens', hint: 'Imagens do projeto', icon: <Images /> },
  { id: 'styles', label: 'Estilos globais', hint: 'Estilos globais do site', icon: <Palette /> },
  { id: 'ai', label: 'Assistente IA', hint: 'Assistente IA', icon: <Sparkles /> },
];

export const toolById = (id: ToolId): ToolDef | undefined => TOOLS.find((t) => t.id === id);

export function ToolRail({ active, onSelect }: { active: ToolId | null; onSelect: (id: ToolId | null) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  // Setas percorrem as ferramentas (Tab entra e sai da barra como de costume).
  const onKey = (e: KeyboardEvent, index: number) => {
    const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    refs.current[(index + delta + TOOLS.length) % TOOLS.length]?.focus();
  };
  return (
    <nav className="tool-rail" aria-label="Ferramentas do editor">
      {TOOLS.map((t, i) => {
        const on = active === t.id;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            className={`tool-btn ${on ? 'is-active' : ''}`}
            aria-pressed={on}
            aria-controls={on ? 'left-panel' : undefined}
            aria-label={on ? `${t.hint} (clique para recolher)` : t.hint}
            data-tooltip={t.label}
            onClick={() => onSelect(on ? null : t.id)}
            onKeyDown={(e) => onKey(e, i)}
            data-testid={`tool-${t.id}`}
          >
            {t.icon}
            <span className="tool-tip" aria-hidden="true">
              {t.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
