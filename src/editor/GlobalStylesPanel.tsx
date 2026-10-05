import type { Editor } from 'grapesjs';
import { Info, Palette, RotateCcw, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../app/ui';
import {
  continuousSlotEdit,
  createGlobalSetup,
  firstFamily,
  isChanged,
  planGlobalSetup,
  readGlobalStyles,
  resetAll,
  resetSlot,
  resolveValue,
  variableOf,
  writeSlot,
  type GlobalSlot,
  type GlobalStyles,
} from '../engine/globalStyles';
import { DraftInput } from './DraftInput';
import { FontPicker } from './FontPicker';
import { toHex } from './StyleInspector';

/**
 * Ferramenta «Estilos globais»: cores, tipografia e estilos de elementos que se aplicam a todas as
 * páginas. Só mostra valores com associação global identificável (ver `engine/globalStyles`).
 * Abrir o painel só lê. Cada alteração concluída é um passo de histórico; o seletor de cor
 * pré-visualiza em contínuo e grava um único passo ao fechar. A gravação é a do editor (SaveQueue).
 */
export function GlobalStylesPanel({ editor }: { editor: Editor }) {
  const g = readGlobalStyles(editor);
  const colors = g.slots.filter((s) => s.group === 'colors');
  const typography = g.slots.filter((s) => s.group === 'typography');
  const elements = g.slots.filter((s) => s.group === 'elements');
  const sections = [...new Set(elements.map((s) => s.section))];
  const changed = g.slots.some((s) => isChanged(editor, s.key));

  return (
    <div className="panel-scroll global-styles" data-testid="global-styles-panel">
      <div className="panel-title">Estilos globais</div>
      <p className="global-scope" role="note" data-testid="global-scope-note">
        <Info aria-hidden="true" /> Estas alterações afetam todas as páginas que utilizam este estilo.
      </p>
      <div className="global-actions">
        <Button variant="ghost" disabled={!changed} onClick={() => resetAll(editor)} data-testid="global-reset-all" title="Repor os valores que o projeto tinha ao abrir (um só passo de histórico)">
          <RotateCcw aria-hidden="true" /> Repor tudo
        </Button>
      </div>

      {!g.hasVariables && <SetupCard editor={editor} />}

      <Group title="Cores" empty="Sem variáveis de cor identificadas neste projeto." testId="global-group-colors">
        {colors.map((s) => (
          <SlotRow key={s.key} editor={editor} slot={s} g={g} />
        ))}
      </Group>
      <Group title="Tipografia" empty="Sem fontes globais identificadas neste projeto." testId="global-group-typography">
        {typography.map((s) => (
          <SlotRow key={s.key} editor={editor} slot={s} g={g} />
        ))}
      </Group>
      <Group title="Elementos" empty="Sem regras globais de títulos, parágrafos, ligações ou botões neste projeto." testId="global-group-elements">
        {sections.map((sec) => (
          <div key={sec} className="global-section" data-section={sec}>
            <div className="global-section-title">{sec}</div>
            {elements
              .filter((s) => s.section === sec)
              .map((s) => (
                <SlotRow key={s.key} editor={editor} slot={s} g={g} />
              ))}
          </div>
        ))}
      </Group>
      <p className="hint global-foot">
        Elementos com valor próprio ou com uma regra mais específica mantêm esse valor; o inspetor indica quando é o caso. O tema Claro/Escuro da aplicação não altera o site.
      </p>
    </div>
  );
}

function Group({ title, empty, testId, children }: { title: string; empty: string; testId: string; children: ReactNode[] }) {
  const has = children.some(Boolean);
  return (
    <section className="global-group" data-testid={testId}>
      <h3 className="global-group-title">{title}</h3>
      {has ? children : <p className="hint global-empty">{empty}</p>}
    </section>
  );
}

function SetupCard({ editor }: { editor: Editor }) {
  const plan = planGlobalSetup(editor);
  return (
    <div className="global-setup" data-testid="global-setup">
      <strong>
        <Palette aria-hidden="true" /> Este projeto não tem variáveis globais de cor nem de fonte.
      </strong>
      <p>«Criar estilos globais» associa o corpo da página a variáveis com os valores atuais. O aspeto não muda:</p>
      <ul>
        <li>
          «Texto» = <code>{plan.text}</code> (cor do texto do corpo);
        </li>
        <li>
          «Fonte do texto» = <code>{firstFamily(plan.font)}</code> (fonte do corpo);
        </li>
        {plan.background && (
          <li>
            «Fundo da página» = <code>{plan.background}</code>;
          </li>
        )}
      </ul>
      <p>
        Nenhum valor próprio é convertido.{' '}
        {plan.overrides > 0
          ? `${plan.overrides} elemento(s) têm cor ou fonte próprias e continuam com elas; só os elementos que herdam do corpo seguem as variáveis.`
          : 'Todos os elementos que herdam do corpo seguem as variáveis.'}
      </p>
      <Button variant="primary" onClick={() => createGlobalSetup(editor)} data-testid="global-create">
        <Sparkles aria-hidden="true" /> Criar estilos globais
      </Button>
    </div>
  );
}

function SlotRow({ editor, slot, g }: { editor: Editor; slot: GlobalSlot; g: GlobalStyles }) {
  const changed = isChanged(editor, slot.key);
  return (
    <div className="global-slot" data-testid="global-slot" data-name={slot.name} data-scope={slot.scope} data-kind={slot.kind}>
      <div className="style-field-head">
        <span>{slot.label}</span>
        {changed && (
          <button type="button" className="reset-btn" title="Repor o valor que o projeto tinha ao abrir" aria-label={`Repor ${slot.label.toLowerCase()}`} onClick={() => resetSlot(editor, slot.key)} data-testid="global-reset">
            <RotateCcw />
          </button>
        )}
      </div>
      {slot.kind === 'color' ? <ColorControl editor={editor} slot={slot} g={g} /> : slot.kind === 'font' ? <FontControl editor={editor} slot={slot} g={g} /> : <TextControl editor={editor} slot={slot} g={g} />}
      <span className="global-tech" title={slot.record ? `Ligado ao registo «${slot.record.source}.${slot.record.id}»` : undefined} data-testid="global-tech">
        {slot.technical}
      </span>
    </div>
  );
}

/** Nome amigável de uma variável (o técnico, se não for conhecida). */
function friendly(g: GlobalStyles, name: string): string {
  return g.slots.find((s) => s.name === name)?.label ?? name;
}

/** Variáveis do mesmo tipo a que um campo se pode ligar (nunca a si própria). */
function candidates(slot: GlobalSlot, g: GlobalStyles, kind: 'color' | 'font'): GlobalSlot[] {
  return g.slots.filter((s) => s.kind === kind && s.name.startsWith('--') && s.name !== slot.name);
}

function ColorControl({ editor, slot, g }: { editor: Editor; slot: GlobalSlot; g: GlobalStyles }) {
  const bound = variableOf(slot.value);
  const vars = candidates(slot, g, 'color');
  const resolved = resolveValue(slot.value || slot.fallback, g.variables);
  const live = useRef<ReturnType<typeof continuousSlotEdit> | null>(null);
  // Grava o último valor pré-visualizado (o input controlado pode já mostrar o valor anterior).
  const end = () => {
    if (!live.current) return;
    live.current.commit();
    live.current = null;
  };
  const endRef = useRef(end);
  useEffect(() => {
    endRef.current = end;
  });
  // «change» nativo chega quando o seletor fecha: um único passo de histórico.
  const [picker, setPicker] = useState<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!picker) return;
    const onChange = () => endRef.current();
    picker.addEventListener('change', onChange);
    return () => picker.removeEventListener('change', onChange);
  }, [picker]);
  const bindingSelect = (bound || vars.length > 0) && !slot.name.startsWith('--') && (
    <select
      className="select"
      aria-label={`${slot.label}: origem`}
      data-testid="global-bind"
      value={bound ? `var(${bound})` : ''}
      onChange={(e) => writeSlot(editor, slot.key, e.target.value || toHex(resolved))}
    >
      <option value="">Cor própria</option>
      {bound && !vars.some((v) => v.name === bound) && <option value={`var(${bound})`}>Segue «{friendly(g, bound)}»</option>}
      {vars.map((v) => (
        <option key={v.key} value={`var(${v.name})`}>
          Segue «{v.label}»
        </option>
      ))}
    </select>
  );
  return (
    <div className="global-control">
      {bindingSelect}
      <div className="color-field">
        <input
          ref={setPicker}
          type="color"
          aria-label={`${slot.label} (seletor)`}
          data-testid="global-color"
          disabled={Boolean(bound)}
          title={bound ? `Segue «${friendly(g, bound)}»: altere-a em «Cores»` : undefined}
          value={toHex(resolved)}
          onInput={(e) => {
            live.current ??= continuousSlotEdit(editor, slot.key);
            live.current.preview(e.currentTarget.value);
          }}
          onChange={(e) => {
            live.current ??= continuousSlotEdit(editor, slot.key);
            live.current.preview(e.target.value);
          }}
        />
        {bound ? (
          <span className="global-resolved" data-testid="global-resolved">
            {resolved} · definido em «{friendly(g, bound)}»
          </span>
        ) : (
          <DraftInput label={slot.label} testId="global-value" value={slot.value} placeholder={slot.fallback || resolved} onCommit={(v) => writeSlot(editor, slot.key, v.trim())} />
        )}
      </div>
    </div>
  );
}

function FontControl({ editor, slot, g }: { editor: Editor; slot: GlobalSlot; g: GlobalStyles }) {
  const vars = candidates(slot, g, 'font');
  const extra = vars.map((v): [string, string] => [`var(${v.name})`, `Segue «${v.label}» · ${firstFamily(resolveValue(v.value || v.fallback, g.variables))}`]);
  const current = slot.value;
  return (
    <FontPicker
      editor={editor}
      value={current}
      extra={extra}
      {...(current ? {} : { emptyLabel: slot.fallback ? `Predefinição (${firstFamily(slot.fallback)})` : 'Sem valor' })}
      label={slot.label}
      testId="global-font"
      onChange={(v) => writeSlot(editor, slot.key, v)}
    />
  );
}

function TextControl({ editor, slot, g }: { editor: Editor; slot: GlobalSlot; g: GlobalStyles }) {
  const bound = variableOf(slot.value);
  if (!bound) return <DraftInput label={slot.label} testId="global-value" value={slot.value} placeholder={slot.fallback} onCommit={(v) => writeSlot(editor, slot.key, v.trim())} />;
  // Ligado a uma variável: mostra o nome amigável; escrever um valor próprio é opcional e explícito.
  return (
    <div className="global-control">
      <span className="global-resolved" data-testid="global-resolved">
        Segue «{friendly(g, bound)}» · {resolveValue(slot.value, g.variables)}
      </span>
      <DraftInput
        label={`${slot.label}: valor próprio`}
        testId="global-value"
        value=""
        placeholder="Valor próprio (substitui a ligação)"
        onCommit={(v) => {
          if (v.trim()) writeSlot(editor, slot.key, v.trim());
        }}
      />
    </div>
  );
}
