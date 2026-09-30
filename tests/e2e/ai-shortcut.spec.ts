import { expect, test, type Page } from '@playwright/test';

/**
 * [simulado] Atalho «Editar com IA» na barra contextual (modo local, sem rede): abre o MESMO
 * painel do assistente com o elemento selecionado; não altera o documento nem o histórico.
 */
const SAVED = 'Alterações guardadas neste browser';
const frame = (page: Page) => page.frameLocator('.gjs-frame');

async function createNimbus(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Usar este template' }).first().click();
  await page.getByRole('dialog').getByLabel('Nome do projeto').fill('Atalho IA');
  await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
}

test('[simulado] «Editar com IA» na barra do elemento: texto, imagem, botão e contentor, sem alterar o documento', async ({ page }) => {
  await createNimbus(page);
  // Começa noutra ferramenta: o atalho tem de abrir o painel do assistente.
  await page.getByTestId('tool-layers').click();
  const cases: Array<{ target: ReturnType<ReturnType<typeof frame>['locator']>; name: RegExp }> = [
    { target: frame(page).locator('h1').first(), name: /Título/ },
    { target: frame(page).locator('img').first(), name: /Imagem/ },
    { target: frame(page).locator('a.bolt-btn').first(), name: /Botão/ },
    { target: frame(page).locator('section').first(), name: /Secção|Contentor/ },
  ];
  for (const c of cases) {
    await c.target.click({ position: { x: 4, y: 4 } });
    const btn = page.getByTestId('ct-ai');
    await expect(btn).toHaveAttribute('title', 'Editar com IA');
    await expect(btn).toHaveAccessibleName('Editar com IA');
    await btn.click();
    await expect(page.getByTestId('left-panel')).toHaveAttribute('data-tool', 'ai');
    await expect(page.getByTestId('ai-scope-name')).toContainText(c.name);
    // O nome no painel é o do elemento selecionado na barra (mesma seleção).
    await expect(page.getByTestId('ai-scope-name')).toContainText((await page.getByTestId('canvas-toolbar-name').textContent()) ?? '');
    await expect(page.getByTestId('ai-instruction')).toBeFocused();
  }
  // Nada mudou: sem passos de histórico nem gravação pendente.
  await expect(page.getByTestId('undo')).toBeDisabled();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);

  // Teclado: o botão é alcançável e ativável com Enter.
  await page.getByTestId('tool-layers').click();
  await frame(page).locator('h1').first().click();
  await page.getByTestId('ct-ai').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-tool', 'ai');
  await expect(page.getByTestId('undo')).toBeDisabled();
});
