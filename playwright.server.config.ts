import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Testes E2E contra o SUPABASE REAL (`npm run test:e2e:server`). Lê `.env.local`:
 * VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY e as contas de teste BOLT_TEST_USER_A/B_*.
 * Arranca uma instância própria na porta 5176 (o servidor de desenvolvimento em 5173 não é tocado).
 */
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const PORT = 5176;

export default defineConfig({
  testDir: 'tests/e2e-server',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-server' }]],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
