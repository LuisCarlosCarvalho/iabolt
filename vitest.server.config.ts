import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/**
 * Testes de API contra o SUPABASE REAL (`npm run test:server`). Lê `.env.local`.
 * Separados de `npm test`/`npm run check`, que nunca contactam serviços externos.
 */
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/server/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
