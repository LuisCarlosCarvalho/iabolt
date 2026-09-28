import type { Component, Editor } from 'grapesjs';
import { AlertTriangle, ImageUp } from 'lucide-react';
import { useReducer, useState, type ReactNode } from 'react';
import { Button } from '../app/ui';
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
import { setOwnStyle, type DeviceId } from '../engine/styles';
import { DraftInput } from './DraftInput';
import { StyleInspector, type StyleGroup } from './StyleInspector';

function decodeHtml(html: string): string {
  const t = document.createElement('textarea');
  t.innerHTML = html;
  return t.value.split(String.fromCharCode(160)).join(' ');
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

export function PropertiesPanel({
  editor,
  device,
  onReplaceImage,
  onPickBackground,
  footer,
}: {
  editor: Editor;
  device: DeviceId;
  onReplaceImage: (c: Component) => void;
  onPickBackground: (c: Component) => void;
  footer: ReactNode;
}) {
  const c = editor.getSelected();
  // Grupos abertos: preferência de interface (não entra no documento).
  const [openGroups, setOpenGroups] = useState<ReadonlySet<StyleGroup>>(() => new Set<StyleGroup>(['typography', 'spacing']));
  const onToggleGroup = (g: StyleGroup) => {
    const next = new Set(openGroups);
    if (next.has(g)) next.delete(g);
    else next.add(g);
    setOpenGroups(next);
  };
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
      <ComponentProps editor={editor} component={c} device={device} onReplaceImage={onReplaceImage} onPickBackground={onPickBackground} openGroups={openGroups} onToggleGroup={onToggleGroup} />
      {footer}
    </div>
  );
}

function ComponentProps({
  editor,
  component: c,
  device,
  onReplaceImage,
  onPickBackground,
  openGroups,
  onToggleGroup,
}: {
  editor: Editor;
  component: Component;
  device: DeviceId;
  onReplaceImage: (c: Component) => void;
  onPickBackground: (c: Component) => void;
  openGroups: ReadonlySet<StyleGroup>;
  onToggleGroup: (g: StyleGroup) => void;
}) {
  const id = c.getId();
  const isImage = c.is('image');
  const link = isLink(c);
  const isText = c.is('text') || c.is('bolt-accordion-title');
  const tag = textTag(c);
  const plain = (isText || link) && isPlainText(c);
  // Os controlos leem o modelo do motor. Depois de cada alteração o painel volta a desenhar-se
  // no próprio evento: sem isto, um controlo controlado (ex.: checkbox) mostrava o valor antigo
  // até ao fotograma seguinte, e um clique podia parecer não ter efeito.
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const apply = (change: () => void) => {
    change();
    refresh();
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

      <StyleInspector
        editor={editor}
        component={c}
        device={device}
        openGroups={openGroups}
        onToggleGroup={onToggleGroup}
        onPickBackground={onPickBackground}
        commitStyle={(patch) => apply(() => setOwnStyle(editor, c, device, patch))}
        refresh={refresh}
      />
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
