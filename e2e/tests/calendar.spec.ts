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

async function openCalendarFor(page: Page, companyName: string) {
  await page.goto('/empresas/nova');
  await page.getByLabel('Nome').fill(companyName);
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();

  await page.getByRole('link', { name: 'Calendário' }).click();
  await page.getByLabel('Empresa').selectOption({ label: companyName });
}

/** A local datetime-local value, which is what the input and the page both speak. */
function localDateTime(daysFromNow: number, hour = 10): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, 0, 0, 0);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(hour)}:00`;
}

test.describe('editorial calendar', () => {
  test.setTimeout(90_000);

  test('plans a piece of content and finds it across the views', async ({ page }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    const companyName = unique('Cliente', testInfo);
    const title = unique('Post', testInfo);

    await openCalendarFor(page, companyName);
    await expect(page.getByText('Planejados')).toBeVisible();

    await page.getByRole('button', { name: 'Novo conteúdo' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Novo conteúdo' });
    await dialog.getByLabel('Título').fill(title);
    await dialog.getByLabel('Data e hora').fill(localDateTime(1));
    await dialog.getByLabel('Tipo').selectOption('reels');
    await dialog.getByRole('button', { name: 'Criar' }).click();

    // The list view is the one that shows every item regardless of the visible window.
    await page.getByRole('button', { name: 'Lista' }).click();
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByText('Planejado').first()).toBeVisible();

    // The day view, moved to tomorrow, shows it too.
    await page.getByRole('button', { name: 'Dia' }).click();
    await page.getByRole('button', { name: 'Próximo' }).click();
    await expect(page.getByText(title)).toBeVisible();
  });

  test('moves an item through production and reflects it in the summary', async ({
    page,
  }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    const companyName = unique('Cliente', testInfo);
    const title = unique('Post', testInfo);

    await openCalendarFor(page, companyName);

    await page.getByRole('button', { name: 'Novo conteúdo' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Novo conteúdo' });
    await dialog.getByLabel('Título').fill(title);
    await dialog.getByLabel('Data e hora').fill(localDateTime(2));
    await dialog.getByRole('button', { name: 'Criar' }).click();

    await page.getByRole('button', { name: 'Lista' }).click();
    await expect(page.getByText(title)).toBeVisible();

    await page.getByRole('button', { name: 'Editar' }).first().click();
    const editDialog = page.getByRole('dialog', { name: 'Editar conteúdo' });
    await editDialog.getByLabel('Produção').selectOption('awaiting_material');
    await editDialog.getByRole('button', { name: 'Salvar' }).click();

    // Waiting on the client is the one blocked state the agency cannot clear itself.
    await expect(page.getByText('Aguardando cliente')).toBeVisible();

    const summary = page.getByText('Aguardando material').first();
    await expect(summary).toBeVisible();
  });

  test('duplicates an item to another date, restarting its pipeline', async ({
    page,
  }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    const companyName = unique('Cliente', testInfo);
    const title = unique('Post', testInfo);

    await openCalendarFor(page, companyName);

    await page.getByRole('button', { name: 'Novo conteúdo' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Novo conteúdo' });
    await dialog.getByLabel('Título').fill(title);
    await dialog.getByLabel('Data e hora').fill(localDateTime(1));
    await dialog.getByLabel('Produção').selectOption('approved');
    await dialog.getByRole('button', { name: 'Criar' }).click();

    await page.getByRole('button', { name: 'Lista' }).click();
    await expect(page.getByText(title)).toBeVisible();

    const target = new Date();
    target.setDate(target.getDate() + 15);
    page.once('dialog', (prompt) => void prompt.accept(target.toISOString().slice(0, 10)));
    await page.getByRole('button', { name: 'Duplicar' }).first().click();

    await expect(page.getByRole('status').first()).toHaveText('Conteúdo duplicado.');
    // Two rows with the same title: the original approved, the copy back at planned.
    await expect(page.getByText(title)).toHaveCount(2);
    await expect(page.getByText('Planejado').first()).toBeVisible();
  });
});
