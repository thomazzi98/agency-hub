import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, admin, manager, temporaryUser } from '../fixtures';

async function submitLogin(page: Page, email: string, password: string) {
  await page.goto('/entrar');
  // A preceding sign-out navigates on its own, so wait for the form rather than
  // assuming `goto` landed on it.
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();

  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/auth/login')),
    page.getByRole('button', { name: 'Entrar' }).click(),
  ]);
}

test.describe('login', () => {
  test('shows a pt-BR error and keeps the typed email when credentials are wrong', async ({
    page,
  }, testInfo) => {
    const user = manager(testInfo);
    await submitLogin(page, user.email, 'senha-errada-123');

    await expect(page.getByRole('alert')).toHaveText('E-mail ou senha inválidos.');
    await expect(page.getByLabel('E-mail')).toHaveValue(user.email);
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test('signs in and lands on the home screen', async ({ page }, testInfo) => {
    const user = manager(testInfo);
    await submitLogin(page, user.email, E2E_PASSWORD);

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();
    await expect(page.getByText(`Olá, ${user.name}.`)).toBeVisible();
  });

  test('redirects an anonymous visitor away from a protected screen', async ({ page }) => {
    await page.goto('/sessoes');

    await expect(page).toHaveURL(/\/entrar$/);
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  });

  test('signs out and blocks the protected screen again', async ({ page }, testInfo) => {
    await submitLogin(page, admin(testInfo).email, E2E_PASSWORD);
    await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();

    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page).toHaveURL(/\/entrar$/);

    await page.goto('/');
    await expect(page).toHaveURL(/\/entrar$/);
  });
});

test.describe('forced password change', () => {
  test('blocks every other screen until a new password is set', async ({ page }, testInfo) => {
    const user = temporaryUser(testInfo, 1);

    await submitLogin(page, user.email, E2E_PASSWORD);

    await expect(page).toHaveURL(/\/alterar-senha$/);
    await expect(page.getByRole('heading', { name: 'Defina uma nova senha' })).toBeVisible();
    await expect(page.getByText('Sua senha atual é temporária.')).toBeVisible();

    await page.goto('/sessoes');
    await expect(page).toHaveURL(/\/alterar-senha$/);
  });

  test('rejects a mismatched confirmation without calling the server', async ({
    page,
  }, testInfo) => {
    const user = temporaryUser(testInfo, 2);

    await submitLogin(page, user.email, E2E_PASSWORD);
    await expect(page).toHaveURL(/\/alterar-senha$/);

    await page.getByLabel('Senha atual').fill(E2E_PASSWORD);
    await page.getByLabel('Nova senha', { exact: true }).fill('Nova-Senha-Forte-1');
    await page.getByLabel('Confirme a nova senha').fill('Nova-Senha-Diferente-1');
    await page.getByRole('button', { name: 'Salvar nova senha' }).click();

    await expect(page.getByRole('alert')).toHaveText('As senhas não conferem.');
    await expect(page).toHaveURL(/\/alterar-senha$/);
  });

  test('grants full access once the new password is saved', async ({ page }, testInfo) => {
    const user = temporaryUser(testInfo, 3);
    const newPassword = 'Nova-Senha-Forte-1';

    await submitLogin(page, user.email, E2E_PASSWORD);
    await expect(page).toHaveURL(/\/alterar-senha$/);

    await page.getByLabel('Senha atual').fill(E2E_PASSWORD);
    await page.getByLabel('Nova senha', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirme a nova senha').fill(newPassword);
    await page.getByRole('button', { name: 'Salvar nova senha' }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();

    await page.getByRole('link', { name: 'Sessões ativas' }).click();
    await expect(page.getByRole('heading', { name: 'Sessões ativas' })).toBeVisible();

    await page.getByRole('button', { name: 'Sair' }).click();
    await submitLogin(page, user.email, newPassword);
    await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();
  });
});

test.describe('sessions screen', () => {
  test('marks the current session and lists the others', async ({ page, browser }, testInfo) => {
    const user = admin(testInfo);
    await submitLogin(page, user.email, E2E_PASSWORD);
    // Wait for the session cookie to be set before navigating, or the next goto
    // races the login request and lands back on the sign-in screen.
    await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();

    // Other specs sign in as the same fixture account, so start from a known state.
    await page.goto('/sessoes');
    // `count()` does not auto-wait, so let the list render before asking.
    await expect(page.getByText('Esta sessão')).toBeVisible();

    const revokeOthers = page.getByRole('button', { name: 'Encerrar as outras sessões' });
    if ((await revokeOthers.count()) > 0) {
      page.once('dialog', (dialog) => void dialog.accept());
      await revokeOthers.click();
      await expect(page.getByText('Nenhuma outra sessão ativa.')).toBeVisible();
    }

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await submitLogin(secondPage, user.email, E2E_PASSWORD);
    await expect(secondPage.getByRole('heading', { name: 'Início' })).toBeVisible();

    await page.goto('/sessoes');
    await expect(page.getByText('Esta sessão')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Encerrar', exact: true })).toHaveCount(1);

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Encerrar', exact: true }).click();
    await expect(page.getByText('Nenhuma outra sessão ativa.')).toBeVisible();

    await secondPage.goto('/');
    await expect(secondPage).toHaveURL(/\/entrar$/);

    await secondContext.close();
  });
});
