import type { Component, Editor } from 'grapesjs';
import { AlertTriangle, AlignCenter, AlignJustify, AlignLeft, AlignRight, ImageUp, RotateCcw } from 'lucide-react';
import { useReducer, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, IconButton } from '../app/ui';
import { contentHint, displayName, isLogo } from '../engine/labels';
import {
  carouselConfig,
  hasHref,
  isLink,
  isLinkBox,
  isPlainText,
  setCarouselConfig,
  setImage,
  setInput,
  setLink,
  setText,
  setTextTag,
  TEXT_TAGS,
  textTag,
  type CarouselConfig,
  type InputPatch,
} from '../engine/operations';
import { deviceById, getOwnStyle, setOwnStyle, type DeviceId, type EditableProp } from '../engine/styles';

/** Valor calculado no canvas (para mostrar o efetivo quando o elemento não tem valor próprio). */
function computedStyle(c: Component): CSSStyleDeclaration | null {
  const el = c.getEl();
  const win = el?.ownerDocument?.defaultView;
  return el && win ? win.getComputedStyle(el) : null;
}

function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${color.slice(1).split('').map((ch) => ch + ch).join('')}`.toLowerCase();
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (!m) return '#000000';
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

function decodeHtml(html: string): string {
  const t = document.createElement('textarea');
  t.innerHTML = html;
  return t.value.split(String.fromCharCode(160)).join(' ');
}

const UNITLESS = new Set<EditableProp>(['font-weight', 'line-height']);

function normalize(prop: EditableProp, raw: string): string {
  const v = raw.trim();
  if (v === '') return '';
  if (!UNITLESS.has(prop) && /^-?\d+(\.\d+)?$/.test(v)) return `${v}px`;
  return v;
}

const FONTS: Array<[string, string]> = [
  ['', 'Do tema'],
  ["'Inter', 'Segoe UI', system-ui, sans-serif", 'Sem serifa (Inter)'],
  ["Georgia, 'Times New Roman', serif", 'Com serifa (Georgia)'],
  ["'Trebuchet MS', 'Segoe UI', sans-serif", 'Humanista (Trebuchet)'],
  ["ui-monospace, 'Cascadia Code', Consolas, monospace", 'Monoespaçada'],
];

const WEIGHTS: Array<[string, string]> = [
  ['', 'Do tema'],
  ['400', 'Normal'],
  ['500', 'Médio'],
  ['600', 'Semi-negrito'],
  ['700', 'Negrito'],
  ['800', 'Extra-negrito'],
];

interface StyleCtx {
  own: Partial<Record<EditableProp, string>>;
  computed: CSSStyleDeclaration | null;
  commit: (prop: EditableProp, value: string) => void;
}

/** Campo de texto com rascunho local; grava ao sair do campo ou com Enter (um passo de desfazer). */
function DraftInput({ value, placeholder, onCommit, label, testId, multiline = false }: { value: string; placeholder?: string; onCommit: (v: string) => void; label: string; testId?: string; multiline?: boolean }) {
  const [draft, setDraft] = useState(value);
  const [base, setBase] = useState(value);
  // Valor externo mudou (desfazer, outro dispositivo): o rascunho acompanha.
  if (value !== base) {
    setBase(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault();
      commit();
    }
    if (e.key === 'Escape') setDraft(value);
  };
  return multiline ? (
    <textarea className="textarea" aria-label={label} data-testid={testId} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey} />
  ) : (
    <input className="input" aria-label={label} data-testid={testId} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey} />
  );
}

function StyleInput({ ctx, prop, label }: { ctx: StyleCtx; prop: EditableProp; label: string }) {
  return (
    <DraftInput
      label={label}
      testId={`style-${prop}`}
      value={ctx.own[prop] ?? ''}
      placeholder={ctx.computed?.getPropertyValue(prop) || ''}
      onCommit={(v) => ctx.commit(prop, normalize(prop, v))}
    />
  );
}

function ColorInput({ ctx, prop, label }: { ctx: StyleCtx; prop: 'color' | 'background-color'; label: string }) {
  const own = ctx.own[prop] ?? '';
  const computed = ctx.computed?.getPropertyValue(prop) || '';
  const transparent = !own && (computed === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(computed));
  const effective = own || computed;
  return (
    <div className="field">
      <span>{label}</span>
      <div className="color-field">
        <input type="color" aria-label={`${label} (seletor)`} data-testid={`color-${prop}`} value={transparent ? '#ffffff' : toHex(effective)} onChange={(e) => ctx.commit(prop, e.target.value)} />
        <DraftInput label={label} value={own} placeholder={transparent ? 'Transparente' : effective} onCommit={(v) => ctx.commit(prop, v.trim())} />
        {own && (
          <IconButton label={`Repor ${label.toLowerCase()}`} onClick={() => ctx.commit(prop, '')}>
            <RotateCcw />
          </IconButton>
        )}
      </div>
    </div>
  );
}

function Select({ ctx, prop, label, options }: { ctx: StyleCtx; prop: EditableProp; label: string; options: Array<[string, string]> }) {
  const own = ctx.own[prop] ?? '';
  const known = options.some(([v]) => v === own);
  return (
    <label className="field">
      <span>{label}</span>
      <select className="select" data-testid={`style-${prop}`} value={own} onChange={(e) => ctx.commit(prop, e.target.value)}>
        {!known && <option value={own}>{own}</option>}
        {options.map(([v, l]) => (
          <option key={v || 'tema'} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="props-section">
      <h3>
        {title}
        {aside}
      </h3>
      {children}
    </section>
  );
}

export function PropertiesPanel({ editor, device, onReplaceImage, footer }: { editor: Editor; device: DeviceId; onReplaceImage: (c: Component) => void; footer: ReactNode }) {
  const c = editor.getSelected();
  if (!c) {
    return (
      <div className="props">
        <div className="props-head">
          <h2>Propriedades</h2>
          <p>Selecione um elemento no canvas ou na estrutura da página para o editar.</p>
        </div>
        {footer}
      </div>
    );
  }
  return (
    <div className="props">
      <ComponentProps editor={editor} component={c} device={device} onReplaceImage={onReplaceImage} />
      {footer}
    </div>
  );
}

function ComponentProps({ editor, component: c, device, onReplaceImage }: { editor: Editor; component: Component; device: DeviceId; onReplaceImage: (c: Component) => void }) {
  const id = c.getId();
  const isImage = c.is('image');
  const link = isLink(c);
  const isText = c.is('text') || c.is('bolt-accordion-title');
  const tag = textTag(c);
  const plain = (isText || link) && isPlainText(c);
  const deviceLabel = deviceById(device).label;
  // Os controlos leem o modelo do motor. Depois de cada alteração o painel volta a desenhar-se
  // no próprio evento: sem isto, um controlo controlado (ex.: checkbox) mostrava o valor antigo
  // até ao fotograma seguinte, e um clique podia parecer não ter efeito.
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const apply = (change: () => void) => {
    change();
    refresh();
  };
  const ctx: StyleCtx = {
    own: getOwnStyle(editor, c, device),
    computed: computedStyle(c),
    commit: (prop, value) => apply(() => setOwnStyle(editor, c, device, { [prop]: value })),
  };
  const attrs = c.getAttributes();
  const hint = contentHint(c, 60);

  return (
    <>
      <div className="props-head">
        <h2 data-testid="props-title">{displayName(c)}</h2>
        {hint && <p>{hint}</p>}
      </div>

      {(isText || link) && (
        <Section title="Conteúdo">
          {isLogo(c) && <p className="logo-lock">Logótipo em texto. Continua a ser texto: pode mudar as palavras, a cor e a fonte.</p>}
          {plain ? (
            <label className="field">
              <span>Texto</span>
              <DraftInput label="Texto" testId="prop-text" multiline={!link} value={decodeHtml(c.getInnerHTML())} onCommit={(v) => apply(() => (link ? setLink(editor, id, { text: v }) : setText(editor, id, v)))} />
              {!link && <span className="hint">Também pode clicar duas vezes no texto, no canvas, para escrever diretamente.</span>}
            </label>
          ) : (
            <p className="hint" style={{ margin: 0 }}>Este texto tem formatação. Clique duas vezes no canvas para o editar diretamente.</p>
          )}
          {tag && (
            <label className="field">
              <span>Tipo de texto</span>
              <select
                className="select"
                data-testid="prop-tag"
                value={tag}
                onChange={(e) => {
                  const next = TEXT_TAGS.find((t) => t === e.target.value);
                  if (next) apply(() => setTextTag(editor, id, next));
                }}
              >
                {TEXT_TAGS.map((t) => (
                  <option key={t} value={t}>
                    {t === 'p' ? 'Parágrafo' : `Título ${t.slice(1)}${t === 'h1' ? ' (principal)' : ''}`}
                  </option>
                ))}
              </select>
              <span className="hint">A página deve ter um só título principal (Título 1).</span>
            </label>
          )}
          {link && hasHref(c) && (
            <LinkTarget attrs={attrs} onHref={(v) => apply(() => setLink(editor, id, { href: v }))} onNewTab={(v) => apply(() => setLink(editor, id, { newTab: v }))} />
          )}
        </Section>
      )}

      {isLinkBox(c) && (
        <Section title="Ligação do bloco">
          <p className="hint" style={{ margin: 0 }}>O bloco inteiro é clicável. Os textos e imagens lá dentro editam-se selecionando-os.</p>
          <LinkTarget attrs={attrs} onHref={(v) => apply(() => setLink(editor, id, { href: v }))} onNewTab={(v) => apply(() => setLink(editor, id, { newTab: v }))} />
        </Section>
      )}

      {c.is('bolt-input') && <InputSection attrs={attrs} onChange={(patch) => apply(() => setInput(editor, id, patch))} />}

      {c.is('bolt-carousel') && <CarouselSection component={c} onChange={(patch) => apply(() => setCarouselConfig(editor, id, patch))} />}

      {isImage && (
        <Section title="Imagem">
          {isLogo(c) && <p className="logo-lock">Logótipo em imagem. Substitua-o por outra imagem; continua a ser uma imagem.</p>}
          <img className="img-thumb" src={String(c.get('src') ?? '')} alt="" />
          <Button variant="primary" data-testid="replace-image" onClick={() => onReplaceImage(c)}>
            <ImageUp aria-hidden="true" /> Substituir imagem
          </Button>
          <label className="field">
            <span>Texto alternativo</span>
            <DraftInput label="Texto alternativo" testId="prop-alt" value={String(attrs.alt ?? '')} placeholder="Descreva a imagem para leitores de ecrã" onCommit={(v) => apply(() => setImage(editor, id, { alt: v }))} />
          </label>
        </Section>
      )}

      {!isImage && (
        <Section title="Tipografia" aside={<small>{deviceLabel}</small>}>
          <Select ctx={ctx} prop="font-family" label="Fonte" options={FONTS} />
          <div className="row2">
            <label className="field">
              <span>Tamanho</span>
              <StyleInput ctx={ctx} prop="font-size" label="Tamanho da letra" />
            </label>
            <Select ctx={ctx} prop="font-weight" label="Peso" options={WEIGHTS} />
          </div>
          <label className="field">
            <span>Altura de linha</span>
            <StyleInput ctx={ctx} prop="line-height" label="Altura de linha" />
          </label>
          <ColorInput ctx={ctx} prop="color" label="Cor do texto" />
          <div className="field">
            <span>Alinhamento</span>
            <div className="segmented" role="group" aria-label="Alinhamento do texto">
              {(
                [
                  ['left', 'À esquerda', <AlignLeft key="l" />],
                  ['center', 'Ao centro', <AlignCenter key="c" />],
                  ['right', 'À direita', <AlignRight key="r" />],
                  ['justify', 'Justificado', <AlignJustify key="j" />],
                ] as const
              ).map(([v, l, icon]) => (
                <IconButton key={v} label={l} aria-pressed={ctx.own['text-align'] === v} onClick={() => ctx.commit('text-align', ctx.own['text-align'] === v ? '' : v)}>
                  {icon}
                </IconButton>
              ))}
            </div>
          </div>
        </Section>
      )}

      <Section title={isImage ? 'Tamanho e aspeto' : 'Cores e aspeto'} aside={<small>{deviceLabel}</small>}>
        {!isImage && <ColorInput ctx={ctx} prop="background-color" label="Cor de fundo" />}
        {isImage && (
          <div className="row2">
            <label className="field">
              <span>Largura</span>
              <StyleInput ctx={ctx} prop="width" label="Largura" />
            </label>
            <label className="field">
              <span>Largura máxima</span>
              <StyleInput ctx={ctx} prop="max-width" label="Largura máxima" />
            </label>
          </div>
        )}
        <label className="field">
          <span>Cantos arredondados</span>
          <StyleInput ctx={ctx} prop="border-radius" label="Cantos arredondados" />
        </label>
      </Section>

      <Section title="Espaçamento" aside={<small>{deviceLabel}</small>}>
        <div className="field">
          <span>Espaço interior (cima · direita · baixo · esquerda)</span>
          <div className="row4">
            <StyleInput ctx={ctx} prop="padding-top" label="Espaço interior em cima" />
            <StyleInput ctx={ctx} prop="padding-right" label="Espaço interior à direita" />
            <StyleInput ctx={ctx} prop="padding-bottom" label="Espaço interior em baixo" />
            <StyleInput ctx={ctx} prop="padding-left" label="Espaço interior à esquerda" />
          </div>
        </div>
        <div className="row2">
          <label className="field">
            <span>Margem em cima</span>
            <StyleInput ctx={ctx} prop="margin-top" label="Margem em cima" />
          </label>
          <label className="field">
            <span>Margem em baixo</span>
            <StyleInput ctx={ctx} prop="margin-bottom" label="Margem em baixo" />
          </label>
        </div>
        <span className="hint">Números sem unidade são píxeis. {device === 'desktop' ? 'Aplica-se a todos os ecrãs, salvo ajuste noutro dispositivo.' : `Aplica-se só a ecrãs de ${deviceLabel.toLowerCase()} ou menores.`}</span>
      </Section>
    </>
  );
}

function LinkTarget({ attrs, onHref, onNewTab }: { attrs: Record<string, unknown>; onHref: (v: string) => void; onNewTab: (v: boolean) => void }) {
  return (
    <>
      <label className="field">
        <span>Destino</span>
        <DraftInput label="Destino" testId="prop-href" value={String(attrs.href ?? '')} placeholder="https://… ou #secção" onCommit={(v) => onHref(v.trim())} />
        <span className="hint">Endereço web, email (mailto:), telefone (tel:) ou âncora da página (#contacto).</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={attrs.target === '_blank'} onChange={(e) => onNewTab(e.target.checked)} />
        Abrir num novo separador
      </label>
    </>
  );
}

const INPUT_TYPES: Array<[NonNullable<InputPatch['type']>, string]> = [
  ['text', 'Texto'],
  ['email', 'Email'],
  ['tel', 'Telefone'],
  ['url', 'Endereço web'],
  ['number', 'Número'],
];

function InputSection({ attrs, onChange }: { attrs: Record<string, unknown>; onChange: (patch: InputPatch) => void }) {
  const type = INPUT_TYPES.find(([t]) => t === attrs.type)?.[0] ?? 'text';
  const required = attrs.required === true || attrs.required === 'true' || attrs.required === '';
  return (
    <Section title="Campo de formulário">
      <p className="form-warning" role="note" data-testid="form-no-integration">
        <AlertTriangle aria-hidden="true" /> Sem integração de envio configurada: o campo é editável, mas nada é enviado nem subscrito.
      </p>
      <label className="field">
        <span>Texto de exemplo</span>
        <DraftInput label="Texto de exemplo" testId="prop-placeholder" value={String(attrs.placeholder ?? '')} onCommit={(v) => onChange({ placeholder: v })} />
      </label>
      <div className="row2">
        <label className="field">
          <span>Tipo</span>
          <select className="select" value={type} onChange={(e) => onChange({ type: INPUT_TYPES.find(([t]) => t === e.target.value)?.[0] ?? 'text' })}>
            {INPUT_TYPES.map(([t, l]) => (
              <option key={t} value={t}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Nome do campo</span>
          <DraftInput label="Nome do campo" value={String(attrs.name ?? '')} placeholder="email" onCommit={(v) => onChange({ name: v.trim() })} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={required} onChange={(e) => onChange({ required: e.target.checked })} />
        Obrigatório
      </label>
    </Section>
  );
}

function CarouselSection({ component, onChange }: { component: Component; onChange: (patch: Partial<CarouselConfig>) => void }) {
  const cfg = carouselConfig(component);
  const setBp = (i: number, key: 'perView' | 'gap', raw: string) => {
    const v = Math.max(key === 'perView' ? 1 : 0, Math.round(Number(raw) || 0));
    onChange({ breakpoints: cfg.breakpoints.map((b, j) => (j === i ? { ...b, [key]: v } : b)) });
  };
  const rangeLabel = (i: number) => {
    const b = cfg.breakpoints[i];
    const next = cfg.breakpoints[i + 1];
    if (!b) return '';
    if (b.min === 0) return next ? `Até ${next.min - 1} px` : 'Todas as larguras';
    return `A partir de ${b.min} px`;
  };
  const delay = cfg.autoplay ? String(cfg.autoplay.delay / 1000) : '';
  return (
    <Section title="Carrossel">
      <div className="field">
        <span>Slides visíveis por largura de ecrã</span>
        {cfg.breakpoints.map((b, i) => (
          <div className="row2" key={b.min}>
            <label className="field">
              <span>{rangeLabel(i)}</span>
              <DraftInput label={`Slides visíveis: ${rangeLabel(i)}`} testId={`carousel-perview-${i}`} value={String(b.perView)} onCommit={(v) => setBp(i, 'perView', v)} />
            </label>
            <label className="field">
              <span>Espaço (px)</span>
              <DraftInput label={`Espaço entre slides: ${rangeLabel(i)}`} value={String(b.gap)} onCommit={(v) => setBp(i, 'gap', v)} />
            </label>
          </div>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={cfg.loop === true} onChange={(e) => onChange({ loop: e.target.checked })} />
        Em ciclo
      </label>
      <label className="field">
        <span>Avanço automático (segundos; 0 = contínuo; vazio = desligado)</span>
        <DraftInput
          label="Avanço automático"
          value={delay}
          placeholder="Desligado"
          onCommit={(v) => onChange({ autoplay: v.trim() === '' ? null : { delay: Math.max(0, Number(v) || 0) * 1000 } })}
        />
      </label>
      <span className="hint">No editor o carrossel não avança sozinho; selecione um slide na estrutura para o mostrar. O avanço vê-se na pré-visualização.</span>
    </Section>
  );
}
