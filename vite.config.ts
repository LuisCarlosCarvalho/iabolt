import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Identificador do build (commit na Vercel; senão a hora do build): embutido na aplicação e gravado
 * em `version.json`, para os separadores abertos com uma versão anterior pedirem para recarregar.
 */
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA ?? `local-${Date.now()}`;

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'bolt-version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
      },
    },
  ],
  define: { __BOLT_BUILD__: JSON.stringify(BUILD_ID) },
  server: { port: 5173, strictPort: true },
  // Amostras ZIP lidas nos testes (`?inline`); a aplicação não importa ficheiros .zip.
  assetsInclude: ['**/*.zip'],
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts', 'tests/db/**/*.test.ts'],
  },
});
