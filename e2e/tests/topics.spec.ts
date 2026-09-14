import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, admin, collaborator } from '../fixtures';

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

async function createCompanyWithMember(page: Page, companyName: string, memberEmail: string) {
  await page.goto('/empresas/nova');
  await page.getByLabel('Nome').fill(companyName);
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();

  await page.getByRole('link', { name: 'Usuários', exact: true }).click();
  await page.getByLabel('Buscar').fill(memberEmail);
  await page.getByRole('button', { name: 'Buscar' }).click();
  await page.getByRole('link', { name: 'Editar' }).first().click();
  await expect(page.getByRole('heading', { name: 'Editar usuário' })).toBeVisible();
  await page.getByLabel('Empresa').selectOption({ label: companyName });
  await page.getByRole('button', { name: 'Vincular empresa' }).click();
  await expect(page.getByRole('status').first()).toHaveText('Acesso concedido.');
}

test.describe('follow-up topics', () => {
  // Two sign-ins and a company set-up; the default 30s covers one interaction.
  test.setTimeout(120_000);

  test('carries a question from the agency to a collaborator and back', async ({
    page,
  }, testInfo) => {
    const adminUser = admin(testInfo);
    const contributor = collaborator(testInfo);
    const companyName = unique('Cliente', testInfo);
    const subject = unique('Assunto', testInfo);

    await signIn(page, adminUser.email);
    await createCompanyWithMember(page, companyName, contributor.email);

    await page.getByRole('link', { name: 'Acompanhamentos', exact: true }).click();
    await page.getByRole('button', { name: 'Novo acompanhamento' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Novo acompanhamento' });
    await dialog.getByLabel('Empresa').selectOption({ label: companyName });
    await dialog.getByLabel('Assunto').fill(subject);
    await dialog.getByLabel('Mensagem inicial').fill('Pode confirmar o prazo das fotos?');
    await dialog
      .getByLabel('Responsável')
      .selectOption({ label: `${contributor.name} (${contributor.email})` });
    await dialog.getByRole('button', { name: 'Criar acompanhamento' }).click();

    // Raised by me, so it sits under "awaiting others", not "awaiting you".
    await page.getByRole('button', { name: 'Aguardando outros' }).click();
    await expect(page.getByRole('link', { name: subject })).toBeVisible();

    await page.getByRole('button', { name: 'Sair' }).click();
    await signIn(page, contributor.email);

    await page.getByRole('link', { name: 'Acompanhamentos', exact: true }).click();
    // The default view is exactly what is waiting on this person.
    await expect(page.getByRole('link', { name: subject })).toBeVisible();

    await page.getByRole('link', { name: subject }).click();
    await expect(page.getByText('Aguardando você')).toBeVisible();
    await page.getByLabel('Sua resposta').fill('Confirmado para sexta-feira.');
    await page.getByRole('button', { name: 'Responder' }).click();
    await expect(page.getByText('Confirmado para sexta-feira.')).toBeVisible();

    // Answered, so it is back with whoever raised it.
    await expect(page.getByText('Em análise')).toBeVisible();
    // The responsible party cannot close someone else's topic.
    await expect(page.getByRole('button', { name: 'Marcar como resolvido' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Sair' }).click();
    await signIn(page, adminUser.email);

    await page.getByRole('link', { name: 'Acompanhamentos', exact: true }).click();
    await page.getByRole('button', { name: 'Criados por mim' }).click();
    await page.getByRole('link', { name: subject }).click();

    await expect(page.getByText('Confirmado para sexta-feira.')).toBeVisible();
    page.once('dialog', (confirmation) => void confirmation.accept());
    await page.getByRole('button', { name: 'Marcar como resolvido' }).click();

    await expect(page.getByText('Este acompanhamento foi encerrado.')).toBeVisible();
    await expect(page.getByLabel('Sua resposta')).toHaveCount(0);
  });
});

test.describe('notes on a project', () => {
  test('adds, edits and removes a note', async ({ page }, testInfo) => {
    await signIn(page, admin(testInfo).email);

    const companyName = unique('Cliente', testInfo);
    await page.goto('/empresas/nova');
    await page.getByLabel('Nome').fill(companyName);
    await page.getByRole('button', { name: 'Criar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();

    await page.goto('/projetos/novo');
    await page.getByLabel('Empresa').selectOption({ label: companyName });
    await page.getByLabel('Nome').fill(unique('Projeto', testInfo));
    await page.getByRole('button', { name: 'Criar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar projeto' })).toBeVisible();

    await expect(
      page.getByText('Nenhuma nota ainda. Seja a primeira pessoa a comentar.'),
    ).toBeVisible();

    await page.getByLabel('Nova nota').fill('Combinar o roteiro com o cliente.');
    await page.getByRole('button', { name: 'Comentar' }).click();
    await expect(page.getByText('Combinar o roteiro com o cliente.')).toBeVisible();

    await page.getByRole('button', { name: 'Editar' }).last().click();
    await page.getByLabel('Texto').fill('Roteiro já combinado.');
    await page.getByRole('button', { name: 'Salvar' }).last().click();
    await expect(page.getByText('Roteiro já combinado.')).toBeVisible();

    page.once('dialog', (confirmation) => void confirmation.accept());
    await page.getByRole('button', { name: 'Excluir' }).last().click();
    await expect(
      page.getByText('Nenhuma nota ainda. Seja a primeira pessoa a comentar.'),
    ).toBeVisible();
  });
});
