import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  // Amostras ZIP lidas nos testes (`?inline`); a aplicação não importa ficheiros .zip.
  assetsInclude: ['**/*.zip'],
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts', 'tests/db/**/*.test.ts'],
  },
});
