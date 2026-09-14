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

function unique(prefix: string, testInfo: { project: { name: string }; title: string }) {
  const slug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 20);
  return `${prefix}-${testInfo.project.name}-${slug}-${Date.now()}`;
}

/** Projects and folders both need a company, and the admin fixture starts with none. */
async function createCompany(page: Page, name: string) {
  await page.goto('/empresas/nova');
  await page.getByLabel('Nome').fill(name);
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();
}

test.describe('projects', () => {
  test('an admin creates a project and finds it in the list', async ({ page }, testInfo) => {
    await signIn(page, admin(testInfo).email);

    const companyName = unique('Cliente', testInfo);
    const projectName = unique('Projeto', testInfo);
    await createCompany(page, companyName);

    await page.getByRole('link', { name: 'Projetos' }).click();
    await page.getByRole('link', { name: 'Novo projeto' }).first().click();

    await page.getByLabel('Empresa').selectOption({ label: companyName });
    await page.getByLabel('Nome').fill(projectName);
    await page.getByLabel('Tipo').selectOption('campaign');
    await page.getByRole('button', { name: 'Criar' }).click();

    await expect(page.getByRole('heading', { name: 'Editar projeto' })).toBeVisible();

    await page.getByLabel('Situação').selectOption('completed');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('status')).toHaveText('Projeto atualizado.');

    await page.getByRole('link', { name: 'Projetos' }).click();
    // Scoped to the row: "Concluído" is also an option in the status filter.
    const row = page.getByRole('listitem').filter({ hasText: projectName });
    await expect(row).toBeVisible();
    await expect(row.getByText('Concluído')).toBeVisible();
  });

  test('refuses an end date before the start date, in pt-BR', async ({ page }, testInfo) => {
    await signIn(page, admin(testInfo).email);

    const companyName = unique('Cliente', testInfo);
    await createCompany(page, companyName);

    await page.goto('/projetos/novo');
    await page.getByLabel('Empresa').selectOption({ label: companyName });
    await page.getByLabel('Nome').fill('Datas trocadas');
    await page.getByLabel('Início').fill('2026-05-10');
    await page.getByLabel('Término').fill('2026-05-01');
    await page.getByRole('button', { name: 'Criar' }).click();

    await expect(page.getByRole('alert')).toHaveText(
      'A data de término não pode ser anterior ao início.',
    );
    // The form keeps what was typed.
    await expect(page.getByLabel('Nome')).toHaveValue('Datas trocadas');
  });

  test('a manager with no company sees an empty projects list, not an error', async ({
    page,
  }, testInfo) => {
    await signIn(page, manager(testInfo).email);

    await page.getByRole('link', { name: 'Projetos' }).click();

    await expect(page.getByText('Nenhum projeto por aqui ainda.')).toBeVisible();
  });
});

test.describe('folders', () => {
  test('creates, nests, renames, and deletes a folder', async ({ page }, testInfo) => {
    await signIn(page, admin(testInfo).email);

    const companyName = unique('Cliente', testInfo);
    await createCompany(page, companyName);

    await page.getByRole('link', { name: 'Arquivos' }).click();
    await expect(page.getByRole('heading', { name: 'Arquivos' })).toBeVisible();
    await page.getByLabel('Empresa').selectOption({ label: companyName });

    await page.getByLabel('Nome da pasta').fill('Fotos');
    await page.getByRole('button', { name: 'Nova pasta' }).click();
    await expect(page.getByRole('status').first()).toHaveText('Pasta criada.');

    // Navigate into it and nest a child.
    await page.getByRole('button', { name: 'Abrir' }).click();
    await expect(page.getByText('Nenhuma pasta ou arquivo aqui.')).toBeVisible();

    await page.getByLabel('Nome da pasta').fill('Fachada');
    await page.getByRole('button', { name: 'Nova pasta' }).click();
    await expect(page.getByText('Fachada')).toBeVisible();

    // The breadcrumb walks back out.
    await page.getByRole('button', { name: 'Raiz' }).click();
    await expect(page.getByText('1 subpasta')).toBeVisible();

    await page.getByRole('button', { name: 'Renomear' }).click();
    await page.getByLabel('Nome da pasta').last().fill('Imagens');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Imagens')).toBeVisible();

    // A folder with children cannot be deleted.
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Excluir' }).click();
    await expect(page.getByRole('alert')).toHaveText('Esvazie a pasta antes de excluí-la.');
  });

  test('refuses a duplicate folder name in the same place', async ({ page }, testInfo) => {
    await signIn(page, admin(testInfo).email);

    const companyName = unique('Cliente', testInfo);
    await createCompany(page, companyName);

    await page.goto('/arquivos');
    await page.getByLabel('Empresa').selectOption({ label: companyName });

    await page.getByLabel('Nome da pasta').fill('Contratos');
    await page.getByRole('button', { name: 'Nova pasta' }).click();
    await expect(page.getByRole('status').first()).toHaveText('Pasta criada.');

    await page.getByLabel('Nome da pasta').fill('contratos');
    await page.getByRole('button', { name: 'Nova pasta' }).click();

    await expect(page.getByRole('alert')).toHaveText(
      'Já existe uma pasta com este nome neste local.',
    );
  });

  test('tells a user with no company what to do instead of failing', async ({ page }, testInfo) => {
    await signIn(page, manager(testInfo).email);

    await page.getByRole('link', { name: 'Arquivos' }).click();

    await expect(page.getByText('Você ainda não tem acesso a nenhuma empresa.')).toBeVisible();
  });
});
