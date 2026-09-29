import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/**
 * Bateria de pedidos REAIS ao piloto do Assistente IA (`npm run test:ai-pilot`). Tem custo.
 * Só corre com BOLT_AI_PILOT=1, depois de publicar a função e configurar a chave (docs/14).
 * Separada de `npm test`/`npm run check`, que nunca contactam serviços externos.
 */
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/ai-pilot/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
