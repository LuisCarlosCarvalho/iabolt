import type { Component, Editor } from 'grapesjs';
import { Upload } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import type { AssetUrlMap } from '../assets/assetRefs';
import { ACCEPTED_IMAGE_TYPES } from '../assets/assetStore';
import { useServices } from '../app/services';
import { Button, errorMessage, Modal } from '../app/ui';
import { IMAGE_PLACEHOLDER } from '../engine/blocks';
import { setImage } from '../engine/operations';

/** Imagens já usadas na página (derivadas do modelo, sem lista paralela). */
function pageImages(editor: Editor): string[] {
  const out = new Set<string>();
  const walk = (c: Component) => {
    if (c.is('image')) {
      const src = String(c.get('src') ?? c.getAttributes().src ?? '');
      if (src && src !== IMAGE_PLACEHOLDER) out.add(src);
    }
    c.components().models.forEach(walk);
  };
  const wrapper = editor.getWrapper();
  if (wrapper) walk(wrapper);
  return [...out];
}

export function ImageDialog({ editor, target, projectId, workspaceId, urls, onClose }: { editor: Editor; target: Component | null; projectId: string; workspaceId?: string; urls: AssetUrlMap; onClose: () => void }) {
  const { assets, mode } = useServices();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [over, setOver] = useState(false);

  const apply = (src: string) => {
    if (!target) return;
    setImage(editor, target.getId(), { src });
    setError(null);
    setUrl('');
    onClose();
  };

  const upload = async (file: File | undefined) => {
    if (!file || !target) return;
    setBusy(true);
    setError(null);
    try {
      const uploaded = await assets.upload(file, { projectId, ...(workspaceId ? { workspaceId } : {}) });
      // O canvas mostra o URL; a gravação volta a usar a referência estável.
      urls.register(uploaded.stored, uploaded.display);
      apply(uploaded.display);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const useUrl = (e: FormEvent) => {
    e.preventDefault();
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol !== 'https:') throw new Error('Use um endereço https://');
      apply(parsed.toString());
    } catch (err) {
      setError(err instanceof TypeError ? 'Endereço inválido.' : errorMessage(err));
    }
  };

  const current = target ? String(target.get('src') ?? '') : '';
  const used = target ? pageImages(editor).filter((s) => s !== current) : [];

  return (
    <Modal open={target !== null} title="Escolher imagem" onClose={onClose}>
      {current && <img className="img-thumb" src={current} alt="Imagem atual" />}
      <div
        className={`drop-zone ${over ? 'is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files[0]);
        }}
      >
        <Upload aria-hidden="true" />
        <div>Arraste uma imagem para aqui ou</div>
        <Button variant="primary" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'A carregar…' : 'Carregar do computador'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          className="sr-only"
          data-testid="image-file-input"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        <span className="hint">
          PNG, JPEG, WebP, GIF ou AVIF até 8 MB.{' '}
          {mode === 'server' ? 'A imagem é enviada para o armazenamento do projeto.' : 'Em modo local, a imagem fica guardada dentro do projeto, neste browser.'}
        </span>
      </div>
      <form onSubmit={useUrl} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: 1 }}>
          <span>Ou usar um endereço de imagem</span>
          <input className="input" type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <Button type="submit" disabled={!url.trim()}>
          Usar
        </Button>
      </form>
      {used.length > 0 && (
        <div className="field">
          <span className="field-label">Imagens já usadas nesta página</span>
          <div className="asset-grid">
            {used.map((src) => (
              <button key={src} type="button" onClick={() => apply(src)} aria-label="Usar esta imagem">
                <img src={src} alt="" />
              </button>
            ))}
          </div>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
