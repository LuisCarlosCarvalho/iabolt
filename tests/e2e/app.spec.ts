import { expect, test, type Page } from '@playwright/test';

/**
 * Percurso principal do Bolt IA no browser real (modo local, IndexedDB).
 * Cada teste corre num contexto de browser novo: base local vazia.
 */
const frame = (page: Page) => page.frameLocator('.gjs-frame');
const layer = (page: Page, text: string) => page.getByTestId('layer-row').filter({ hasText: text }).first();

// PNG 1×1 válido (vermelho), para o fluxo real de carregar imagem.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

async function createFromTemplate(page: Page, index: number, name: string) {
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Usar este template' }).nth(index).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome do projeto').fill(name);
  await dialog.getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page).toHaveURL(/\/projetos\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');
}

async function saveAndConfirm(page: Page) {
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');
}

test('abrir a aplicação sem parâmetros mostra a lista vazia e não cria projetos', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ainda não tem projetos' })).toBeVisible();
  await expect(page.getByText('Modo local · só neste browser')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ainda não tem projetos' })).toBeVisible();
  await expect(page.getByTestId('project-card')).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

test('template → projeto → editar → guardar → lista → reabrir mantém todas as alterações', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Novo projeto' }).click();
  await expect(page).toHaveURL(/\/templates$/);
  await createFromTemplate(page, 0, 'Campanha Outono');
  const projectUrl = page.url();

  // 1. Editar o título pelo painel de propriedades.
  await layer(page, 'Decisões de marketing').click();
  await expect(page.getByTestId('selected-name')).toHaveText('Título');

  // Nenhum identificador técnico na interface principal: o id e a revisão só existem no diagnóstico (fechado).
  const selectedId = (await page.getByTestId('diag-selected').textContent()) ?? '';
  expect(selectedId).toMatch(/\S/);
  await expect(page.getByTestId('diag-selected')).toBeHidden();
  for (const area of ['.editor-top', '[data-testid="context-bar"]', '.side-left', '.props-head']) {
    await expect(page.locator(area)).not.toContainText(selectedId);
  }
  await expect(page.locator('.editor-top')).not.toContainText(/\brev\b/i);
  await page.getByTestId('prop-text').fill('Campanhas que vendem no outono');
  await page.getByTestId('prop-text').press('Tab');
  await expect(frame(page).locator('h1')).toHaveText('Campanhas que vendem no outono');

  // 2. Cor do título (estilo próprio no computador).
  await page.getByRole('textbox', { name: 'Cor do texto', exact: true }).fill('#dc2626');
  await page.getByRole('textbox', { name: 'Cor do texto', exact: true }).press('Enter');
  await expect(frame(page).locator('h1')).toHaveCSS('color', 'rgb(220, 38, 38)');

  // 3. Selecionar pai sobe um nível de cada vez até à secção do hero; duplicar a secção.
  const parents = ['Coluna', 'Colunas', 'Contentor', 'Secção'];
  for (const name of parents) {
    await page.getByTestId('select-parent').click();
    await expect(page.getByTestId('selected-name')).toHaveText(name);
  }
  await expect(frame(page).locator('section[data-bolt-type="section"]')).toHaveCount(5);
  await page.getByTestId('duplicate').click();
  await expect(frame(page).locator('section[data-bolt-type="section"]')).toHaveCount(6);
  await expect(frame(page).locator('h1')).toHaveCount(2);

  // 4. Eliminar o botão secundário do hero original (clique no canvas).
  await expect(frame(page).getByText('Ver como funciona', { exact: true })).toHaveCount(2);
  await frame(page).getByText('Ver como funciona', { exact: true }).first().click();
  await expect(page.getByTestId('selected-name')).toHaveText('Botão');
  await page.getByTestId('delete').click();
  await expect(frame(page).getByText('Ver como funciona', { exact: true })).toHaveCount(1);

  // 5. Reordenar: «Clientes» sobe no menu.
  await frame(page).locator('.nb-menu').getByText('Clientes').click();
  await expect(page.getByTestId('selected-name')).toHaveText('Ligação');
  await page.getByTestId('move-up').click();
  await expect(frame(page).locator('.nb-menu a')).toHaveText(['Recursos', 'Clientes', 'Como funciona']);

  // 6. Texto e destino do botão da navegação.
  await frame(page).getByText('Pedir demonstração').click();
  await expect(page.getByTestId('selected-name')).toHaveText('Botão');
  await page.getByTestId('prop-text').fill('Falar connosco');
  await page.getByTestId('prop-text').press('Enter');
  await page.getByTestId('prop-href').fill('mailto:ola@exemplo.pt');
  await page.getByTestId('prop-href').press('Enter');
  const navButton = frame(page).locator('nav a[data-bolt-type="button"]');
  await expect(navButton).toHaveText('Falar connosco');
  await expect(navButton).toHaveAttribute('href', 'mailto:ola@exemplo.pt');
  // Novo separador: marcar logo a seguir a confirmar o destino com Enter.
  const newTab = page.getByLabel('Abrir num novo separador');
  await newTab.check();
  await expect(newTab).toBeChecked();
  await expect(navButton).toHaveAttribute('target', '_blank');

  // 7. Substituir a imagem do hero por um ficheiro carregado.
  await frame(page).locator('img.nb-hero-img').first().click();
  await expect(page.getByTestId('selected-name')).toHaveText('Imagem');
  await page.getByTestId('replace-image').click();
  await page.getByTestId('image-file-input').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(frame(page).locator('img.nb-hero-img').first()).toHaveAttribute('src', /^data:image\/png;base64,/);

  // 8. Pré-visualização por dispositivo.
  await page.getByRole('button', { name: 'Telemóvel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Telemóvel', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(frame(page).locator('.nb-menu').first()).toBeHidden();
  await page.getByRole('button', { name: 'Computador', exact: true }).click();
  await expect(frame(page).locator('.nb-menu').first()).toBeVisible();

  // 9. Guardar e voltar à lista.
  await saveAndConfirm(page);
  await page.getByTestId('back-to-projects').click();
  await expect(page).toHaveURL(/\/$/);
  const card = page.getByTestId('project-card').filter({ hasText: 'Campanha Outono' });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Atualizado agora mesmo');
  await expect(card.locator('iframe')).toBeVisible();

  // 10. Reabrir o mesmo projeto a partir da lista.
  await page.getByRole('link', { name: 'Abrir Campanha Outono' }).click();
  await expect(page).toHaveURL(projectUrl);
  await expect(page.getByRole('textbox', { name: 'Nome do projeto' })).toHaveValue('Campanha Outono');
  await expectEdits(page);

  // 11. E também depois de recarregar a página (F5).
  await page.reload();
  await expectEdits(page);

  // 12. A opção aparece marcada ao reabrir, desmarca-se pela interface e isso também persiste.
  await frame(page).locator('nav a[data-bolt-type="button"]').click();
  await expect(page.getByTestId('selected-name')).toHaveText('Botão');
  const reopenedNewTab = page.getByLabel('Abrir num novo separador');
  await expect(reopenedNewTab).toBeChecked();
  await reopenedNewTab.uncheck();
  await expect(reopenedNewTab).not.toBeChecked();
  await expect(frame(page).locator('nav a[data-bolt-type="button"]')).not.toHaveAttribute('target', /.*/);
  await saveAndConfirm(page);
  await page.reload();
  await expect(frame(page).locator('nav a[data-bolt-type="button"]')).not.toHaveAttribute('target', /.*/);
  await expect(frame(page).locator('nav a[data-bolt-type="button"]')).toHaveAttribute('href', 'mailto:ola@exemplo.pt');
});

async function expectEdits(page: Page) {
  await expect(frame(page).locator('section[data-bolt-type="section"]')).toHaveCount(6);
  await expect(frame(page).locator('h1').first()).toHaveText('Campanhas que vendem no outono');
  await expect(frame(page).locator('h1').first()).toHaveCSS('color', 'rgb(220, 38, 38)');
  await expect(frame(page).getByText('Ver como funciona', { exact: true })).toHaveCount(1);
  await expect(frame(page).locator('.nb-menu a')).toHaveText(['Recursos', 'Clientes', 'Como funciona']);
  await expect(frame(page).locator('nav a[data-bolt-type="button"]')).toHaveAttribute('href', 'mailto:ola@exemplo.pt');
  await expect(frame(page).locator('nav a[data-bolt-type="button"]')).toHaveAttribute('target', '_blank');
  await expect(frame(page).locator('img.nb-hero-img').first()).toHaveAttribute('src', /^data:image\/png;base64,/);
}

test('usar um template cria uma cópia: editar um projeto não altera o template nem outros projetos', async ({ page }) => {
  await createFromTemplate(page, 0, 'Projeto A');
  await layer(page, 'Decisões de marketing').click();
  await page.getByTestId('prop-text').fill('Só no projeto A');
  await page.getByTestId('prop-text').press('Tab');
  await saveAndConfirm(page);

  await createFromTemplate(page, 0, 'Projeto B');
  await expect(frame(page).locator('h1')).toHaveText('Decisões de marketing com dados, não com palpites');

  await page.goto('/templates');
  const tplPreview = page.getByTestId('template-card').nth(1).locator('iframe');
  await expect(tplPreview).toBeVisible();
  await expect(page.getByTestId('template-card').nth(1).frameLocator('iframe').locator('h1')).toHaveText('Decisões de marketing com dados, não com palpites');

  await page.goto('/');
  await expect(page.getByTestId('project-card')).toHaveCount(2);
});

test('o primeiro clique no canvas, logo que o editor está pronto, seleciona o elemento', async ({ page }) => {
  // Regressão: o ajuste de zoom depois do carregamento desligava a seleção por ~300 ms.
  for (const index of [0, 1]) {
    await createFromTemplate(page, index, `Primeiro clique ${index}`);
    await frame(page).locator('img').nth(1).click();
    await expect(page.getByTestId('selected-name')).toHaveText(/Imagem|Logótipo \(imagem\)/);
  }
});

test('com fotogramas lentos, marcar e desmarcar «novo separador» reflete-se logo e no modelo', async ({ page }) => {
  // Regressão: o painel só relia o modelo no fotograma seguinte; com o browser ocupado, o clique
  // no checkbox parecia não ter efeito. Aqui cada fotograma atrasa 400 ms de propósito.
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => window.setTimeout(() => raf(cb), 400);
  });
  await createFromTemplate(page, 0, 'Fotogramas lentos');
  await frame(page).getByText('Pedir demonstração').click();
  await expect(page.getByTestId('selected-name')).toHaveText('Botão');
  await page.getByTestId('prop-href').fill('https://exemplo.pt');
  await page.getByTestId('prop-href').press('Enter');
  const newTab = page.getByLabel('Abrir num novo separador');
  await newTab.check();
  await expect(frame(page).locator('nav a[data-bolt-type="button"]')).toHaveAttribute('target', '_blank');
  await newTab.uncheck();
  await expect(frame(page).locator('nav a[data-bolt-type="button"]')).not.toHaveAttribute('target', /.*/);
  await expect(frame(page).locator('nav a[data-bolt-type="button"]')).toHaveAttribute('href', 'https://exemplo.pt');
});

test('logótipo em imagem continua imagem no template Vértice', async ({ page }) => {
  await createFromTemplate(page, 1, 'Consultoria');
  await frame(page).locator('nav img[data-bolt-role="logo"]').click();
  await expect(page.getByTestId('selected-name')).toHaveText('Logótipo (imagem)');
  await expect(page.getByTestId('replace-image')).toBeVisible();
});

test('página em branco: adicionar secção, colunas, título, texto, imagem e botão, e reabrir', async ({ page }) => {
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Começar em branco' }).click();
  await page.getByRole('dialog').getByLabel('Nome do projeto').fill('Do zero');
  await page.getByRole('dialog').getByRole('button', { name: 'Criar e abrir o editor' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');

  await page.getByTestId('tab-blocks').click();
  await page.getByTestId('block-section').click();
  await expect(page.getByTestId('selected-name')).toHaveText('Secção');
  await page.getByTestId('block-columns').click();
  await expect(page.getByTestId('selected-name')).toHaveText('Colunas');
  await page.getByTestId('block-heading').click();
  await page.getByTestId('block-text').click();
  await page.getByTestId('block-button').click();
  await page.getByTestId('block-image').click();
  // Inserir uma imagem abre logo o fluxo de escolha.
  await page.getByTestId('image-file-input').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('dialog')).toBeHidden();

  const f = frame(page);
  await expect(f.locator('section[data-bolt-type="section"]')).toHaveCount(1);
  await expect(f.locator('[data-bolt-type="columns"] > [data-bolt-type="column"]')).toHaveCount(2);
  await expect(f.getByText('Novo título')).toHaveCount(1);
  await expect(f.locator('a[data-bolt-type="button"]')).toHaveCount(1);
  await expect(f.locator('img[src^="data:image/png"]')).toHaveCount(1);

  await saveAndConfirm(page);
  await page.reload();
  await expect(frame(page).locator('[data-bolt-type="columns"] > [data-bolt-type="column"]')).toHaveCount(2);
  await expect(frame(page).locator('img[src^="data:image/png"]')).toHaveCount(1);
  await expect(frame(page).locator('a[data-bolt-type="button"]')).toHaveText('Botão');
});

test('editar um título diretamente no canvas e desfazer/refazer', async ({ page }) => {
  await createFromTemplate(page, 0, 'Edição direta');
  const h2 = frame(page).locator('h2').first();
  await h2.dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Escrito no canvas');
  // Sair da edição (clicar noutro elemento) sincroniza o texto com o modelo.
  await frame(page).locator('h1').click();
  await expect(h2).toHaveText('Escrito no canvas');
  await saveAndConfirm(page);
  await page.reload();
  await expect(frame(page).locator('h2').first()).toHaveText('Escrito no canvas');

  // Desfazer/refazer numa ação estrutural.
  await frame(page).locator('h1').click();
  await page.getByTestId('delete').click();
  await expect(frame(page).locator('h1')).toHaveCount(0);
  await page.getByTestId('undo').click();
  await expect(frame(page).locator('h1')).toHaveCount(1);
  await page.getByTestId('redo').click();
  await expect(frame(page).locator('h1')).toHaveCount(0);
});

test('arrastar na estrutura reordena; destinos inválidos são recusados; a ordem sobrevive a reabrir', async ({ page }) => {
  await createFromTemplate(page, 0, 'Arrastar');
  const menu = frame(page).locator('.nb-menu a');
  await expect(menu).toHaveText(['Recursos', 'Como funciona', 'Clientes']);

  // «Clientes» largado no topo de «Recursos» passa a ser o primeiro.
  await layer(page, 'Clientes').dragTo(layer(page, 'Recursos'), { targetPosition: { x: 40, y: 2 } });
  await expect(menu).toHaveText(['Clientes', 'Recursos', 'Como funciona']);

  // Uma secção não pode entrar numa coluna: nada muda.
  // Título → Contentor → Contentor → Secção (quarto <li> antepassado da linha do título).
  const sectionRow = layer(page, 'Tudo o que a equipa').locator('xpath=ancestor::li[4]').locator('> .tree-row');
  await expect(sectionRow).toContainText('Secção');
  const structure = () => frame(page).locator('body').evaluate((b) => b.innerHTML.length + ':' + b.querySelectorAll('*').length);
  const before = await structure();
  await sectionRow.dragTo(layer(page, 'Novo · Relat'));
  await expect(frame(page).locator('[data-bolt-type="column"] section')).toHaveCount(0);
  expect(await structure()).toBe(before);

  await saveAndConfirm(page);
  await page.reload();
  await expect(frame(page).locator('.nb-menu a')).toHaveText(['Clientes', 'Recursos', 'Como funciona']);
});

test('Dashboard: mudar o nome e remover um projeto', async ({ page }) => {
  await createFromTemplate(page, 1, 'Nome antigo');
  await page.getByTestId('back-to-projects').click();
  const card = page.getByTestId('project-card');
  await expect(card).toHaveCount(1);

  await card.getByRole('button', { name: 'Opções de Nome antigo' }).click();
  await page.getByRole('menuitem', { name: 'Mudar o nome' }).click();
  await page.getByRole('dialog').getByLabel('Nome').fill('Nome novo');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar nome' }).click();
  await expect(card).toContainText('Nome novo');
  await page.reload();
  await expect(page.getByTestId('project-card')).toContainText('Nome novo');

  await page.getByRole('button', { name: 'Opções de Nome novo' }).click();
  await page.getByRole('menuitem', { name: 'Remover' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remover' }).click();
  await expect(page.getByRole('heading', { name: 'Ainda não tem projetos' })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('project-card')).toHaveCount(0);
});

test('conflito entre dois separadores: o segundo não sobrescreve e é avisado', async ({ page, context }) => {
  await createFromTemplate(page, 0, 'Dois separadores');
  const url = page.url();
  const other = await context.newPage();
  await other.goto(url);
  await expect(other.getByTestId('save-status')).toHaveText('Alterações guardadas neste browser');

  await layer(page, 'Decisões de marketing').click();
  await page.getByTestId('prop-text').fill('Versão do separador A');
  await page.getByTestId('prop-text').press('Tab');
  await saveAndConfirm(page);

  await layer(other, 'Decisões de marketing').click();
  await other.getByTestId('prop-text').fill('Versão do separador B');
  await other.getByTestId('prop-text').press('Tab');
  await other.getByTestId('save').click();
  await expect(other.getByTestId('save-status')).toHaveText('Conflito: versão mais recente noutro sítio');
  await expect(other.getByRole('alert').filter({ hasText: 'alterado noutro separador' })).toBeVisible();
  await expect(other.getByTestId('save')).toBeDisabled();

  const check = await context.newPage();
  await check.goto(url);
  await expect(frame(check).locator('h1')).toHaveText('Versão do separador A');
});

test('erro de gravação é mostrado e nunca aparece como guardado', async ({ page, context }) => {
  await createFromTemplate(page, 0, 'Vai falhar');
  // Noutro separador, o projeto é removido: a gravação seguinte do editor tem de falhar.
  const other = await context.newPage();
  await other.goto('/');
  await other.getByRole('button', { name: 'Opções de Vai falhar' }).click();
  await other.getByRole('menuitem', { name: 'Remover' }).click();
  await other.getByRole('dialog').getByRole('button', { name: 'Remover' }).click();
  await expect(other.getByRole('heading', { name: 'Ainda não tem projetos' })).toBeVisible();

  await layer(page, 'Decisões de marketing').click();
  await page.getByTestId('prop-text').fill('Alteração que não pode ser gravada');
  await page.getByTestId('prop-text').press('Tab');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save-status')).toHaveText('Não foi possível guardar');
  await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível guardar.' })).toBeVisible();
  await expect(page.getByText('Alterações guardadas neste browser')).toHaveCount(0);
  // A alteração continua no editor e sair pede confirmação.
  await expect(frame(page).locator('h1')).toHaveText('Alteração que não pode ser gravada');
  await page.getByTestId('back-to-projects').click();
  await expect(page.getByRole('dialog', { name: 'Sair sem guardar?' })).toBeVisible();
});

test('cópia de segurança dos projetos locais', async ({ page }) => {
  await createFromTemplate(page, 1, 'Para guardar');
  await page.getByTestId('back-to-projects').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-local').click()]);
  expect(download.suggestedFilename()).toMatch(/^bolt-ia-copia-local-.*\.json$/);
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  const backup = JSON.parse(await readFile(path, 'utf8')) as { format: string; projects: Array<{ summary: { name: string }; document: { projectData: unknown } }> };
  expect(backup.format).toBe('bolt-ia-backup');
  expect(backup.projects.map((p) => p.summary.name)).toEqual(['Para guardar']);
  expect(JSON.stringify(backup.projects[0]?.document.projectData)).toContain('Estratégia clara para empresas');
});

test('projeto inexistente mostra um erro compreensível', async ({ page }) => {
  await page.goto('/projetos/00000000-0000-4000-8000-000000000000');
  await expect(page.getByRole('heading', { name: 'Projeto não encontrado' })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar aos projetos' }).click();
  await expect(page).toHaveURL(/\/$/);
});
