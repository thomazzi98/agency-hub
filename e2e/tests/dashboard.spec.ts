import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, admin, collaborator } from '../fixtures';

async function signIn(page: Page, email: string) {
  await page.goto('/entrar');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  // The session cookie is set by the response; navigating before it lands bounces
  // straight back to the sign-in screen.
  await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
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

test.describe('dashboards', () => {
  test.setTimeout(120_000);

  test('the agency dashboard answers what needs doing and filters by company', async ({
    page,
  }, testInfo) => {
    const companyName = unique('Cliente', testInfo);
    const title = unique('Post atrasado', testInfo);

    await signIn(page, admin(testInfo).email);
    await expect(page.getByText('O que precisa da sua atenção agora')).toBeVisible();

    await page.goto('/empresas/nova');
    await page.getByLabel('Nome').fill(companyName);
    await page.getByRole('button', { name: 'Criar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();

    // Something genuinely late, so the "atrasados" panel has a reason to exist.
    await page.getByRole('link', { name: 'Calendário', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Calendário' })).toBeVisible();
    await page.getByLabel('Empresa').selectOption({ label: companyName });
    await page.getByRole('button', { name: 'Novo conteúdo' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Novo conteúdo' });
    await dialog.getByLabel('Título').fill(title);
    await dialog.getByLabel('Data e hora').fill(localDateTime(-3));
    await dialog.getByRole('button', { name: 'Criar' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('link', { name: 'Início', exact: true }).click();
    await expect(page.getByText('O que precisa da sua atenção agora')).toBeVisible();

    // Filtering to this company shows exactly the item that was just made late.
    await page.getByLabel('Empresa').selectOption({ label: companyName });
    await expect(page.getByText(title)).toBeVisible();

    const overduePanel = page.getByRole('listitem').filter({ hasText: title }).first();
    await expect(overduePanel).toBeVisible();

    // Every tile is a way in, not just a number.
    await page
      .getByRole('link', { name: /Atrasados/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Calendário' })).toBeVisible();
  });

  test('a client sees a simpler dashboard with no agency filters', async ({ page }, testInfo) => {
    const companyName = unique('Cliente', testInfo);
    const recipient = collaborator(testInfo);

    await signIn(page, admin(testInfo).email);
    await page.goto('/empresas/nova');
    await page.getByLabel('Nome').fill(companyName);
    await page.getByRole('button', { name: 'Criar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();

    await page.getByRole('link', { name: 'Usuários', exact: true }).click();
    await page.getByLabel('Buscar').fill(recipient.email);
    await page.getByRole('button', { name: 'Buscar' }).click();
    await page.getByRole('link', { name: 'Editar' }).first().click();
    await page.getByLabel('Empresa').selectOption({ label: companyName });
    await page.getByRole('button', { name: 'Vincular empresa' }).click();
    await expect(page.getByRole('status').first()).toHaveText('Acesso concedido.');

    await signOut(page);
    await signIn(page, recipient.email);
    await expect(page.getByText('O que precisa da sua atenção agora')).toBeVisible();
    // The label appears twice by design: once as a tile, once as the panel it opens.
    await expect(page.getByText('Pendências com você').first()).toBeVisible();

    // The agency's filters and its agency-wide tiles are simply not there.
    await expect(page.getByText('Filtros')).toHaveCount(0);
    await expect(page.getByText('Empresas ativas')).toHaveCount(0);
    await expect(page.getByText('Últimas atividades')).toHaveCount(0);
  });
});
