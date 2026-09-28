import { Eye, FilePlus2, Monitor, Smartphone, Square, Tablet } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { navigate, projectPath } from '../app/router';
import { useServices } from '../app/services';
import { previewDocument, SitePreview } from '../app/SitePreview';
import { Button, errorMessage, IconButton, Modal } from '../app/ui';
import { BLANK_TEMPLATE_ID, buildProjectData, TEMPLATES } from '../templates/registry';
import type { TemplateDefinition } from '../templates/types';

interface Choice {
  template: TemplateDefinition | null;
  /** Gerada ao abrir o diálogo: um duplo clique não cria dois projetos. */
  idempotencyKey: string;
}

const PREVIEW_WIDTHS = { desktop: 1280, tablet: 820, mobile: 390 } as const;
type PreviewDevice = keyof typeof PREVIEW_WIDTHS;

export function TemplatesPage() {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [previewing, setPreviewing] = useState<TemplateDefinition | null>(null);
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const choose = (template: TemplateDefinition | null) => setChoice({ template, idempotencyKey: crypto.randomUUID() });

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Templates</h1>
          <p>Escolha um ponto de partida. Cada projeto é uma cópia independente: editá-lo nunca altera o template.</p>
        </div>
      </div>

      <ul className="card-grid" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Templates disponíveis">
        <li>
          <article className="card" data-testid="template-card">
            <div className="blank-thumb">
              <Square aria-hidden="true" />
            </div>
            <div className="card-body">
              <div>
                <div className="card-title">Página em branco</div>
                <p className="tpl-desc">Comece do zero e adicione secções, colunas, títulos, textos, imagens e botões.</p>
              </div>
            </div>
            <div className="tpl-actions">
              <Button variant="primary" onClick={() => choose(null)}>
                <FilePlus2 aria-hidden="true" /> Começar em branco
              </Button>
            </div>
          </article>
        </li>
        {TEMPLATES.map((t) => (
          <li key={t.id}>
            <article className="card" data-testid="template-card">
              <SitePreview label={`Pré-visualização do template ${t.name}`} source={{ key: `tpl:${t.id}`, load: async () => buildProjectData(t) }} />
              <div className="card-body">
                <div style={{ minWidth: 0 }}>
                  <div className="card-title">{t.name}</div>
                  <p className="tpl-desc">{t.description}</p>
                  <span className="card-tag">{t.category}</span>{' '}
                  <span className="card-tag">{t.logo === 'image' ? 'Logótipo em imagem' : 'Logótipo em texto'}</span>
                </div>
              </div>
              <div className="tpl-actions">
                <Button variant="primary" onClick={() => choose(t)}>
                  <FilePlus2 aria-hidden="true" /> Usar este template
                </Button>
                <Button onClick={() => setPreviewing(t)}>
                  <Eye aria-hidden="true" /> Pré-visualizar
                </Button>
              </div>
            </article>
          </li>
        ))}
      </ul>

      <Modal
        wide
        open={previewing !== null}
        title={previewing?.name ?? ''}
        onClose={() => setPreviewing(null)}
        footer={
          previewing && (
            <>
              <Button onClick={() => setPreviewing(null)}>Fechar</Button>
              <Button
                variant="primary"
                onClick={() => {
                  const t = previewing;
                  setPreviewing(null);
                  choose(t);
                }}
              >
                Usar este template
              </Button>
            </>
          )
        }
      >
        <div className="device-tabs" role="group" aria-label="Largura da pré-visualização">
          <IconButton label="Computador" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}><Monitor /></IconButton>
          <IconButton label="Tablet" aria-pressed={device === 'tablet'} onClick={() => setDevice('tablet')}><Tablet /></IconButton>
          <IconButton label="Telemóvel" aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')}><Smartphone /></IconButton>
        </div>
        {previewing && (
          <div style={{ width: device === 'desktop' ? '100%' : Math.min(PREVIEW_WIDTHS[device], 1000), margin: '0 auto', maxWidth: '100%' }}>
            <div className="site-preview preview-tall is-interactive" style={{ border: '1px solid var(--border)', borderRadius: 10 }}>
              <iframe
                title={`Pré-visualização de ${previewing.name}`}
                sandbox=""
                srcDoc={previewDoc(previewing)}
                style={{ width: '100%', height: '100%', position: 'static' }}
              />
            </div>
          </div>
        )}
      </Modal>

      <CreateDialog choice={choice} onClose={() => setChoice(null)} />
    </main>
  );
}

const fullPreviews = new Map<string, string>();
function previewDoc(t: TemplateDefinition): string {
  let doc = fullPreviews.get(t.id);
  if (!doc) {
    doc = previewDocument(buildProjectData(t)).replace('html{overflow:hidden}', '');
    fullPreviews.set(t.id, doc);
  }
  return doc;
}

function CreateDialog({ choice, onClose }: { choice: Choice | null; onClose: () => void }) {
  const { catalog, mode } = useServices();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);
  // Repor o formulário quando abre para outra escolha (sem efeito: estado derivado da chave).
  if (choice && choice.idempotencyKey !== lastKey) {
    setLastKey(choice.idempotencyKey);
    setName(choice.template ? choice.template.name.split(' · ')[0] ?? choice.template.name : 'Nova página');
    setError(null);
    setBusy(false);
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      const data = buildProjectData(choice.template);
      const doc = await catalog.create(choice.idempotencyKey, data, { name, templateId: choice.template?.id ?? BLANK_TEMPLATE_ID });
      navigate(projectPath(doc.projectId));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal open={choice !== null} title={choice?.template ? `Novo projeto · ${choice.template.name}` : 'Novo projeto em branco'} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="field">
          <span>Nome do projeto</span>
          <input className="input" value={name} maxLength={120} required autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="hint" style={{ margin: 0 }}>
          {choice?.template ? 'É criada uma cópia do template só para este projeto. ' : ''}
          {mode === 'server' ? 'O projeto é criado na base de dados.' : 'O projeto fica guardado neste browser (modo local).'}
        </p>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'A criar…' : 'Criar e abrir o editor'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
