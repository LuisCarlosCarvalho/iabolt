import type { Editor } from 'grapesjs';
import { ImagePlus, RefreshCw, Replace, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AssetUrlMap } from '../assets/assetRefs';
import { ACCEPTED_IMAGE_TYPES, type LibraryImage } from '../assets/assetStore';
import { useServices } from '../app/services';
import { Button, errorMessage, IconButton, Spinner } from '../app/ui';
import { blockById } from '../engine/blocks';
import { displayName } from '../engine/labels';
import { insertBlock, setImage } from '../engine/operations';
import { httpsImageUrl, pageImages, useImageUpload } from './images';

/**
 * Painel «Imagens».
 *  - «Nesta página»: imagens usadas no documento (lidas do modelo).
 *  - Servidor: «Disponíveis no workspace» — ficheiros já carregados para o Storage do workspace
 *    (inclui os carregados aqui e não usados), listados só em leitura; voltam após F5.
 *  - Local: «Carregadas nesta sessão» — em modo local a imagem só fica guardada quando é usada
 *    (vive dentro do documento), e o painel di-lo.
 * Abrir, listar e carregar NUNCA alteram o documento; «Substituir» e «Inserir» são as ações.
 */
type Library = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; items: LibraryImage[] } | { status: 'error'; message: string };

export function ImagesPanel({ editor, projectId, workspaceId, urls }: { editor: Editor; projectId: string; workspaceId?: string; urls: AssetUrlMap }) {
  const { mode, assets } = useServices();
  const inputRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<string[]>([]);
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [request, setRequest] = useState(0);
  const [library, setLibrary] = useState<Library>({ status: 'idle' });
  const { upload, busy, error, setError } = useImageUpload({ projectId, ...(workspaceId ? { workspaceId } : {}), urls });

  // Biblioteca do workspace (servidor): lida ao abrir o painel e depois de cada carregamento.
  useEffect(() => {
    const list = assets.listLibrary?.bind(assets);
    if (!list) return;
    let active = true;
    list({ ...(workspaceId ? { workspaceId } : {}), projectId })
      .then((items) => {
        // Para mostrar usa-se o URL temporário; ao gravar volta a ser a referência estável.
        for (const it of items) urls.register(it.ref, it.display);
        if (active) setLibrary({ status: 'ready', items });
      })
      .catch((e: unknown) => active && setLibrary({ status: 'error', message: errorMessage(e) }));
    return () => {
      active = false;
    };
  }, [assets, workspaceId, projectId, urls, request]);

  const selected = editor.getSelected();
  const selectedImage = selected?.is('image') ? selected : null;
  const onPage = pageImages(editor);
  const pageRefs = new Set(onPage.map((src) => urls.refOf(src)));
  const available =
    library.status === 'ready' ? library.items.filter((it) => !pageRefs.has(it.ref)).map((it) => it.display) : session.filter((src) => !onPage.includes(src));

  const onFile = async (file: File | undefined) => {
    const src = await upload(file);
    if (inputRef.current) inputRef.current.value = '';
    if (!src) return;
    if (assets.listLibrary) {
      setRequest((n) => n + 1); // volta a ler a biblioteca: a imagem nova aparece como disponível
      setMessage('Imagem carregada para o workspace. Fica disponível mesmo depois de recarregar.');
    } else {
      setSession((prev) => (prev.includes(src) ? prev : [src, ...prev]));
      setMessage('Imagem pronta na lista desta sessão. Em modo local só fica guardada quando for usada.');
    }
  };

  const onUrl = (e: FormEvent) => {
    e.preventDefault();
    try {
      const src = httpsImageUrl(url);
      setSession((prev) => (prev.includes(src) ? prev : [src, ...prev]));
      setUrl('');
      setError(null);
      setMessage('Endereço adicionado à lista desta sessão (fica guardado quando for usado).');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const replace = (src: string) => {
    if (!selectedImage) return;
    setImage(editor, selectedImage.getId(), { src });
    setMessage('Imagem selecionada substituída.');
  };

  const insert = (src: string) => {
    const block = blockById('image');
    if (!block) return;
    const def = block.content();
    try {
      const added = insertBlock(editor, { ...def, attributes: { ...(typeof def.attributes === 'object' ? def.attributes : {}), src } }, selected ?? undefined);
      added.getEl()?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setMessage('Imagem inserida junto à seleção.');
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  // Endereços indicados nesta sessão também aparecem no servidor (não são ficheiros do workspace).
  const sessionOnServer = library.status === 'ready' ? session.filter((src) => !onPage.includes(src)) : [];

  const grid = (items: string[], label: string, testId: string, offset: number) => (
    <ul className="images-grid" aria-label={label} data-testid={testId}>
      {items.map((src, i) => (
        <li key={src} className="image-tile" data-testid="image-tile">
          <img src={src} alt={`${label}: imagem ${offset + i + 1}`} loading="lazy" />
          <div className="image-actions">
            <button
              type="button"
              className="image-action"
              disabled={!selectedImage}
              title={selectedImage ? 'Substituir a imagem selecionada por esta' : 'Selecione uma imagem no canvas para a substituir'}
              aria-label={`Substituir imagem selecionada pela imagem ${offset + i + 1}`}
              onClick={() => replace(src)}
              data-testid="image-replace"
            >
              <Replace aria-hidden="true" /> Substituir
            </button>
            <button type="button" className="image-action" title="Inserir como nova imagem junto à seleção" aria-label={`Inserir imagem ${offset + i + 1}`} onClick={() => insert(src)} data-testid="image-insert">
              <ImagePlus aria-hidden="true" /> Inserir
            </button>
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="panel-scroll images-panel" data-testid="images-panel">
      <div className="panel-title">Imagens</div>
      <p className="block-help">
        {selectedImage ? (
          <>
            Selecionada: <strong>{displayName(selectedImage)}</strong>. «Substituir» troca esta imagem; «Inserir» acrescenta uma nova.
          </>
        ) : (
          <>«Inserir» acrescenta uma imagem junto ao elemento selecionado. Para substituir, selecione primeiro uma imagem no canvas.</>
        )}
      </p>

      <div className="images-add">
        <Button disabled={busy} onClick={() => inputRef.current?.click()} data-testid="images-upload">
          <Upload aria-hidden="true" /> {busy ? 'A carregar…' : 'Carregar do computador'}
        </Button>
        <input ref={inputRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} className="sr-only" data-testid="images-file-input" onChange={(e) => void onFile(e.target.files?.[0])} />
        <form onSubmit={onUrl} className="images-url">
          <input className="input" type="url" aria-label="Endereço de imagem" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button type="submit" disabled={!url.trim()}>
            Adicionar
          </Button>
        </form>
      </div>

      {message && !error && (
        <p className="hint images-msg" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error-text images-msg" role="alert">
          {error}
        </p>
      )}

      <section className="images-section" aria-label="Nesta página">
        <h3 className="images-heading">
          Nesta página <span className="images-count">{onPage.length}</span>
        </h3>
        {onPage.length ? grid(onPage, 'Nesta página', 'images-on-page', 0) : <p className="hint images-empty">Ainda não há imagens nesta página.</p>}
      </section>

      {mode === 'server' ? (
        <section className="images-section" aria-label="Disponíveis no workspace">
          <h3 className="images-heading">
            Disponíveis no workspace {library.status === 'ready' && <span className="images-count">{available.length}</span>}
            <IconButton label="Voltar a ler as imagens do workspace" className="images-refresh" onClick={() => setRequest((n) => n + 1)}>
              <RefreshCw />
            </IconButton>
          </h3>
          <p className="hint images-empty">Imagens já carregadas por esta equipa e não usadas nesta página. Ficam guardadas no workspace; nada é apagado aqui.</p>
          {library.status === 'loading' || library.status === 'idle' ? (
            <div className="images-empty">
              <Spinner label="A ler as imagens…" />
            </div>
          ) : library.status === 'error' ? (
            <p className="error-text images-empty" role="alert">
              {library.message}
            </p>
          ) : available.length + sessionOnServer.length === 0 ? (
            <p className="hint images-empty">Sem outras imagens no workspace.</p>
          ) : (
            grid([...sessionOnServer, ...available], 'Disponíveis no workspace', 'images-available', onPage.length)
          )}
        </section>
      ) : (
        <section className="images-section" aria-label="Carregadas nesta sessão">
          <h3 className="images-heading">
            Carregadas nesta sessão <span className="images-count">{available.length}</span>
          </h3>
          <p className="notice-inline" data-testid="images-local-note">
            Modo local: uma imagem carregada só fica guardada quando for usada numa página. As que não forem usadas perdem-se ao recarregar.
          </p>
          {available.length ? grid(available, 'Carregadas nesta sessão', 'images-available', onPage.length) : <p className="hint images-empty">Nenhuma imagem carregada nesta sessão.</p>}
        </section>
      )}
    </div>
  );
}
