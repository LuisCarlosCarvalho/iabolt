import type { Component, Editor } from 'grapesjs';
import { Upload } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import type { AssetUrlMap } from '../assets/assetRefs';
import { ACCEPTED_IMAGE_TYPES } from '../assets/assetStore';
import { useServices } from '../app/services';
import { Button, errorMessage, Modal } from '../app/ui';
import { setImage } from '../engine/operations';
import { setOwnStyle, type DeviceId } from '../engine/styles';
import { httpsImageUrl, pageImages, useImageUpload } from './images';

/** URL dentro de `url("...")` de um valor de background-image (o primeiro). */
function cssUrl(value: string): string {
  const m = /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(value);
  return m?.[2] ?? '';
}

export function ImageDialog({
  editor,
  target,
  projectId,
  workspaceId,
  urls,
  onClose,
  background,
}: {
  editor: Editor;
  target: Component | null;
  projectId: string;
  workspaceId?: string;
  urls: AssetUrlMap;
  onClose: () => void;
  /** Modo «imagem de fundo»: grava em background-image do elemento, no dispositivo indicado. */
  background?: { device: DeviceId };
}) {
  const { mode } = useServices();
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload: uploadFile, busy, error, setError } = useImageUpload({ projectId, ...(workspaceId ? { workspaceId } : {}), urls });
  const [url, setUrl] = useState('');
  const [over, setOver] = useState(false);

  const apply = (src: string) => {
    if (!target) return;
    if (background) setOwnStyle(editor, target, background.device, { 'background-image': `url("${src}")` });
    else setImage(editor, target.getId(), { src });
    setError(null);
    setUrl('');
    onClose();
  };

  const upload = async (file: File | undefined) => {
    if (!target) return;
    const src = await uploadFile(file);
    if (inputRef.current) inputRef.current.value = '';
    if (src) apply(src);
  };

  const useUrl = (e: FormEvent) => {
    e.preventDefault();
    try {
      apply(httpsImageUrl(url));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const bgNow = (() => {
    const el = target?.getEl();
    return el?.ownerDocument?.defaultView?.getComputedStyle(el).backgroundImage ?? '';
  })();
  const current = target ? (background ? cssUrl(bgNow) : String(target.get('src') ?? '')) : '';
  const used = target ? pageImages(editor).filter((s) => s !== current) : [];

  return (
    <Modal open={target !== null} title={background ? 'Imagem de fundo' : 'Escolher imagem'} onClose={onClose}>
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
