import { useEffect, useMemo, useState } from 'react';
import type { AiStatus } from '../admin/aiAdminClient';
import { ServerImageGenerator, ServerProposer, SimulatedImageGenerator, SimulatedProposer, type ImageGenerator, type Proposer } from '../ai/proposers';
import { useServices } from '../app/services';

/**
 * Modo local: simuladores (proposta e imagens). Modo servidor: só existe se a configuração central
 * o tiver ativo (ai_status). Mesmo com o editor aberto, desativar no painel bloqueia os pedidos
 * seguintes no servidor. Usado pelo painel do assistente e pela janela rápida «Editar com IA».
 */
export function useAssistant(): { proposer: Proposer | null; images: ImageGenerator | null; status: AiStatus | null } {
  const { mode, auth, ai } = useServices();
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    let alive = true;
    ai.status()
      .then((st) => alive && setStatus(st))
      .catch(() => alive && setStatus({ enabled: false, modelLabel: null }));
    return () => {
      alive = false;
    };
  }, [ai]);
  return useMemo(() => {
    if (mode === 'local') return { proposer: new SimulatedProposer(), images: new SimulatedImageGenerator(), status };
    if (!auth || !status?.enabled) return { proposer: null, images: null, status };
    const images = status.image?.enabled && status.image.priceUsd !== null ? new ServerImageGenerator(auth.client, status.image.label ?? 'Imagens', status.image.priceUsd) : null;
    return { proposer: new ServerProposer(auth.client, status.modelLabel ?? 'Assistente IA'), images, status };
  }, [mode, auth, status]);
}
