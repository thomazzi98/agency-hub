import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, admin } from '../fixtures';

async function signIn(page: Page, email: string) {
  await page.goto('/entrar');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();
}

function unique(prefix: string, testInfo: { project: { name: string }; title: string }) {
  const slug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 18);
  return `${prefix}-${testInfo.project.name}-${slug}-${Date.now()}`;
}

function localDateTime(daysFromNow: number, hour = 10): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, 0, 0, 0);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(hour)}:00`;
}

/** Creates a company with one content item and leaves the list view open on it. */
async function planContent(page: Page, companyName: string, title: string) {
  await page.goto('/empresas/nova');
  await page.getByLabel('Nome').fill(companyName);
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();

  await page.getByRole('link', { name: 'Calendário' }).click();
  await expect(page.getByRole('heading', { name: 'Calendário' })).toBeVisible();
  await page.getByLabel('Empresa').selectOption({ label: companyName });

  await page.getByRole('button', { name: 'Novo conteúdo' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Novo conteúdo' });
  await dialog.getByLabel('Título').fill(title);
  await dialog.getByLabel('Data e hora').fill(localDateTime(1));
  await dialog.getByRole('button', { name: 'Criar' }).click();

  await page.getByRole('button', { name: 'Lista' }).click();
  await expect(page.getByText(title)).toBeVisible();
}

test.describe('multi-network publications', () => {
  test.setTimeout(90_000);

  test('registers a publication per network and shows which are done', async ({
    page,
  }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    const companyName = unique('Cliente', testInfo);
    const title = unique('Post', testInfo);

    await planContent(page, companyName, title);

    // Every network is offered from the start, so "not registered" is visible too.
    await expect(page.getByRole('button', { name: /^Instagram: Sem registro$/ })).toBeVisible();
    await expect(page.getByText('0 de 4 redes publicadas')).toBeVisible();

    await page.getByRole('button', { name: /^Instagram: Sem registro$/ }).click();
    const dialog = page.getByRole('dialog', { name: /Publicações · Instagram/ });
    await dialog.getByLabel('Situação').selectOption('published');
    await dialog.getByLabel('Link da publicação').fill('https://instagram.com/p/e2e-teste');
    await dialog.getByRole('button', { name: 'Registrar' }).click();

    await expect(page.getByText('Publicação registrada.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Instagram: Publicada$/ })).toBeVisible();
    await expect(page.getByText('1 de 4 redes publicadas')).toBeVisible();

    // The other networks are untouched: each record is independent.
    await expect(page.getByRole('button', { name: /^TikTok: Sem registro$/ })).toBeVisible();
  });

  test('lists what is still pending and opens it for editing', async ({ page }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    const companyName = unique('Cliente', testInfo);
    const title = unique('Post', testInfo);

    await planContent(page, companyName, title);

    await page.getByRole('button', { name: /^TikTok: Sem registro$/ }).click();
    const dialog = page.getByRole('dialog', { name: /Publicações · TikTok/ });
    await dialog.getByLabel('Situação').selectOption('scheduled');
    await dialog.getByLabel('Data da publicação').fill(localDateTime(2));
    await dialog.getByRole('button', { name: 'Registrar' }).click();
    await expect(page.getByText('Publicação registrada.')).toBeVisible();

    await page.getByRole('link', { name: 'Publicações' }).click();
    // Every screen has an "Empresa" selector, so touching it before this page has
    // rendered would set the *previous* page's one and leave this one on its default.
    await expect(page.getByRole('heading', { name: 'Publicações' })).toBeVisible();
    await page.getByLabel('Empresa').selectOption({ label: companyName });
    await page.getByLabel('Somente pendentes').check();

    // Scoped to the row: "Agendada" is also one of the status filter's options.
    const row = page.getByRole('listitem').filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row.getByText('Agendada')).toBeVisible();

    await row.getByRole('button', { name: 'Editar registro' }).click();
    const editDialog = page.getByRole('dialog', { name: /Publicações · TikTok/ });
    await editDialog.getByLabel('Situação').selectOption('published');
    await editDialog.getByRole('button', { name: 'Salvar' }).click();

    // It leaves the pending filter as soon as it is published.
    await expect(page.getByText('Nenhuma publicação registrada.')).toBeVisible();
  });
});
