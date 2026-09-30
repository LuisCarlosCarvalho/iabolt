/**
 * Fornecedores com adaptador IMPLEMENTADO (ver registry.ts). Módulo sem dependências, para o
 * painel e o editor importarem só os identificadores e nomes.
 */
export const PROVIDER_IDS = ['anthropic', 'openai', 'google'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_LABEL: Record<ProviderId, string> = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google Gemini' };

export const isProviderId = (v: unknown): v is ProviderId => PROVIDER_IDS.some((p) => p === v);
