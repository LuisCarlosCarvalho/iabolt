import type { Component, Editor } from 'grapesjs';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ChevronRight, ImageUp, Info, Link2, Link2Off, Monitor, RotateCcw, Smartphone, Tablet, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from '../app/ui';
import { isGlobalSelector } from '../engine/globalStyles';
import { createContinuousEdit, styleSources, type ValueSource } from '../engine/styleSources';
import { deviceById, getOwnStyle, type DeviceId, type EditableProp, type StylePatch } from '../engine/styles';
import { DraftInput } from './DraftInput';
import { FontPicker } from './FontPicker';

/**
 * Inspetor de estilos: edita a regra própria do elemento (`#id`) no dispositivo em edição,
 * pelos mecanismos de estilos do motor (histórico e gravação existentes). Cada campo mostra de
 * onde vem o valor atual e permite repor (remover só a alteração local). Abrir grupos ou
 * selecionar elementos só lê: nunca escreve no documento.
 */
type Group = 'typography' | 'layout' | 'size' | 'spacing' | 'background' | 'borders' | 'effects' | 'position';

interface Ctx {
  editor: Editor;
  component: Component;
  device: DeviceId;
  own: StylePatch;
  sources: Map<EditableProp, ValueSource>;
  commit: (patch: StylePatch) => void;
  /** Só redesenha (depois de uma interação contínua já gravada); não escreve nada. */
  refresh: () => void;
}

const UNITLESS = new Set<EditableProp>(['font-weight', 'line-height', 'opacity', 'z-index', 'grid-template-columns']);

export function normalizeValue(prop: EditableProp, raw: string): string {
  const v = raw.trim();
  if (v === '') return '';
  if (!UNITLESS.has(prop) && /^-?\d+(\.\d+)?$/.test(v)) return `${v}px`;
  return v;
}

export function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${color.slice(1).split('').map((ch) => ch + ch).join('')}`.toLowerCase();
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (!m) return '#000000';
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

const WEIGHTS: Array<[string, string]> = [
  ['400', 'Normal'],
  ['500', 'Médio'],
  ['600', 'Semi-negrito'],
  ['700', 'Negrito'],
  ['800', 'Extra-negrito'],
];
const DISPLAY: Array<[string, string]> = [
  ['block', 'Bloco'],
  ['inline-block', 'Bloco em linha'],
  ['flex', 'Flex'],
  ['inline-flex', 'Flex em linha'],
  ['grid', 'Grelha'],
  ['inline', 'Em linha'],
  ['none', 'Oculto'],
];
const FLEX_DIRECTION: Array<[string, string]> = [
  ['row', 'Em linha →'],
  ['row-reverse', 'Em linha ←'],
  ['column', 'Em coluna ↓'],
  ['column-reverse', 'Em coluna ↑'],
];
const JUSTIFY: Array<[string, string]> = [
  ['flex-start', 'Início'],
  ['center', 'Centro'],
  ['flex-end', 'Fim'],
  ['space-between', 'Espaço entre'],
  ['space-around', 'Espaço à volta'],
  ['space-evenly', 'Espaço igual'],
];
const ALIGN: Array<[string, string]> = [
  ['stretch', 'Esticar'],
  ['flex-start', 'Início'],
  ['center', 'Centro'],
  ['flex-end', 'Fim'],
  ['baseline', 'Linha de base'],
];
const WRAP: Array<[string, string]> = [
  ['nowrap', 'Não quebrar'],
  ['wrap', 'Quebrar linha'],
  ['wrap-reverse', 'Quebrar (invertido)'],
];
const BG_SIZE: Array<[string, string]> = [
  ['cover', 'Cobrir'],
  ['contain', 'Conter'],
  ['auto', 'Tamanho original'],
  ['100% 100%', 'Esticar'],
];
const BG_POSITION: Array<[string, string]> = [
  ['center', 'Centro'],
  ['top', 'Topo'],
  ['bottom', 'Fundo'],
  ['left', 'Esquerda'],
  ['right', 'Direita'],
];
const BG_REPEAT: Array<[string, string]> = [
  ['no-repeat', 'Não repetir'],
  ['repeat', 'Repetir'],
  ['repeat-x', 'Repetir na horizontal'],
  ['repeat-y', 'Repetir na vertical'],
];
const BORDER_STYLE: Array<[string, string]> = [
  ['none', 'Sem borda'],
  ['solid', 'Contínua'],
  ['dashed', 'Tracejada'],
  ['dotted', 'Pontilhada'],
  ['double', 'Dupla'],
];
const POSITION: Array<[string, string]> = [
  ['static', 'Normal (static)'],
  ['relative', 'Relativa'],
  ['absolute', 'Absoluta'],
  ['fixed', 'Fixa no ecrã'],
  ['sticky', 'Fixa ao rolar (sticky)'],
];
const SHADOWS: Array<[string, string]> = [
  ['none', 'Sem sombra'],
  ['0 1px 3px rgba(15, 23, 42, 0.12)', 'Suave'],
  ['0 8px 24px rgba(15, 23, 42, 0.16)', 'Média'],
  ['0 20px 48px rgba(15, 23, 42, 0.24)', 'Forte'],
];

/** Valor efetivo: o próprio neste dispositivo, senão o da origem (outro dispositivo, regra, calculado). */
const effective = (ctx: Ctx, prop: EditableProp) => ctx.own[prop] ?? ctx.sources.get(prop)?.value ?? '';

function SourceTag({ source }: { source: ValueSource | undefined }) {
  if (!source) return null;
  const text = source.kind === 'own' ? source.label : source.kind === 'device' ? `De ${source.label}` : source.kind === 'rule' ? source.label : 'Calculado';
  return (
    <span className={`source-tag source-${source.kind}`} title={source.kind === 'computed' ? `Valor calculado pelo browser: ${source.value}` : `${text}: ${source.value}`} data-source={source.kind}>
      {text}
    </span>
  );
}

/** Rótulo + origem + repor: a moldura comum a todos os campos. */
function Field({ ctx, prop, label, children }: { ctx: Ctx; prop: EditableProp; label: string; children: ReactNode }) {
  const own = ctx.own[prop];
  return (
    <div className="field style-field" data-prop={prop}>
      <div className="style-field-head">
        <span>{label}</span>
        <SourceTag source={ctx.sources.get(prop)} />
        {own !== undefined && (
          <button type="button" className="reset-btn" title="Repor: remover a alteração deste dispositivo" aria-label={`Repor ${label.toLowerCase()}`} onClick={() => ctx.commit({ [prop]: '' })} data-testid={`reset-${prop}`}>
            <RotateCcw />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function TextField({ ctx, prop, label, placeholder }: { ctx: Ctx; prop: EditableProp; label: string; placeholder?: string }) {
  return (
    <Field ctx={ctx} prop={prop} label={label}>
      <DraftInput
        label={label}
        testId={`style-${prop}`}
        value={ctx.own[prop] ?? ''}
        placeholder={placeholder ?? ctx.sources.get(prop)?.value ?? ''}
        onCommit={(v) => ctx.commit({ [prop]: normalizeValue(prop, v) })}
      />
    </Field>
  );
}

function SelectField({ ctx, prop, label, options }: { ctx: Ctx; prop: EditableProp; label: string; options: Array<[string, string]> }) {
  const own = ctx.own[prop] ?? '';
  const inherited = ctx.sources.get(prop)?.value ?? '';
  const known = options.some(([v]) => v === own);
  return (
    <Field ctx={ctx} prop={prop} label={label}>
      <select className="select" aria-label={label} data-testid={`style-${prop}`} value={own} onChange={(e) => ctx.commit({ [prop]: e.target.value })}>
        <option value="">{inherited ? `Herdado (${options.find(([v]) => v === inherited)?.[1] ?? inherited})` : 'Herdado'}</option>
        {own && !known && <option value={own}>{own}</option>}
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Fonte: sistema, projeto ou biblioteca do Google Fonts (carregada no projeto ao escolher). */
function FontField({ ctx }: { ctx: Ctx }) {
  const own = ctx.own['font-family'] ?? '';
  const inherited = ctx.sources.get('font-family')?.value ?? '';
  return (
    <Field ctx={ctx} prop="font-family" label="Fonte">
      <FontPicker
        editor={ctx.editor}
        value={own}
        emptyLabel={inherited ? `Herdado (${(inherited.split(',')[0] ?? '').trim().replace(/^['"]|['"]$/g, '')})` : 'Herdado'}
        label="Fonte"
        testId="style-font-family"
        onChange={(v) => ctx.commit({ 'font-family': v })}
      />
    </Field>
  );
}

/** Cor: o seletor nativo pré-visualiza em contínuo e grava um único passo ao fechar. */
function ColorField({ ctx, prop, label }: { ctx: Ctx; prop: 'color' | 'background-color' | 'border-color'; label: string }) {
  const own = ctx.own[prop] ?? '';
  const value = effective(ctx, prop);
  const transparent = !own && (value === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(value));
  const live = useRef<ReturnType<typeof createContinuousEdit> | null>(null);
  const begin = () => {
    live.current ??= createContinuousEdit(ctx.editor, ctx.component, ctx.device, prop);
    return live.current;
  };
  const end = (v?: string) => {
    if (!live.current) return;
    live.current.commit(v);
    live.current = null;
    ctx.refresh();
  };
  const endRef = useRef(end);
  useEffect(() => {
    endRef.current = end;
  });
  // O evento nativo «change» chega quando o seletor fecha: é aí que fica um único passo.
  const [picker, setPicker] = useState<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!picker) return;
    const onChange = () => endRef.current(picker.value);
    picker.addEventListener('change', onChange);
    return () => picker.removeEventListener('change', onChange);
  }, [picker]);
  return (
    <Field ctx={ctx} prop={prop} label={label}>
      <div className="color-field">
        <input
          ref={setPicker}
          type="color"
          aria-label={`${label} (seletor)`}
          data-testid={`color-${prop}`}
          value={transparent ? '#ffffff' : toHex(value)}
          onInput={(e) => begin().preview(e.currentTarget.value)}
          onChange={(e) => begin().preview(e.target.value)}
        />
        <DraftInput label={label} testId={`style-${prop}`} value={own} placeholder={transparent ? 'Transparente' : value} onCommit={(v) => ctx.commit({ [prop]: v.trim() })} />
      </div>
    </Field>
  );
}

/** Controlo deslizante (opacidade): pré-visualização contínua, um passo de histórico no fim. */
function RangeField({ ctx, prop, label, min, max, step }: { ctx: Ctx; prop: EditableProp; label: string; min: number; max: number; step: number }) {
  const value = effective(ctx, prop) || String(max);
  const live = useRef<ReturnType<typeof createContinuousEdit> | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const finish = () => {
    if (!live.current) return;
    live.current.commit();
    live.current = null;
    setDraft(null);
    ctx.refresh();
  };
  return (
    <Field ctx={ctx} prop={prop} label={label}>
      <div className="range-field">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          aria-label={label}
          data-testid={`range-${prop}`}
          value={draft ?? value}
          onChange={(e) => {
            live.current ??= createContinuousEdit(ctx.editor, ctx.component, ctx.device, prop);
            setDraft(e.target.value);
            live.current.preview(e.target.value);
          }}
          onPointerUp={finish}
          onKeyUp={finish}
          onBlur={finish}
        />
        <span className="range-value">{draft ?? value}</span>
      </div>
    </Field>
  );
}

/** Quatro lados (padding/margin) com opção de os ligar: editar um altera os quatro num só passo. */
function SidesField({ ctx, base, label }: { ctx: Ctx; base: 'padding' | 'margin'; label: string }) {
  const [linked, setLinked] = useState(false);
  const sides = ['top', 'right', 'bottom', 'left'] as const;
  const names = { top: 'em cima', right: 'à direita', bottom: 'em baixo', left: 'à esquerda' } as const;
  const props = sides.map((s) => `${base}-${s}` as const);
  return (
    <div className="field style-field">
      <div className="style-field-head">
        <span>{label} (cima · direita · baixo · esquerda)</span>
        <button
          type="button"
          className={`link-btn ${linked ? 'is-on' : ''}`}
          aria-pressed={linked}
          title={linked ? 'Lados ligados: um valor para os quatro' : 'Ligar os quatro lados'}
          aria-label={`Ligar os quatro lados (${label.toLowerCase()})`}
          onClick={() => setLinked(!linked)}
          data-testid={`link-${base}`}
        >
          {linked ? <Link2 /> : <Link2Off />}
        </button>
        {props.some((p) => ctx.own[p] !== undefined) && (
          <button type="button" className="reset-btn" title="Repor os quatro lados" aria-label={`Repor ${label.toLowerCase()}`} onClick={() => ctx.commit(Object.fromEntries(props.map((p) => [p, ''])))} data-testid={`reset-${base}`}>
            <RotateCcw />
          </button>
        )}
      </div>
      <div className="row4">
        {sides.map((side) => {
          const prop = `${base}-${side}` as const;
          return (
            <div key={side} className="side-input" data-source={ctx.sources.get(prop)?.kind}>
              <DraftInput
                label={`${label} ${names[side]}`}
                testId={`style-${prop}`}
                value={ctx.own[prop] ?? ''}
                placeholder={ctx.sources.get(prop)?.value ?? ''}
                onCommit={(v) => {
                  const val = normalizeValue(prop, v);
                  ctx.commit(linked ? Object.fromEntries(props.map((p) => [p, val])) : { [prop]: val });
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GroupBox({ id, title, open, onToggle, children, count }: { id: Group; title: string; open: boolean; onToggle: (g: Group) => void; children: ReactNode; count: number }) {
  return (
    <section className={`style-group ${open ? 'is-open' : ''}`} data-group={id}>
      <button type="button" className="style-group-head" aria-expanded={open} onClick={() => onToggle(id)} data-testid={`group-${id}`}>
        <ChevronRight aria-hidden="true" />
        <span>{title}</span>
        {count > 0 && (
          <span className="style-group-count" title={`${count} alteração(ões) neste dispositivo`}>
            {count}
          </span>
        )}
      </button>
      {open && <div className="style-group-body">{children}</div>}
    </section>
  );
}

/**
 * Explica quando uma alteração em «Estilos globais» não chega a este elemento: a fonte ou a cor
 * vêm de um valor próprio (neste ou noutro dispositivo) ou de uma regra mais específica.
 */
function GlobalOverrideNote({ ctx }: { ctx: Ctx }) {
  const notes = (['font-family', 'color'] as const).flatMap((prop) => {
    const s = ctx.sources.get(prop);
    const name = prop === 'color' ? 'A cor do texto' : 'A fonte';
    if (!s) return [];
    if (s.kind === 'own') return [`${name} é própria deste elemento: os Estilos globais não a alteram aqui. «Repor» volta a seguir o estilo global.`];
    if (s.kind === 'device') return [`${name} é própria deste elemento (definida em ${s.label}): os Estilos globais não a alteram aqui.`];
    const selector = s.label.split(' · ')[0] ?? '';
    if (s.kind === 'rule' && !isGlobalSelector(selector)) return [`${name} vem de «${s.label}», uma regra mais específica do que os Estilos globais: alterá-los não muda este elemento.`];
    return [];
  });
  if (notes.length === 0) return null;
  return (
    <div className="global-note" role="note" data-testid="global-override-note">
      <Info aria-hidden="true" />
      <div>
        {notes.map((n) => (
          <p key={n} style={{ margin: 0 }}>
            {n}
          </p>
        ))}
      </div>
    </div>
  );
}

const GROUP_PROPS: Record<Group, EditableProp[]> = {
  typography: ['font-family', 'font-size', 'font-weight', 'line-height', 'color', 'text-align'],
  layout: ['display', 'flex-direction', 'justify-content', 'align-items', 'flex-wrap', 'gap', 'row-gap', 'column-gap', 'grid-template-columns'],
  size: ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height'],
  spacing: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  background: ['background-color', 'background-image', 'background-size', 'background-position', 'background-repeat'],
  borders: ['border-width', 'border-style', 'border-color', 'border-radius'],
  effects: ['opacity', 'box-shadow'],
  position: ['position', 'top', 'right', 'bottom', 'left', 'z-index'],
};

const DEVICE_ICON: Record<DeviceId, ReactNode> = { desktop: <Monitor />, tablet: <Tablet />, mobile: <Smartphone /> };

export function StyleInspector({
  editor,
  component,
  device,
  openGroups,
  onToggleGroup,
  onPickBackground,
  commitStyle,
  refresh,
}: {
  editor: Editor;
  component: Component;
  device: DeviceId;
  openGroups: ReadonlySet<Group>;
  onToggleGroup: (g: Group) => void;
  onPickBackground: (c: Component) => void;
  /** Aplica e redesenha no próprio evento (mesma via do resto do painel). */
  commitStyle: (patch: StylePatch) => void;
  refresh: () => void;
}) {
  const ctx: Ctx = {
    editor,
    component,
    device,
    own: getOwnStyle(editor, component, device),
    sources: styleSources(editor, component, device),
    commit: commitStyle,
    refresh,
  };
  const isImage = component.is('image');
  const dev = deviceById(device);
  const display = effective(ctx, 'display');
  const isFlex = display.includes('flex');
  const isGrid = display.includes('grid');
  const position = effective(ctx, 'position') || 'static';
  const bgImage = effective(ctx, 'background-image');
  const hasBgImage = !!bgImage && bgImage !== 'none';
  const count = (g: Group) => GROUP_PROPS[g].filter((p) => ctx.own[p] !== undefined).length;
  const group = (id: Group, title: string, body: ReactNode) => (
    <GroupBox id={id} title={title} open={openGroups.has(id)} onToggle={onToggleGroup} count={count(id)}>
      {body}
    </GroupBox>
  );
  const columns = /^repeat\((\d+),\s*1fr\)$/.exec(ctx.own['grid-template-columns'] ?? '')?.[1];

  return (
    <div className="style-inspector" data-testid="style-inspector">
      <div className={`device-banner device-${device}`} role="status" data-testid="device-banner">
        {DEVICE_ICON[device]}
        <div>
          <strong>A editar: {dev.label}</strong>
          <span>
            {dev.media
              ? `Aplica-se a ecrãs até ${dev.media}. Os estilos do Computador ficam como estão.`
              : 'Aplica-se a todos os ecrãs, salvo ajustes próprios do Tablet ou Telemóvel.'}
          </span>
        </div>
      </div>

      {!isImage &&
        group(
          'typography',
          'Tipografia',
          <>
            <FontField ctx={ctx} />
            <div className="row2">
              <TextField ctx={ctx} prop="font-size" label="Tamanho da letra" />
              <SelectField ctx={ctx} prop="font-weight" label="Peso" options={WEIGHTS} />
            </div>
            <TextField ctx={ctx} prop="line-height" label="Altura de linha" />
            <ColorField ctx={ctx} prop="color" label="Cor do texto" />
            <GlobalOverrideNote ctx={ctx} />
            <Field ctx={ctx} prop="text-align" label="Alinhamento">
              <div className="segmented" role="group" aria-label="Alinhamento do texto">
                {(
                  [
                    ['left', 'À esquerda', <AlignLeft key="l" />],
                    ['center', 'Ao centro', <AlignCenter key="c" />],
                    ['right', 'À direita', <AlignRight key="r" />],
                    ['justify', 'Justificado', <AlignJustify key="j" />],
                  ] as const
                ).map(([v, l, icon]) => (
                  <IconButton key={v} label={l} aria-pressed={ctx.own['text-align'] === v} onClick={() => ctx.commit({ 'text-align': ctx.own['text-align'] === v ? '' : v })}>
                    {icon}
                  </IconButton>
                ))}
              </div>
            </Field>
          </>,
        )}

      {group(
        'layout',
        'Layout',
        <>
          <SelectField ctx={ctx} prop="display" label="Exibição" options={DISPLAY} />
          {isFlex && (
            <>
              <SelectField ctx={ctx} prop="flex-direction" label="Direção" options={FLEX_DIRECTION} />
              <div className="row2">
                <SelectField ctx={ctx} prop="justify-content" label="Distribuição" options={JUSTIFY} />
                <SelectField ctx={ctx} prop="align-items" label="Alinhamento" options={ALIGN} />
              </div>
              <div className="row2">
                <SelectField ctx={ctx} prop="flex-wrap" label="Quebra" options={WRAP} />
                <TextField ctx={ctx} prop="gap" label="Espaço entre itens" />
              </div>
            </>
          )}
          {isGrid && (
            <>
              <Field ctx={ctx} prop="grid-template-columns" label="Colunas">
                <div className="row2">
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={12}
                    aria-label="Número de colunas iguais"
                    data-testid="grid-columns-count"
                    placeholder="—"
                    defaultValue={columns ?? ''}
                    key={`${component.getId()}-${device}-${columns ?? ''}`}
                    onBlur={(e) => {
                      const n = Math.round(Number(e.target.value));
                      if (n >= 1 && n <= 12) ctx.commit({ 'grid-template-columns': `repeat(${n}, 1fr)` });
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  />
                  <DraftInput
                    label="Modelo de colunas"
                    testId="style-grid-template-columns"
                    value={ctx.own['grid-template-columns'] ?? ''}
                    placeholder={ctx.sources.get('grid-template-columns')?.value ?? ''}
                    onCommit={(v) => ctx.commit({ 'grid-template-columns': v.trim() })}
                  />
                </div>
              </Field>
              <div className="row2">
                <TextField ctx={ctx} prop="row-gap" label="Espaço entre linhas" />
                <TextField ctx={ctx} prop="column-gap" label="Espaço entre colunas" />
              </div>
            </>
          )}
          {!isFlex && !isGrid && <p className="hint">Escolha «Flex» ou «Grelha» para distribuir os elementos lá dentro.</p>}
        </>,
      )}

      {group(
        'size',
        'Dimensões',
        <>
          <div className="row2">
            <TextField ctx={ctx} prop="width" label="Largura" />
            <TextField ctx={ctx} prop="height" label="Altura" />
          </div>
          <div className="row2">
            <TextField ctx={ctx} prop="min-width" label="Largura mínima" />
            <TextField ctx={ctx} prop="min-height" label="Altura mínima" />
          </div>
          <div className="row2">
            <TextField ctx={ctx} prop="max-width" label="Largura máxima" />
            <TextField ctx={ctx} prop="max-height" label="Altura máxima" />
          </div>
          <p className="hint">Aceita px, %, em, rem, vw, vh, auto… Números sem unidade são píxeis.</p>
        </>,
      )}

      {group(
        'spacing',
        'Espaçamento',
        <>
          <SidesField ctx={ctx} base="padding" label="Espaço interior" />
          <SidesField ctx={ctx} base="margin" label="Margem" />
        </>,
      )}

      {group(
        'background',
        'Fundo',
        <>
          <ColorField ctx={ctx} prop="background-color" label="Cor de fundo" />
          <Field ctx={ctx} prop="background-image" label="Imagem de fundo">
            <div className="bg-image-row">
              <button type="button" className="btn" onClick={() => onPickBackground(component)} data-testid="pick-background">
                <ImageUp aria-hidden="true" /> {hasBgImage ? 'Trocar imagem' : 'Escolher imagem'}
              </button>
              {ctx.own['background-image'] && ctx.own['background-image'] !== 'none' && (
                <IconButton label="Remover imagem de fundo deste dispositivo" onClick={() => ctx.commit({ 'background-image': '' })}>
                  <X />
                </IconButton>
              )}
            </div>
          </Field>
          {hasBgImage && (
            <>
              <div className="row2">
                <SelectField ctx={ctx} prop="background-size" label="Tamanho" options={BG_SIZE} />
                <SelectField ctx={ctx} prop="background-position" label="Posição" options={BG_POSITION} />
              </div>
              <SelectField ctx={ctx} prop="background-repeat" label="Repetição" options={BG_REPEAT} />
            </>
          )}
        </>,
      )}

      {group(
        'borders',
        'Bordas',
        <>
          <div className="row2">
            <TextField ctx={ctx} prop="border-width" label="Espessura" />
            <SelectField ctx={ctx} prop="border-style" label="Estilo" options={BORDER_STYLE} />
          </div>
          <ColorField ctx={ctx} prop="border-color" label="Cor da borda" />
          <TextField ctx={ctx} prop="border-radius" label="Cantos arredondados" />
        </>,
      )}

      {group(
        'effects',
        'Efeitos',
        <>
          <RangeField ctx={ctx} prop="opacity" label="Opacidade" min={0} max={1} step={0.05} />
          <SelectField ctx={ctx} prop="box-shadow" label="Sombra" options={SHADOWS} />
        </>,
      )}

      {group(
        'position',
        'Posição',
        <>
          <SelectField ctx={ctx} prop="position" label="Posicionamento" options={POSITION} />
          {position !== 'static' && (
            <>
              <div className="row2">
                <TextField ctx={ctx} prop="top" label="Topo" />
                <TextField ctx={ctx} prop="right" label="Direita" />
              </div>
              <div className="row2">
                <TextField ctx={ctx} prop="bottom" label="Fundo" />
                <TextField ctx={ctx} prop="left" label="Esquerda" />
              </div>
              <TextField ctx={ctx} prop="z-index" label="Camada (z-index)" />
            </>
          )}
          {position === 'static' && <p className="hint">Em «Normal», o elemento segue o fluxo da página; escolha outra opção para o deslocar.</p>}
        </>,
      )}
    </div>
  );
}

export type { Group as StyleGroup };
