import { expect, test, type Page } from '@playwright/test';

/** Prova técnica da Fase 0 (rota de diagnóstico): selecionar no canvas, subir ao pai, duplicar, guardar, F5, confirmar. */
const frame = (page: Page) => page.frameLocator('.gjs-frame');

test('selecionar → pai → duplicar → guardar → F5 mantém identidade e conteúdo', async ({ page }) => {
  await page.goto('/prova-tecnica');
  await expect(page.getByTestId('save-state')).toHaveText('Guardado');
  await expect(page.getByTestId('revision')).toHaveText('rev 0');

  await frame(page).locator('#hero-title').click();
  await expect(page.getByTestId('selected-id')).toHaveText('sel hero-title');

  await page.getByTestId('select-parent').click();
  await expect(page.getByTestId('selected-id')).toHaveText('sel hero');

  await page.getByTestId('duplicate').click();
  const cloneId = ((await page.getByTestId('selected-id').textContent()) ?? '').replace('sel ', '');
  expect(cloneId).not.toBe('');
  expect(cloneId).not.toBe('hero');
  await expect(frame(page).locator('section[data-bolt-type="section"]')).toHaveCount(2);

  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-state')).toHaveText('Guardado');
  await expect(page.getByTestId('revision')).not.toHaveText('rev 0');
  const projectUrl = page.url();

  await page.reload();
  expect(page.url()).toBe(projectUrl);
  await expect(frame(page).locator('section[data-bolt-type="section"]')).toHaveCount(2);
  await expect(frame(page).locator(`#${cloneId}`)).toBeVisible();
  await expect(frame(page).locator('#hero-title')).toHaveText('Websites que convertem');
  await expect(frame(page).locator('#logo-text')).toHaveText('Blue Bolt');
  await expect(frame(page).locator('img#logo-img')).toHaveCount(1);
});

test('eliminar e desfazer no browser', async ({ page }) => {
  await page.goto('/prova-tecnica');
  await expect(page.getByTestId('save-state')).toHaveText('Guardado');
  await frame(page).locator('#hero-text').click();
  await page.getByTestId('delete').click();
  await expect(frame(page).locator('#hero-text')).toHaveCount(0);
  await expect(page.getByTestId('selected-id')).toHaveText('sel hero-cta');
  await page.getByTestId('undo').click();
  await expect(frame(page).locator('#hero-text')).toHaveCount(1);
});
