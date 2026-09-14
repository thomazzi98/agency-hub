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

/**
 * Branding is a single global row, so these tests change shared state. They restore
 * the defaults at the end rather than relying on run order.
 */
async function restoreDefaults(page: Page) {
  await page.goto('/identidade-visual');
  await page.getByLabel('Nome do sistema').fill('Agency Hub');
  await page.getByLabel('Cor principal', { exact: true }).fill('#1d4ed8');
  await page.getByLabel('Cor secundária', { exact: true }).fill('#0f172a');
  await page.getByLabel('Mensagem na tela de login').fill('');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('status').first()).toHaveText('Identidade visual atualizada.');
}

test.describe('branding', () => {
  test('an admin renames the app and the login screen shows it', async ({ page }, testInfo) => {
    await signIn(page, admin(testInfo).email);

    const appName = `Marca ${testInfo.project.name} ${Date.now()}`;
    const loginMessage = 'Acesso exclusivo para clientes.';

    await page.getByRole('link', { name: 'Identidade visual' }).click();
    await page.getByLabel('Nome do sistema').fill(appName);
    await page.getByLabel('Mensagem na tela de login').fill(loginMessage);
    await page.getByRole('button', { name: 'Salvar' }).click();

    await expect(page.getByRole('status').first()).toHaveText('Identidade visual atualizada.');
    await expect(page).toHaveTitle(appName);

    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();

    // The login screen reads branding before anyone is authenticated.
    await expect(page.getByRole('heading', { name: appName })).toBeVisible();
    await expect(page.getByText(loginMessage)).toBeVisible();

    await signIn(page, admin(testInfo).email);
    await restoreDefaults(page);
  });

  test('blocks saving a colour white text could not be read against', async ({
    page,
  }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    await page.goto('/identidade-visual');

    await page.getByLabel('Cor principal', { exact: true }).fill('#ffe066');

    await expect(page.getByText(/Contraste insuficiente/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar' })).toBeDisabled();

    await page.getByLabel('Cor principal', { exact: true }).fill('#1d4ed8');
    await expect(page.getByRole('button', { name: 'Salvar' })).toBeEnabled();
  });

  test('is not reachable by a manager', async ({ page }, testInfo) => {
    await signIn(page, manager(testInfo).email);

    await expect(page.getByRole('link', { name: 'Identidade visual' })).toHaveCount(0);

    await page.goto('/identidade-visual');
    await expect(page.getByRole('alert')).toHaveText('Você não tem permissão para esta ação.');
  });
});
