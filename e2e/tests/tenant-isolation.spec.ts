import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, admin, campaignManager, collaborator } from '../fixtures';

/**
 * Tenant isolation as a person in a browser experiences it (22-acceptance-criteria.md
 * #3). The integration suite proves the rule per endpoint; this proves the two things
 * only a browser can: that no screen or selector ever offers the other company, and
 * that a guessed id typed into the address bar — or fired straight at the API with
 * this browser's own cookie — comes back exactly as if it never existed.
 */

async function signIn(page: Page, email: string) {
  await page.goto('/entrar');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
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

/** Creates a company and returns its id, read from the edit screen's address. */
async function createCompany(page: Page, name: string): Promise<string> {
  await page.goto('/empresas/nova');
  await page.getByLabel('Nome').fill(name);
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();
  return page.url().split('/').pop()!;
}

async function grantAccess(page: Page, email: string, companyName: string) {
  await page.getByRole('link', { name: 'Usuários', exact: true }).click();
  await page.getByLabel('Buscar').fill(email);
  await page.getByRole('button', { name: 'Buscar' }).click();
  await page.getByRole('link', { name: 'Editar' }).first().click();
  await expect(page.getByRole('heading', { name: 'Editar usuário' })).toBeVisible();
  await page.getByLabel('Empresa').selectOption({ label: companyName });
  await page.getByRole('button', { name: 'Vincular empresa' }).click();
  await expect(page.getByRole('status').first()).toHaveText('Acesso concedido.');
}

test.describe('isolation between two companies', () => {
  // Two companies, a project and a pendência in each, then a second sign-in.
  test.setTimeout(120_000);

  test('a member of one company never sees, reaches, or is told about the other', async ({
    page,
  }, testInfo) => {
    const contributor = collaborator(testInfo);
    // Someone the other company's pendência can be addressed to. This fixture exists to
    // be given companies (see fixtures.ts), unlike `manager()`.
    const theirMember = campaignManager(testInfo);
    const mineName = unique('Minha', testInfo);
    const theirsName = unique('Alheia', testInfo);
    const theirProjectName = unique('Projeto', testInfo);
    const theirRequestTitle = unique('Pendencia', testInfo);

    await signIn(page, admin(testInfo).email);

    const mineId = await createCompany(page, mineName);
    const theirsId = await createCompany(page, theirsName);

    await grantAccess(page, theirMember.email, theirsName);

    // Something in the other company worth reaching for: a project and a pendência.
    await page.goto('/projetos/novo');
    await page.getByLabel('Empresa').selectOption({ label: theirsName });
    await page.getByLabel('Nome').fill(theirProjectName);
    await page.getByRole('button', { name: 'Criar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar projeto' })).toBeVisible();
    const theirProjectId = page.url().split('/').pop()!;

    await page.getByRole('link', { name: 'Pendências', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pendências', exact: true })).toBeVisible();
    await page.getByLabel('Empresa').selectOption({ label: theirsName });
    await page.getByRole('button', { name: 'Nova pendência' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova pendência' });
    await dialog.getByLabel('Título').fill(theirRequestTitle);
    await dialog.getByLabel('Descrição').fill('Só a outra empresa deveria ver isto.');
    await dialog.getByLabel('Responsável').selectOption({ label: theirMember.name });
    await dialog.getByRole('button', { name: 'Criar pendência' }).click();
    await page.getByRole('button', { name: 'Todas' }).click();
    const theirRequestHref = await page
      .getByRole('link', { name: theirRequestTitle })
      .getAttribute('href');
    const theirRequestId = theirRequestHref!.split('/').pop()!;

    await grantAccess(page, contributor.email, mineName);
    await signOut(page);

    await signIn(page, contributor.email);

    // Nothing offers the other company: not the list, not a selector.
    await page.getByRole('link', { name: 'Empresas', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Empresas' })).toBeVisible();
    await expect(page.getByText(mineName)).toBeVisible();
    await expect(page.getByText(theirsName)).toHaveCount(0);

    await page.getByRole('link', { name: 'Arquivos', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Arquivos', exact: true })).toBeVisible();
    // Their own company appearing first proves the options have loaded; only then does
    // the absence of the other one mean anything.
    const companyOptions = page.getByLabel('Empresa').locator('option');
    await expect(companyOptions.filter({ hasText: mineName })).toHaveCount(1);
    await expect(companyOptions.filter({ hasText: theirsName })).toHaveCount(0);

    // A guessed address answers like a record that never existed — never data, and
    // never a 403 that would confirm the id is real (docs/PROGRESS.md, Stage 3).
    await page.goto(`/pendencias/${theirRequestId}`);
    await expect(page.getByRole('alert')).toContainText('Registro não encontrado.');
    await expect(page.getByText(theirRequestTitle)).toHaveCount(0);

    await page.goto(`/projetos/${theirProjectId}`);
    await expect(page.getByRole('alert')).toContainText('Registro não encontrado.');
    await expect(page.getByLabel('Nome')).toHaveCount(0);

    // The same ids fired straight at the API with this browser's cookie, past the UI.
    const neverExisted = '00000000-0000-4000-8000-000000000000';
    for (const [collection, id] of [
      ['companies', theirsId],
      ['projects', theirProjectId],
      ['pending-requests', theirRequestId],
    ]) {
      const foreign = await page.request.get(`/api/${collection}/${id}`);
      const missing = await page.request.get(`/api/${collection}/${neverExisted}`);
      expect(foreign.status(), collection).toBe(404);
      // Byte-identical to a never-existing id: no leak in the code or wording either.
      expect(await foreign.text(), collection).toBe(await missing.text());
    }

    // Lists asked for the other company by id come back empty, not filtered client-side.
    const foreignList = await page.request.get(`/api/pending-requests?companyId=${theirsId}`);
    expect(foreignList.status()).toBe(404);

    // And a role the UI never offers is refused by the server just the same.
    const forbidden = await page.request.post('/api/companies', {
      data: { name: 'Criada por quem não pode' },
    });
    expect(forbidden.status()).toBe(403);
    expect((await forbidden.json()).error.code).toBe('forbidden');

    // Their own company still works normally, so the refusals above are not a broken session.
    const own = await page.request.get(`/api/companies/${mineId}`);
    expect(own.status()).toBe(200);
    expect((await own.json()).data.name).toBe(mineName);
  });
});
