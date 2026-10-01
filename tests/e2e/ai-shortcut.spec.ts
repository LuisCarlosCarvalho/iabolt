import { expect, test, type Page } from '@playwright/test';

/**
 * [simulado] «Editar com IA» na barra do elemento (modo local, sem rede): abre uma janela pequena
 * junto ao botão; «Alterar» aplica logo a proposta validada (um só «Desfazer»). O que precisa de
 * decisão (esclarecimento, imagens) não é aplicado e segue para o painel («Mais opções»).
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

test('[simulado] janela rápida: abrir sem alterar nada, «Mais opções» leva o texto para o painel, teclado', async ({ page }) => {
  await createNimbus(page);
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
    await btn.click();
    const quick = page.getByTestId('ai-quick');
    await expect(quick).toBeVisible();
    await expect(quick).toContainText(c.name);
    await expect(page.getByTestId('ai-quick-input')).toBeFocused();
    await expect(quick).toContainText('Simulador: sem custo.');
    await expect(page.getByTestId('ai-quick-apply')).toBeDisabled(); // sem texto
    await page.keyboard.press('Escape');
    await expect(quick).toBeHidden();
  }
  // Nada mudou: sem passos de histórico nem gravação pendente.
  await expect(page.getByTestId('undo')).toBeDisabled();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);

  // «Mais opções»: o painel completo, com o mesmo âmbito e o texto já escrito.
  await frame(page).locator('h1').first().click();
  await page.getByTestId('ct-ai').click();
  await page.getByTestId('ai-quick-input').fill('texto: Do atalho');
  await page.getByTestId('ai-quick-more').click();
  await expect(page.getByTestId('ai-quick')).toBeHidden();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-tool', 'ai');
  await expect(page.getByTestId('ai-scope-name')).toContainText('Título');
  await expect(page.getByTestId('ai-instruction')).toHaveValue('texto: Do atalho');
  await expect(page.getByTestId('ai-instruction')).toBeFocused();
  await expect(page.getByTestId('undo')).toBeDisabled();
});

test('[simulado] janela rápida: «Alterar» aplica logo, um só «Desfazer», e o que pede decisão não é aplicado', async ({ page }) => {
  await createNimbus(page);
  const h1 = frame(page).locator('h1').first();
  const original = (await h1.textContent()) ?? '';

  // Alterar: texto e cor aplicados de imediato (Ctrl+Enter também envia).
  await h1.click();
  await page.getByTestId('ct-ai').click();
  // A janela não tapa o elemento que edita e fica dentro do canvas.
  const quickBox = await page.getByTestId('ai-quick').boundingBox();
  const hostBox = await page.locator('.canvas-wrap').boundingBox();
  const h1Box = await h1.boundingBox();
  if (!quickBox || !hostBox || !h1Box) throw new Error('caixas');
  const overlaps = quickBox.x < h1Box.x + h1Box.width && quickBox.x + quickBox.width > h1Box.x && quickBox.y < h1Box.y + h1Box.height && quickBox.y + quickBox.height > h1Box.y;
  expect(overlaps).toBe(false);
  expect(quickBox.y + quickBox.height).toBeLessThanOrEqual(hostBox.y + hostBox.height);
  await page.getByTestId('ai-quick-input').fill('texto: Alterado pela IA; cor #b91c1c');
  await page.getByTestId('ai-quick-input').press('Control+Enter');
  await expect(h1).toHaveText('Alterado pela IA');
  await expect.poll(() => h1.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(185, 28, 28)');
  await expect(page.getByTestId('ai-quick-result')).toContainText('Alterado (2)');
  await expect(page.getByTestId('ai-quick-hidden')).toHaveCount(0);
  await expect(page.getByTestId('ai-quick-input')).toHaveValue('');
  expect(await page.evaluate(() => window.__boltAiLastRequest?.scope.kind)).toBe('element');

  // Desfazer na janela: um passo repõe texto e cor.
  await page.getByTestId('ai-quick-undo').click();
  await expect(h1).toHaveText(original);
  await expect(page.getByTestId('ai-quick-result')).toContainText('Alteração desfeita.');
  await page.getByTestId('redo').click();
  await expect(h1).toHaveText('Alterado pela IA');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText(SAVED);
  await page.reload();
  await expect(frame(page).locator('h1').first()).toHaveText('Alterado pela IA');

  // Esclarecimento: nada aplicado; segue para o painel.
  await frame(page).locator('h1').first().click();
  await page.getByTestId('ct-ai').click();
  await page.getByTestId('ai-quick-input').fill('[simulado:ambiguo] muda a imagem');
  await page.getByTestId('ai-quick-apply').click();
  await expect(page.getByTestId('ai-quick-result')).toContainText('Que imagem quer alterar?');
  await expect(page.getByTestId('ai-quick-result')).toContainText('Nada foi alterado.');
  await expect(page.getByTestId('undo')).toBeDisabled();
  await page.keyboard.press('Escape');

  // Imagem a escolher: nada aplicado; segue para o painel.
  await frame(page).locator('img').first().click();
  await page.getByTestId('ct-ai').click();
  await page.getByTestId('ai-quick-input').fill('imagem: escolher');
  await page.getByTestId('ai-quick-apply').click();
  await expect(page.getByTestId('ai-quick-result')).toContainText('precisa de escolher ou carregar imagens');
  await expect(page.getByTestId('undo')).toBeDisabled();

  // Proposta inválida: mensagem e nada alterado.
  await page.getByTestId('ai-quick-input').fill('[simulado:invalido] x');
  await page.getByTestId('ai-quick-apply').click();
  await expect(page.getByTestId('ai-quick-error')).toBeVisible();
  await expect(page.getByTestId('undo')).toBeDisabled();
});
