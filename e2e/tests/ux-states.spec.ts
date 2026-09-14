import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, admin } from '../fixtures';

/**
 * The cross-cutting UI acceptance criteria (22-acceptance-criteria.md #27, #28, #29).
 * Each screen was built with these in mind; these tests are what stops the next one
 * being built without them.
 */

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

test.describe('cross-cutting UI states', () => {
  test.setTimeout(120_000);

  test('a failed load offers a retry, and the retry works', async ({ page }, testInfo) => {
    await signIn(page, admin(testInfo).email);

    // Failed queries are retried automatically a few times before the UI gives up,
    // so a single injected failure never surfaces. This keeps failing until the
    // client has actually run out of attempts and shown the error.
    let shouldFail = true;
    await page.route('**/api/companies?**', async (route) => {
      if (shouldFail) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'internal_error', message: 'x' } }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/empresas');

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();

    shouldFail = false;
    await alert.getByRole('button', { name: 'Tentar novamente' }).click();

    // Recovered in place: no reload, no dead end.
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Empresas' })).toBeVisible();
  });

  test('double-submitting on a slow connection creates exactly one record', async ({
    page,
  }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    const companyName = unique('Cliente', testInfo);

    // A slow POST is what makes a double submit possible at all.
    await page.route('**/api/companies', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });

    await page.goto('/empresas/nova');
    await page.getByLabel('Nome').fill(companyName);

    // Located by role rather than by name: while the request is in flight the button
    // says "Criando…", which is itself part of the protection.
    const submit = page.locator('form button[type="submit"]');
    await submit.click();
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveText(/Criando/);
    // Nothing to hit, which is the guarantee — not a race the test happens to win.
    await submit.click({ force: true, timeout: 2000 }).catch(() => undefined);

    await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();

    await page.unroute('**/api/companies');
    await page.goto('/empresas');
    await page.getByLabel('Buscar').fill(companyName);
    await page.getByRole('button', { name: 'Buscar' }).click();

    await expect(page.getByText(companyName, { exact: true })).toHaveCount(1);
  });

  test('a destructive action does nothing until it is confirmed', async ({ page }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    const companyName = unique('Cliente', testInfo);
    const projectName = unique('Projeto', testInfo);

    await page.goto('/empresas/nova');
    await page.getByLabel('Nome').fill(companyName);
    await page.getByRole('button', { name: 'Criar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();

    await page.getByRole('link', { name: 'Arquivos', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Arquivos', exact: true })).toBeVisible();
    await page.getByLabel('Empresa').selectOption({ label: companyName });

    await page.getByLabel('Nome da pasta').fill(projectName);
    await page.getByRole('button', { name: 'Nova pasta' }).click();
    await expect(page.getByRole('status').first()).toHaveText('Pasta criada.');
    await expect(page.getByText(projectName).first()).toBeVisible();

    // Dismissed: the folder must still be there.
    page.once('dialog', (dialog) => void dialog.dismiss());
    await page.getByRole('button', { name: 'Excluir' }).first().click();
    await expect(page.getByText(projectName).first()).toBeVisible();

    // Accepted: now it goes.
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Excluir' }).first().click();
    await expect(page.getByText(projectName)).toHaveCount(0);
  });
});
