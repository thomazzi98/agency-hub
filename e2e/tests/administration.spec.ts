import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, admin, manager } from '../fixtures';

async function signIn(page: Page, email: string, password = E2E_PASSWORD) {
  await page.goto('/entrar');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();

  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();
}

/** Distinct per project and per test, so runs never collide on a unique name or email. */
function unique(prefix: string, testInfo: { project: { name: string }; title: string }) {
  const slug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 24);
  return `${prefix}-${testInfo.project.name}-${slug}-${Date.now()}`;
}

test.describe('companies', () => {
  test('an admin creates, edits, and archives a company', async ({ page }, testInfo) => {
    await signIn(page, admin(testInfo).email);

    const name = unique('Empresa', testInfo);

    await page.getByRole('link', { name: 'Empresas' }).click();
    await page.getByRole('link', { name: 'Nova empresa' }).first().click();

    await page.getByLabel('Nome').fill(name);
    await page.getByLabel('Segmento').fill('Imobiliário');
    await page.getByLabel('Responsável').fill('Joana Silva');
    await page.getByRole('button', { name: 'Criar' }).click();

    await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();

    await page.getByLabel('Segmento').fill('Varejo');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('status')).toHaveText('Empresa atualizada.');

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Arquivar' }).click();
    await expect(page.getByRole('button', { name: 'Reativar' })).toBeVisible();

    // Archiving removes it from the default (active) list without deleting it.
    await page.getByRole('link', { name: 'Empresas' }).click();
    await expect(page.getByText(name)).toHaveCount(0);

    await page.getByLabel('Situação').selectOption('archived');
    await page.getByRole('button', { name: 'Buscar' }).click();
    await expect(page.getByText(name)).toBeVisible();
  });

  test('a manager sees the companies list without any editing affordance', async ({
    page,
  }, testInfo) => {
    await signIn(page, manager(testInfo).email);

    await page.getByRole('link', { name: 'Empresas' }).click();

    await expect(page.getByRole('heading', { name: 'Empresas' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Nova empresa' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Usuários' })).toHaveCount(0);
  });

  test('refuses the admin-only screens to a manager who navigates straight there', async ({
    page,
  }, testInfo) => {
    await signIn(page, manager(testInfo).email);

    await page.goto('/usuarios');

    await expect(page.getByRole('alert')).toHaveText('Você não tem permissão para esta ação.');
  });
});

test.describe('users and memberships', () => {
  test('creates a user, shows the temporary password once, and links a company', async ({
    page,
  }, testInfo) => {
    await signIn(page, admin(testInfo).email);

    const companyName = unique('Cliente', testInfo);
    const email = `${unique('pessoa', testInfo).toLowerCase()}@example.com`;

    await page.goto('/empresas/nova');
    await page.getByLabel('Nome').fill(companyName);
    await page.getByRole('button', { name: 'Criar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();

    await page.getByRole('link', { name: 'Usuários' }).click();
    await page.getByRole('link', { name: 'Novo usuário' }).first().click();

    await page.getByLabel('Nome').fill('Pessoa de Teste');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Perfil').selectOption('contributor');
    await page.getByRole('button', { name: 'Criar' }).click();

    const dialog = page.getByRole('dialog', { name: 'Senha temporária' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('status')).toContainText('aparece apenas uma vez');
    await dialog.getByRole('button', { name: 'Fechar' }).click();

    await expect(page.getByRole('heading', { name: 'Editar usuário' })).toBeVisible();
    await expect(
      page.getByText('Este usuário ainda não tem acesso a nenhuma empresa.'),
    ).toBeVisible();

    await page.getByLabel('Empresa').selectOption({ label: companyName });
    await page.getByRole('button', { name: 'Vincular empresa' }).click();

    await expect(page.getByRole('status').first()).toHaveText('Acesso concedido.');
    await expect(page.getByText(companyName)).toBeVisible();

    // Per-membership override, not a per-user flag.
    await page.getByLabel('Pode gerenciar campanhas').check();
    await expect(page.getByRole('status').first()).toHaveText('Permissões atualizadas.');

    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Remover acesso' }).click();
    await expect(
      page.getByText('Este usuário ainda não tem acesso a nenhuma empresa.'),
    ).toBeVisible();
  });

  test('reports a duplicate email in pt-BR without losing the typed form', async ({
    page,
  }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    const existingEmail = manager(testInfo).email;

    await page.goto('/usuarios/novo');
    await page.getByLabel('Nome').fill('Duplicada');
    await page.getByLabel('E-mail').fill(existingEmail);
    await page.getByRole('button', { name: 'Criar' }).click();

    await expect(page.getByRole('alert')).toHaveText('Já existe um usuário com este e-mail.');
    await expect(page.getByLabel('Nome')).toHaveValue('Duplicada');
  });
});
