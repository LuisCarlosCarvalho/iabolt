import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from '../app/router';
import { persistenceLabel, useServices } from '../app/services';
import { Button, errorMessage, Modal } from '../app/ui';
import type { GrapesProjectData } from '../contract/boltDocument';
import { parseTeamTemplateRef, type TeamTemplate } from './templateLibrary';

/**
 * «Guardar como template»: cria um template novo (versão 1) ou acrescenta uma versão ao
 * template da equipa de onde o projeto saiu. Versões guardadas nunca mudam.
 * `snapshot` devolve o documento com referências duráveis (nunca URLs assinados).
 */
interface Props {
  open: boolean;
  onClose: () => void;
  snapshot: () => Promise<GrapesProjectData>;
  projectId: string;
  projectName: string;
  templateRef: string | null;
}

export function SaveTemplateDialog(props: Props) {
  // O formulário só existe enquanto o diálogo está aberto: cada abertura começa do zero.
  return (
    <Modal open={props.open} title="Guardar como template" onClose={props.onClose}>
      <SaveTemplateForm {...props} />
    </Modal>
  );
}

function SaveTemplateForm({ onClose, snapshot, projectId, projectName, templateRef }: Props) {
  const { library, mode } = useServices();
  const origin = useMemo(() => parseTeamTemplateRef(templateRef), [templateRef]);
  const [source, setSource] = useState<TeamTemplate | null>(null);
  const [choice, setChoice] = useState<'new' | 'version' | null>(null);
  const target = choice ?? (source ? 'version' : 'new');
  const [name, setName] = useState(projectName);
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ name: string; version: number } | null>(null);
  const [key] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!origin) return;
    let active = true;
    library
      .get(origin.templateId)
      .then((t) => active && setSource(t))
      // Template retirado ou de outro workspace: só é possível criar um novo.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [origin, library]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await snapshot();
      if (target === 'version' && source) {
        const r = await library.addVersion(source.id, source.currentVersion, data, note, projectId);
        if (r.status === 'conflict') {
          setSource({ ...source, currentVersion: r.currentVersion });
          setError(`O template foi alterado entretanto (agora na versão ${r.currentVersion}). Nada foi substituído. Guarde de novo para criar a versão ${r.currentVersion + 1}.`);
          setBusy(false);
          return;
        }
        setSaved({ name: source.name, version: r.version });
      } else {
        const t = await library.create(key, { name, description, sourceProjectId: projectId, projectData: data });
        setSaved({ name: t.name, version: t.currentVersion });
      }
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  };

  return saved ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="template-saved">
          <p style={{ margin: 0 }}>
            Template <strong>{saved.name}</strong> guardado na versão {saved.version} ({persistenceLabel(mode)}). Esta versão não muda: alterações futuras criam novas versões.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Link to="/templates" className="btn">
              Ver templates
            </Link>
            <Button variant="primary" onClick={onClose}>
              Continuar a editar
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {source && (
            <fieldset className="radio-group">
              <label className="check">
                <input type="radio" name="tpl-target" checked={target === 'version'} onChange={() => setChoice('version')} data-testid="template-target-version" />
                <span>
                  Nova versão de <strong>{source.name}</strong> (versão {source.currentVersion + 1}; a versão {source.currentVersion} fica como está)
                </span>
              </label>
              <label className="check">
                <input type="radio" name="tpl-target" checked={target === 'new'} onChange={() => setChoice('new')} data-testid="template-target-new" />
                <span>Novo template</span>
              </label>
            </fieldset>
          )}
          {target === 'new' ? (
            <>
              <label className="field">
                <span>Nome do template</span>
                <input className="input" value={name} maxLength={120} required autoFocus onChange={(e) => setName(e.target.value)} data-testid="template-name" />
              </label>
              <label className="field">
                <span>Descrição (opcional)</span>
                <textarea className="textarea" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
              </label>
            </>
          ) : (
            <label className="field">
              <span>O que mudou (opcional)</span>
              <input className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} data-testid="template-note" />
            </label>
          )}
          <p className="hint" style={{ margin: 0 }}>
            Guarda uma cópia do estado atual da página. Projetos criados a partir do template são independentes: editá-los não altera o template, e editar este projeto
            também não.
          </p>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Button onClick={onClose}>Cancelar</Button>
            <Button type="submit" variant="primary" disabled={busy} data-testid="template-save">
              {busy ? 'A guardar…' : 'Guardar template'}
            </Button>
          </div>
        </form>
      );
}
