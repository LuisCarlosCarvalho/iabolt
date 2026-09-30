import { googleCheck, googleImageGenerator, googleProvider, googleRequestBody } from './google.ts';
import type { ImageGenerator } from './images.ts';
import { openaiCheck, openaiImageGenerator, openaiProvider, openaiRequestBody } from './openai.ts';
import { SYSTEM_PROMPT } from './prompt.ts';
import { anthropicCheck, anthropicProvider, requestBody as anthropicRequestBody, type AiProvider, type FetchLike, type KeyCheck } from './provider.ts';

/**
 * Registo dos fornecedores com adaptador IMPLEMENTADO. Só estes aparecem no painel.
 *
 * Para acrescentar um fornecedor (extensão documentada em docs/18):
 *  1. um adaptador com `propose` (e, se gerar imagens, `generate`) e um teste sem custo (`check`),
 *     com os parâmetros confirmados na documentação oficial desse fornecedor;
 *  2. uma entrada aqui;
 *  3. uma migração que o acrescente a `ai_models`/`ai_provider_keys` (com preços oficiais);
 *  4. testes do pedido enviado e das respostas (com e sem ferramenta, erros).
 * Não existe compatibilidade genérica com «qualquer API»: cada fornecedor tem o seu adaptador.
 */
import type { ProviderId } from './ids.ts';
export { isProviderId, PROVIDER_IDS, PROVIDER_LABEL, type ProviderId } from './ids.ts';

interface AdapterOpts {
  apiKey: string;
  model: string;
  fetch: FetchLike;
}

export function makeEditProvider(provider: ProviderId, o: AdapterOpts): AiProvider {
  switch (provider) {
    case 'anthropic':
      return anthropicProvider(o);
    case 'openai':
      return openaiProvider(o);
    case 'google':
      return googleProvider(o);
  }
}

/** Gerador de imagens do fornecedor, ou null se esse fornecedor não gera imagens (Anthropic). */
export function makeImageGenerator(provider: ProviderId, o: AdapterOpts): ImageGenerator | null {
  switch (provider) {
    case 'anthropic':
      return null;
    case 'openai':
      return openaiImageGenerator(o);
    case 'google':
      return googleImageGenerator(o);
  }
}

/** Teste sem custo da chave e do modelo (a Anthropic verifica também o formato do pedido). */
export function checkProviderKey(provider: ProviderId, o: AdapterOpts & { kind: 'edit' | 'image' }): Promise<KeyCheck> {
  switch (provider) {
    case 'anthropic':
      return anthropicCheck(o);
    case 'openai':
      return openaiCheck(o);
    case 'google':
      return googleCheck(o);
  }
}

/**
 * Tudo o que é enviado ao fornecedor numa tentativa, tal como sai no corpo do pedido (base do
 * limite de tokens de entrada da reserva).
 */
export function sentTextFor(provider: ProviderId, model: string, user: string, maxOutputTokens: number): string {
  switch (provider) {
    case 'anthropic':
      return JSON.stringify(anthropicRequestBody(model, SYSTEM_PROMPT, user));
    case 'openai':
      return JSON.stringify(openaiRequestBody(model, SYSTEM_PROMPT, user, maxOutputTokens));
    case 'google':
      return JSON.stringify(googleRequestBody(model, SYSTEM_PROMPT, user, maxOutputTokens));
  }
}
