import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, admin, campaignManager } from '../fixtures';

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

async function createCompany(page: Page, name: string) {
  await page.goto('/empresas/nova');
  await page.getByLabel('Nome').fill(name);
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();
}

async function openCampaignsFor(page: Page, companyName: string) {
  await page.getByRole('link', { name: 'Campanhas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Campanhas' })).toBeVisible();
  await page.getByLabel('Empresa').selectOption({ label: companyName });
}

test.describe('campaigns', () => {
  test.setTimeout(120_000);

  test('registers a campaign and records every edit in its history', async ({ page }, testInfo) => {
    const companyName = unique('Cliente', testInfo);
    const campaignName = unique('Campanha', testInfo);

    await signIn(page, admin(testInfo).email);
    await createCompany(page, companyName);
    await openCampaignsFor(page, companyName);

    // The manual-data notice is a display requirement, not just a data one.
    await expect(
      page
        .getByText('O sistema não lê dados das plataformas de anúncios.', { exact: false })
        .first(),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Nova conta de anúncios' }).click();
    const accountDialog = page.getByRole('dialog', { name: 'Nova conta de anúncios' });
    await accountDialog.getByLabel('Plataforma', { exact: true }).selectOption('meta');
    await accountDialog.getByLabel('Nome', { exact: true }).fill('Conta principal');
    await accountDialog.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Nova campanha' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova campanha' });
    await dialog
      .getByLabel('Conta de anúncios')
      .selectOption({ label: 'Conta principal · Meta Ads' });
    await dialog.getByLabel('Nome', { exact: true }).fill(campaignName);
    await dialog.getByLabel(/Orçamento diário/).fill('200');
    await dialog.getByRole('button', { name: 'Criar campanha' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await expect(page.getByRole('link', { name: campaignName })).toBeVisible();
    await expect(page.getByText('R$ 200,00').first()).toBeVisible();

    await page.getByRole('link', { name: campaignName }).click();
    await expect(page.getByRole('heading', { name: campaignName })).toBeVisible();
    await expect(page.getByText('Nenhuma alteração registrada ainda.')).toBeVisible();

    await page.getByLabel('Situação').selectOption('with_problem');
    await page.getByLabel('Motivo da alteração').fill('Reprovada pela plataforma.');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Campanha atualizada.')).toBeVisible();

    // Who changed what, from what to what, and why.
    await expect(page.getByText('Situação', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Reprovada pela plataforma.')).toBeVisible();
    // `with_problem` reads "Com problema" — one of the three statuses that mean a
    // person set this to say "look at me".
    await expect(page.getByText('Com problema').first()).toBeVisible();
  });

  test('a manager without the override cannot edit', async ({ page }, testInfo) => {
    const companyName = unique('Cliente', testInfo);
    const campaignName = unique('Campanha', testInfo);
    const gestor = campaignManager(testInfo);

    await signIn(page, admin(testInfo).email);
    await createCompany(page, companyName);

    await page.getByRole('link', { name: 'Usuários', exact: true }).click();
    await page.getByLabel('Buscar').fill(gestor.email);
    await page.getByRole('button', { name: 'Buscar' }).click();
    await page.getByRole('link', { name: 'Editar' }).first().click();
    await page.getByLabel('Empresa').selectOption({ label: companyName });
    await page.getByRole('button', { name: 'Vincular empresa' }).click();
    await expect(page.getByRole('status').first()).toHaveText('Acesso concedido.');

    await openCampaignsFor(page, companyName);
    await page.getByRole('button', { name: 'Nova conta de anúncios' }).click();
    const accountDialog = page.getByRole('dialog', { name: 'Nova conta de anúncios' });
    await accountDialog.getByLabel('Nome', { exact: true }).fill('Conta principal');
    await accountDialog.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Nova campanha' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova campanha' });
    await dialog
      .getByLabel('Conta de anúncios')
      .selectOption({ label: 'Conta principal · Meta Ads' });
    await dialog.getByLabel('Nome', { exact: true }).fill(campaignName);
    await dialog.getByRole('button', { name: 'Criar campanha' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await signOut(page);
    await signIn(page, gestor.email);
    await openCampaignsFor(page, companyName);

    // They can see it — the override is about editing, not reading.
    await expect(page.getByRole('link', { name: campaignName })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nova campanha' })).toHaveCount(0);

    await page.getByRole('link', { name: campaignName }).click();
    await expect(page.getByRole('heading', { name: campaignName })).toBeVisible();
    await expect(page.getByLabel('Motivo da alteração')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Salvar' })).toHaveCount(0);
  });
});
