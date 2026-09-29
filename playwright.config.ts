import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Testes E2E do MODO LOCAL. Arrancam uma instância própria na porta 5175 com as variáveis
 * do Supabase vazias (têm prioridade sobre `.env.local`), para testar sempre o modo local
 * e nunca interferir com o servidor de desenvolvimento em 5173.
 */
const PORT = 5175;

/**
 * Artefactos (traces, vídeos, capturas, relatório) FORA da pasta do projeto: a pasta está no
 * OneDrive, cuja sincronização bloqueava ficheiros de trace durante os testes («UNKNOWN: open»).
 * Os traces continuam a ser guardados nas falhas. Pode mudar-se o destino com BOLT_PW_ARTIFACTS.
 */
const ARTIFACTS = process.env.BOLT_PW_ARTIFACTS ?? join(tmpdir(), 'bolt-ia-playwright');

export default defineConfig({
  outputDir: join(ARTIFACTS, 'test-results'),
  testDir: 'tests/e2e',
  fullyParallel: false,
  // 4 workers: com 8 (metade dos 16 núcleos lógicos), editor + canvas + servidor Vite na mesma máquina
  // deixavam percursos longos acima dos 30 s por teste, de forma aleatória (sem erro de asserção).
  workers: 4,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: join(ARTIFACTS, 'report') }]],
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
