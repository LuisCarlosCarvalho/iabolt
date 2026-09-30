import type { AiProposeRequest } from '../../supabase/functions/_shared/ai/contract.ts';
import { utf8Bytes } from '../../supabase/functions/_shared/ai/limits.ts';
import { SYSTEM_PROMPT, toolInputSchema, userMessage } from '../../supabase/functions/_shared/ai/prompt.ts';
import type { AiStatus } from '../admin/aiAdminClient';

/**
 * Custo MÁXIMO estimado de um pedido, mostrado ANTES de enviar. Mesma fórmula da reserva do
 * servidor (todos os bytes enviados + margem do fornecedor ao preço mais alto de entrada, a saída
 * máxima, todas as tentativas), com 15 % de folga para a estrutura do pedido de cada fornecedor.
 * O servidor volta a calcular e reserva o valor exato; esta estimativa só informa.
 */
export function estimateRequestUsd(pricing: NonNullable<AiStatus['pricing']>, req: AiProposeRequest): number {
  const bytes = utf8Bytes(SYSTEM_PROMPT + JSON.stringify(toolInputSchema()) + userMessage(req)) * 1.15;
  const p = pricing.prices;
  const attempt = ((bytes + pricing.overheadTokens) * Math.max(p.input, p.cacheWrite) + pricing.maxOutputTokens * p.output) / 1_000_000;
  return Math.ceil(attempt * (pricing.maxRetries + 1) * 10_000) / 10_000;
}

export const formatUsd = (n: number) => `${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USD`;
