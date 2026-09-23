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

test.describe('pagination and layout', () => {
  test.setTimeout(120_000);

  test('a list past one page is walked with the pager, not truncated', async ({
    page,
  }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    const prefix = unique('Pag', testInfo);

    // One more than a page, created through the API with this browser's own session:
    // the screen under test is the list, not twenty-one trips through the form.
    for (let index = 1; index <= 21; index += 1) {
      const response = await page.request.post('/api/companies', {
        data: { name: `${prefix} ${String(index).padStart(2, '0')}` },
      });
      expect(response.status()).toBe(201);
    }

    await page.goto('/empresas');
    await page.getByLabel('Buscar').fill(prefix);
    await page.getByRole('button', { name: 'Buscar' }).click();

    const pager = page.getByRole('navigation', { name: 'Paginação' });
    await expect(pager.getByText('21 resultados')).toBeVisible();
    await expect(pager.getByText('Página 1 de 2')).toBeVisible();
    await expect(page.getByRole('listitem')).toHaveCount(20);
    await expect(pager.getByRole('button', { name: 'Anterior' })).toBeDisabled();

    await pager.getByRole('button', { name: 'Próxima' }).click();
    await expect(pager.getByText('Página 2 de 2')).toBeVisible();
    await expect(page.getByRole('listitem')).toHaveCount(1);
    await expect(pager.getByRole('button', { name: 'Próxima' })).toBeDisabled();

    // Changing the filter goes back to the first page rather than pointing past the end.
    await page.getByLabel('Situação').selectOption('all');
    await expect(pager.getByText('Página 1 de 2')).toBeVisible();

    // What the screen can never send, a hand-edited address can: a bad page is refused
    // with the field named, and an oversized page is capped rather than served
    // unbounded or refused (22-acceptance-criteria.md #30).
    for (const bad of ['page=0', 'page=abc', 'pageSize=0']) {
      const response = await page.request.get(`/api/companies?${bad}`);
      expect(response.status(), bad).toBe(400);
      const { error } = await response.json();
      expect(error.code, bad).toBe('validation_error');
      expect(error.details[0].field, bad).toBe(bad.split('=')[0]);
    }
    const capped = await page.request.get(`/api/companies?pageSize=10000&search=${prefix}`);
    expect(capped.status()).toBe(200);
    expect((await capped.json()).meta).toMatchObject({ pageSize: 100, total: 21 });
  });

  test('no screen scrolls sideways, on a phone or on a desktop', async ({ page }, testInfo) => {
    // The nav strip scrolls within itself on a phone by design; the page itself never may
    // (12-ui-ux-guidelines.md#mobile-first). Checked at desktop width too: an admin's
    // fourteen sections once ran past the edge of a 1280px screen, taking the whole page
    // sideways with them.
    await signIn(page, admin(testInfo).email);
    const companyName = unique('Cliente', testInfo);
    await page.goto('/empresas/nova');
    await page.getByLabel('Nome').fill(companyName);
    await page.getByRole('button', { name: 'Criar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();

    // Something to show, named as long as the forms allow and with nowhere to break - what
    // a pasted link or a file_name_like_this looks like. An empty company proves little:
    // the dashboard panels and the lists once let such a title stretch them past the edge
    // of a phone, and the detail headings ran off even a desktop.
    const companyId = new URL(page.url()).pathname.split('/').pop()!;
    const longName = `${'nome_comprido_sem_espacos_'.repeat(5)}${Date.now()}`;
    const me = (await (await page.request.get('/api/auth/me')).json()).data as { id: string };
    const hoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const daysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const content = await page.request.post('/api/content', {
      data: { companyId, title: longName, scheduledAt: hoursAgo },
    });
    expect(content.status()).toBe(201);
    const request = await page.request.post('/api/pending-requests', {
      data: {
        companyId,
        title: longName,
        description: longName,
        responsibleUserId: me.id,
        dueDate: daysAgo,
      },
    });
    expect(request.status()).toBe(201);
    const account = await page.request.post('/api/ad-accounts', {
      data: { companyId, platform: 'meta', name: 'Conta principal' },
    });
    expect(account.status()).toBe(201);
    const campaign = await page.request.post('/api/campaigns', {
      data: {
        companyId,
        adAccountId: (await account.json()).data.id,
        name: longName,
        objective: longName.slice(0, 160),
      },
    });
    expect(campaign.status()).toBe(201);

    // The screens that show one company at a time are shown this one. It was created
    // last, so it is also the proof that a selector offers every company, not only the
    // first hundred.
    const scoped = new Set([
      '/',
      '/projetos/novo',
      '/calendario',
      '/publicacoes',
      '/arquivos',
      '/pendencias',
      '/campanhas',
    ]);

    for (const path of [
      '/',
      '/empresas',
      '/projetos',
      '/projetos/novo',
      '/calendario',
      '/publicacoes',
      '/arquivos',
      '/pendencias',
      '/campanhas',
      '/topicos',
      '/notificacoes',
      '/sessoes',
      '/usuarios',
      '/usuarios/novo',
      '/exclusoes',
      '/identidade-visual',
      '/backup',
      `/pendencias/${(await request.json()).data.id}`,
      `/campanhas/${(await campaign.json()).data.id}`,
    ]) {
      await page.goto(path);
      await expect(page.locator('main h1').first()).toBeVisible();
      if (scoped.has(path)) {
        const selector = page.getByLabel('Empresa').first();
        await expect(selector.locator('option', { hasText: companyName })).toHaveCount(1);
        await selector.selectOption({ label: companyName });
      }
      // Measured once what was fetched is on screen, not before.
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
    }
  });
});
