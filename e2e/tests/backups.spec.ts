import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, admin, manager } from '../fixtures';

async function signIn(page: Page, email: string) {
  await page.goto('/entrar');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();
}

test.describe('manual database backup', () => {
  test.setTimeout(120_000);

  test('an admin can ask for one, and is told what the file costs them', async ({
    page,
  }, testInfo) => {
    await signIn(page, admin(testInfo).email);

    await page.getByRole('link', { name: 'Backup do banco', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Backup do banco' })).toBeVisible();

    // The retention rule is on screen, because a copy of everything that silently
    // disappears is worse than one the admin knew to save elsewhere.
    await expect(page.getByText('mesmo que ninguém baixe', { exact: false })).toBeVisible();
    await expect(page.getByText('backup é manual', { exact: false })).toBeVisible();

    await page.getByRole('button', { name: 'Gerar backup' }).click();

    // The password was verified at sign-in a moment ago, so this goes straight through.
    await expect(page.getByText('Backup solicitado.', { exact: false })).toBeVisible();
    await expect(page.getByText('Na fila').or(page.getByText('Gerando')).first()).toBeVisible();
  });

  test('the whole screen is closed to anyone but an admin', async ({ page }, testInfo) => {
    await signIn(page, manager(testInfo).email);

    // Not even offered in the navigation.
    await expect(page.getByRole('link', { name: 'Backup do banco', exact: true })).toHaveCount(0);

    // And typing the address in reaches nothing.
    await page.goto('/backup');
    await expect(page.getByText('Você não tem permissão para esta ação.')).toBeVisible();
  });
});
