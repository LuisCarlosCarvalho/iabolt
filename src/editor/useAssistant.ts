import { useEffect, useMemo, useState } from 'react';
import type { AiStatus } from '../admin/aiAdminClient';
import { ServerImageGenerator, ServerProposer, SimulatedImageGenerator, SimulatedProposer, type ImageGenerator, type Proposer } from '../ai/proposers';
import { useServices } from '../app/services';

/**
 * Modo local: simuladores (proposta e imagens). Modo servidor: só existe se a configuração central
 * o tiver ativo (ai_status). Mesmo com o editor aberto, desativar no painel bloqueia os pedidos
 * seguintes no servidor. Usado pelo painel do assistente e pela janela rápida «Editar com IA».
 *
 * `admin`: administrador da plataforma (platform_admins). Só ele vê valores financeiros (custos,
 * preços); o servidor também só lhos envia a ele. Os limites e a contabilização são iguais para todos.
 */
export function useAssistant(): { proposer: Proposer | null; images: ImageGenerator | null; status: AiStatus | null; admin: boolean } {
  const { mode, auth, ai } = useServices();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let alive = true;
    ai.status()
      .then((st) => alive && setStatus(st))
      .catch(() => alive && setStatus({ enabled: false, modelLabel: null }));
    ai.isAdmin()
      .then((a) => alive && setAdmin(a))
      .catch(() => alive && setAdmin(false));
    return () => {
      alive = false;
    };
  }, [ai]);
  return useMemo(() => {
    if (mode === 'local') {
      // Imagens simuladas, salvo se o estado local as der como não configuradas (teste da mensagem).
      const images = status?.image?.enabled === false ? null : new SimulatedImageGenerator();
      return { proposer: new SimulatedProposer(), images, status, admin };
    }
    if (!auth || !status?.enabled) return { proposer: null, images: null, status, admin };
    const images = status.image?.enabled ? new ServerImageGenerator(auth.client, status.image.label ?? 'Imagens', status.image.priceUsd) : null;
    return { proposer: new ServerProposer(auth.client, status.modelLabel ?? 'Assistente IA'), images, status, admin };
  }, [mode, auth, status, admin]);
}
