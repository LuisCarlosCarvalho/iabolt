import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({ variant = 'secondary', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={`btn btn-${variant} ${className}`} {...rest} />;
}

/** Botão só com ícone: o `label` é obrigatório (acessibilidade e dica). */
export function IconButton({ label, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" className={`icon-btn ${className}`} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

export function Spinner({ label = 'A carregar…' }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <span className="spinner-dot" aria-hidden="true" />
      <span className="spinner-label">{label}</span>
    </span>
  );
}

export function StatePanel({ icon, title, children, actions }: { icon?: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="state-panel">
      {icon && <div className="state-icon">{icon}</div>}
      <h2>{title}</h2>
      {children && <div className="state-text">{children}</div>}
      {actions && <div className="state-actions">{actions}</div>}
    </div>
  );
}

/** Diálogo modal nativo (foco preso, Esc fecha). */
export function Modal({ open, title, onClose, children, footer, wide = false }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} onClose={onClose} aria-label={title}>
      {open && (
        <>
          <header className="modal-head">
            <h2>{title}</h2>
            <IconButton label="Fechar" onClick={onClose}>
              ✕
            </IconButton>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-foot">{footer}</footer>}
        </>
      )}
    </dialog>
  );
}

const rtf = new Intl.RelativeTimeFormat('pt-PT', { numeric: 'auto' });
const dtf = new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeStyle: 'short' });

export function formatDateTime(iso: string): string {
  return dtf.format(new Date(iso));
}

export function formatRelative(iso: string, now: Date = new Date()): string {
  const diff = (new Date(iso).getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'agora mesmo';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return formatDateTime(iso);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
