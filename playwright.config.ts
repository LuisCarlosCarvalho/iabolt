import { defineConfig, devices } from '@playwright/test';

/**
 * Testes E2E do MODO LOCAL. Arrancam uma instância própria na porta 5175 com as variáveis
 * do Supabase vazias (têm prioridade sobre `.env.local`), para testar sempre o modo local
 * e nunca interferir com o servidor de desenvolvimento em 5173.
 */
const PORT = 5175;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
