import { z } from 'zod';

/**
 * Geração de imagens: contrato comum aos fornecedores. A imagem volta SEMPRE em base64 (nunca um
 * endereço temporário do fornecedor); o editor carrega-a no armazenamento do workspace e só a
 * referência permanente fica no documento, depois de o utilizador aprovar.
 */
export const IMAGE_ASPECTS = ['1:1', '16:9', '4:3', '3:4', '9:16'] as const;

export const AiImageRequest = z
  .object({
    contract: z.literal(1),
    requestId: z.uuid(),
    projectId: z.string().min(1).max(80),
    prompt: z.string().trim().min(3).max(1000),
    aspect: z.enum(IMAGE_ASPECTS),
    /**
     * Versão do frontend: 2 = aceita respostas SEM custo (utilizadores comuns). Sem este campo, é
     * um separador aberto com o frontend anterior, que exige o custo na resposta.
     */
    client: z.literal(2).optional(),
  })
  .strict();
export type AiImageRequest = z.infer<typeof AiImageRequest>;

/** Mensagem para separadores abertos com a versão anterior (sem o campo `client`). */
export const OUTDATED_CLIENT_MESSAGE =
  'Esta página está numa versão anterior do Bolt IA. Espere por «Alterações guardadas» e recarregue a página (F5) para gerar imagens. Nada foi gerado nem cobrado.';

export type ImageRequest = Pick<AiImageRequest, 'prompt' | 'aspect'>;

export const AiImageResponse = z
  .object({
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    base64: z.string().min(16),
    model: z.string().max(80),
    provider: z.string().max(40),
    /** Só para administradores da plataforma (os outros utilizadores não recebem valores). */
    costUsd: z.number().nonnegative().optional(),
    /** O custo é o teto (o fornecedor não indicou o consumo). Só para administradores. */
    estimated: z.boolean().optional(),
    simulated: z.boolean(),
  })
  .strict();
export type AiImageResponse = z.infer<typeof AiImageResponse>;

export interface GeneratedImage {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
  /** Tokens indicados pelo fornecedor (quando o preço é por token). */
  tokens: { input: number; output: number } | null;
}

export interface ImageGenerator {
  readonly model: string;
  generate(req: ImageRequest, timeoutMs: number): Promise<GeneratedImage>;
}

/** Tamanho máximo aceite de uma imagem gerada (base64), para não sobrecarregar a resposta. */
export const MAX_IMAGE_BASE64 = 12_000_000;
