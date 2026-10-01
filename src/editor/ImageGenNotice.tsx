import { Info } from 'lucide-react';
import type { AiStatus } from '../admin/aiAdminClient';
import { Button } from '../app/ui';

/**
 * Geração de imagens indisponível: a CAUSA concreta. Ao administrador diz exatamente o que configurar
 * (e dá acesso às «Configurações de IA»); aos outros utilizadores, que a geração está indisponível e
 * que devem contactar o administrador. Nunca apresenta carregar/escolher como resposta a um pedido
 * de geração.
 */
export function imageSetupHint(status: AiStatus | null): string {
  const img = status?.image;
  if (!img?.provider || !img.model) {
    return 'Falta escolher o fornecedor e o modelo de imagens (passo 3, «Imagens»). Os modelos suportados são os Gemini da Google, que precisam da chave Google em «Credenciais» (passo 1). Depois ative «Geração de imagens».';
  }
  const who = img.label ?? img.model;
  return `O modelo de imagens escolhido é ${who} (${img.provider}). Confirme que a chave desse fornecedor está reconhecida em «Credenciais» (passo 1) e ative «Geração de imagens» (passo 3).`;
}

export function ImageGenNotice({ admin, status, onConfigure, testId = 'ai-image-unavailable' }: { admin: boolean; status: AiStatus | null; onConfigure?: () => void; testId?: string }) {
  return (
    <div className="ai-quick-warn" role="note" data-testid={testId}>
      <Info aria-hidden="true" />
      <div>
        <strong>A geração de imagens com IA não está {admin ? 'configurada' : 'disponível'}.</strong>
        {admin ? (
          <>
            <p>{imageSetupHint(status)}</p>
            {onConfigure && (
              <Button variant="ghost" onClick={onConfigure} data-testid="ai-image-configure">
                Abrir Configurações de IA
              </Button>
            )}
          </>
        ) : (
          <p>Contacte o administrador da plataforma para a ativar.</p>
        )}
      </div>
    </div>
  );
}
