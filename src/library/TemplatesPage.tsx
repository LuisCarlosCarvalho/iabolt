import { Archive, Eye, FilePlus2, History, Monitor, Smartphone, Square, Tablet } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { navigate, projectPath } from '../app/router';
import { useServices } from '../app/services';
import { SitePreview } from '../app/SitePreview';
import { previewDocument as buildPreview } from '../engine/runtime';
import { Button, errorMessage, formatDateTime, formatRelative, IconButton, Modal } from '../app/ui';
import { resolveForDisplay } from '../assets/resolveForDisplay';
import type { GrapesProjectData } from '../contract/boltDocument';
import { BLANK_TEMPLATE_ID, buildProjectData, TEMPLATES } from '../templates/registry';
import type { TemplateDefinition } from '../templates/types';
import { teamTemplateRef, type TeamTemplate, type TemplateVersionInfo } from './templateLibrary';

interface Choice {
  template: TemplateDefinition | null;
  /** Template da equipa (e versão) em vez de um template do produto. */
  team?: { template: TeamTemplate; version: number };
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
  const chooseTeam = (template: TeamTemplate, version: number) => setChoice({ template: null, team: { template, version }, idempotencyKey: crypto.randomUUID() });

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

      <TeamTemplates onUse={chooseTeam} />

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
            <div className="site-preview preview-tall is-interactive" style={{ border: '1px solid var(--ui-border)', borderRadius: 'var(--ui-radius)' }}>
              <iframe
                title={`Pré-visualização de ${previewing.name}`}
                sandbox="allow-scripts"
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
    doc = buildPreview(buildProjectData(t), { interactive: true, scroll: true });
    fullPreviews.set(t.id, doc);
  }
  return doc;
}

function CreateDialog({ choice, onClose }: { choice: Choice | null; onClose: () => void }) {
  const { catalog, mode, library } = useServices();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);
  // Repor o formulário quando abre para outra escolha (sem efeito: estado derivado da chave).
  if (choice && choice.idempotencyKey !== lastKey) {
    setLastKey(choice.idempotencyKey);
    setName(choice.team ? choice.team.template.name : choice.template ? choice.template.name.split(' · ')[0] ?? choice.template.name : 'Nova página');
    setError(null);
    setBusy(false);
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      let doc;
      if (choice.team) {
        // Cópia da versão escolhida: o projeto não fica ligado ao template.
        const v = await library.loadVersion(choice.team.template.id, choice.team.version);
        doc = await catalog.create(choice.idempotencyKey, v.projectData, { name, templateId: teamTemplateRef(v.templateId, v.version) });
      } else {
        const data = buildProjectData(choice.template);
        doc = await catalog.create(choice.idempotencyKey, data, { name, templateId: choice.template?.id ?? BLANK_TEMPLATE_ID });
      }
      navigate(projectPath(doc.projectId));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={choice !== null}
      title={choice?.team ? `Novo projeto · ${choice.team.template.name} (v${choice.team.version})` : choice?.template ? `Novo projeto · ${choice.template.name}` : 'Novo projeto em branco'}
      onClose={onClose}
    >
      <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="field">
          <span>Nome do projeto</span>
          <input className="input" value={name} maxLength={120} required autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="hint" style={{ margin: 0 }}>
          {choice?.template || choice?.team ? 'É criada uma cópia do template só para este projeto. ' : ''}
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

type TeamState = { status: 'loading' } | { status: 'ready'; templates: TeamTemplate[] } | { status: 'error'; message: string };

/** Templates guardados pela equipa (versões imutáveis). */
function TeamTemplates({ onUse }: { onUse: (t: TeamTemplate, version: number) => void }) {
  const { library, assets, mode } = useServices();
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState<{ request: number; state: TeamState } | null>(null);
  const state: TeamState = result?.request === request ? result.state : { status: 'loading' };
  const [history, setHistory] = useState<TeamTemplate | null>(null);
  const [archiving, setArchiving] = useState<TeamTemplate | null>(null);

  useEffect(() => {
    let active = true;
    library
      .list()
      .then((templates) => active && setResult({ request, state: { status: 'ready', templates } }))
      .catch((e: unknown) => active && setResult({ request, state: { status: 'error', message: errorMessage(e) } }));
    return () => {
      active = false;
    };
  }, [library, request]);

  // Imagens privadas do servidor: URLs assinados só para mostrar.
  const load = (t: TeamTemplate, version: number) => async (): Promise<GrapesProjectData> =>
    (await resolveForDisplay(assets, (await library.loadVersion(t.id, version)).projectData)).data;

  return (
    <section aria-labelledby="team-templates" style={{ marginTop: 32 }} data-testid="team-templates">
      <h2 id="team-templates" className="section-title">
        Templates da equipa
      </h2>
      {state.status === 'loading' && <p className="hint">A carregar…</p>}
      {state.status === 'error' && (
        <p className="error-text" role="alert">
          {state.message} <Button onClick={() => setRequest((n) => n + 1)}>Tentar de novo</Button>
        </p>
      )}
      {state.status === 'ready' && state.templates.length === 0 && (
        <p className="hint">
          Ainda não há templates da equipa. No editor, use «Guardar como template» para guardar uma página {mode === 'server' ? 'no servidor' : 'neste browser'}.
        </p>
      )}
      {state.status === 'ready' && state.templates.length > 0 && (
        <ul className="card-grid" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Templates da equipa">
          {state.templates.map((t) => (
            <li key={t.id}>
              <article className="card" data-testid="team-template-card">
                <SitePreview label={`Pré-visualização do template ${t.name}`} source={{ key: `team:${t.id}@${t.currentVersion}`, load: load(t, t.currentVersion) }} />
                <div className="card-body">
                  <div style={{ minWidth: 0 }}>
                    <div className="card-title">{t.name}</div>
                    {t.description && <p className="tpl-desc">{t.description}</p>}
                    <div className="card-meta">
                      Versão {t.currentVersion} · atualizado {formatRelative(t.updatedAt)}
                    </div>
                  </div>
                </div>
                <div className="tpl-actions">
                  <Button variant="primary" onClick={() => onUse(t, t.currentVersion)} data-testid="use-team-template">
                    <FilePlus2 aria-hidden="true" /> Usar este template
                  </Button>
                  <IconButton label="Versões" onClick={() => setHistory(t)}>
                    <History />
                  </IconButton>
                  <IconButton label="Retirar da biblioteca" onClick={() => setArchiving(t)}>
                    <Archive />
                  </IconButton>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
      <VersionsDialog
        template={history}
        onClose={() => setHistory(null)}
        onUse={(t, v) => {
          setHistory(null);
          onUse(t, v);
        }}
      />
      <Modal
        open={archiving !== null}
        title="Retirar template"
        onClose={() => setArchiving(null)}
        footer={
          <>
            <Button onClick={() => setArchiving(null)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => {
                const t = archiving;
                setArchiving(null);
                if (t) void library.archive(t.id).then(() => setRequest((n) => n + 1), () => setRequest((n) => n + 1));
              }}
            >
              Retirar
            </Button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          «{archiving?.name}» deixa de aparecer na biblioteca. As versões não são apagadas e os projetos já criados a partir dele não mudam.
        </p>
      </Modal>
    </section>
  );
}

function VersionsDialog({ template, onClose, onUse }: { template: TeamTemplate | null; onClose: () => void; onUse: (t: TeamTemplate, version: number) => void }) {
  return (
    <Modal open={template !== null} title={`Versões · ${template?.name ?? ''}`} onClose={onClose}>
      {template && <VersionsList template={template} onUse={onUse} />}
    </Modal>
  );
}

function VersionsList({ template, onUse }: { template: TeamTemplate; onUse: (t: TeamTemplate, version: number) => void }) {
  const { library } = useServices();
  const [versions, setVersions] = useState<TemplateVersionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    library
      .versions(template.id)
      .then((v) => active && setVersions(v))
      .catch((e: unknown) => active && setError(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [library, template.id]);
  if (error) return <p className="error-text">{error}</p>;
  if (!versions) return <p className="hint">A carregar…</p>;
  return (
    <ul className="version-list" data-testid="template-versions">
      {versions.map((v) => (
        <li key={v.version}>
          <div>
            <strong>Versão {v.version}</strong>
            {v.version === template.currentVersion && <span className="card-tag" style={{ marginLeft: 8 }}>atual</span>}
            <div className="hint">
              {formatDateTime(v.createdAt)}
              {v.note ? ` · ${v.note}` : ''}
            </div>
          </div>
          <Button onClick={() => onUse(template, v.version)}>Usar esta versão</Button>
        </li>
      ))}
    </ul>
  );
}
