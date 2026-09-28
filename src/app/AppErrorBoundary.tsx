import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Última linha de defesa: erro inesperado mostra uma mensagem compreensível em vez de ecrã vazio. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Erro na aplicação', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="page">
        <div className="state-panel">
          <h2>Algo correu mal</h2>
          <div className="state-text">{this.state.error.message}</div>
          <div className="state-actions">
            <a className="btn btn-primary" href="/">
              Voltar aos projetos
            </a>
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              Recarregar
            </button>
          </div>
        </div>
      </main>
    );
  }
}
