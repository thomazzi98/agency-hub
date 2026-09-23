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

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
}

function unique(prefix: string, testInfo: { project: { name: string }; title: string }) {
  const slug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 18);
  return `${prefix}-${testInfo.project.name}-${slug}-${Date.now()}`;
}

test.describe('pending requests', () => {
  test.setTimeout(120_000);

  /**
   * The acceptance criterion for this stage is specifically that the recipient can
   * answer from a phone and that an attached file ends up linked to the request
   * (21-mvp-roadmap.md, Stage 10), so this runs on both viewports.
   */
  test('an agency request is answered by its recipient, with a file attached', async ({
    page,
  }, testInfo) => {
    const companyName = unique('Cliente', testInfo);
    const title = unique('Enviar material', testInfo);
    const recipient = collaborator(testInfo);

    await signIn(page, admin(testInfo).email);

    // A company the recipient can reach.
    await page.goto('/empresas/nova');
    await page.getByLabel('Nome').fill(companyName);
    await page.getByRole('button', { name: 'Criar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();

    await page.getByRole('link', { name: 'Usuários', exact: true }).click();
    await page.getByLabel('Buscar').fill(recipient.email);
    await page.getByRole('button', { name: 'Buscar' }).click();
    await page.getByRole('link', { name: 'Editar' }).first().click();
    await expect(page.getByRole('heading', { name: 'Editar usuário' })).toBeVisible();
    await page.getByLabel('Empresa').selectOption({ label: companyName });
    await page.getByRole('button', { name: 'Vincular empresa' }).click();
    await expect(page.getByRole('status').first()).toHaveText('Acesso concedido.');

    await page.getByRole('link', { name: 'Pendências', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pendências', exact: true })).toBeVisible();
    await page.getByLabel('Empresa').selectOption({ label: companyName });

    await page.getByRole('button', { name: 'Nova pendência' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova pendência' });
    await dialog.getByLabel('Título').fill(title);
    await dialog.getByLabel('Descrição').fill('Precisamos do vídeo bruto desta semana.');
    await dialog.getByLabel('Responsável').selectOption({ label: recipient.name });
    const due = new Date();
    due.setDate(due.getDate() + 3);
    const pad = (part: number) => String(part).padStart(2, '0');
    await dialog
      .getByLabel('Prazo')
      .fill(`${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`);
    await dialog.getByRole('button', { name: 'Criar pendência' }).click();

    // The page opens on "Esperando por mim", and this one is addressed to someone else.
    await page.getByRole('button', { name: 'Todas' }).click();
    await expect(page.getByRole('link', { name: title })).toBeVisible();
    // The deadline reads as the day that was chosen: a date-only value shown through
    // the browser's zone used to come out one day early anywhere west of UTC.
    await expect(
      page.getByText(
        `Prazo: ${pad(due.getDate())}/${pad(due.getMonth() + 1)}/${due.getFullYear()}`,
      ),
    ).toBeVisible();
    await signOut(page);

    // The recipient's side: it is waiting on them, and they answer with a file.
    await signIn(page, recipient.email);
    await page.getByRole('link', { name: 'Pendências', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pendências', exact: true })).toBeVisible();
    await page.getByLabel('Empresa').selectOption({ label: companyName });

    // "Esperando por mim" is the view this page opens on.
    await expect(page.getByRole('link', { name: title })).toBeVisible();
    await expect(page.getByText('Esperando você')).toBeVisible();

    await page.getByRole('link', { name: title }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();

    await page.getByLabel('Responder').fill('Segue o material solicitado.');
    await page.setInputFiles('input[type="file"]', {
      name: 'material.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('conteudo do material'),
    });
    await expect(page.getByText(/^Anexado: material\.txt$/)).toBeVisible();

    await page.getByRole('button', { name: 'Responder' }).click();
    await expect(page.getByText('Resposta enviada.')).toBeVisible();

    // Answering moves the request on, and the response is in the thread.
    await expect(page.getByText('Respondida').first()).toBeVisible();
    await expect(page.getByText('Segue o material solicitado.')).toBeVisible();

    await signOut(page);

    // The agency sees the answer and closes it.
    await signIn(page, admin(testInfo).email);
    await page.getByRole('link', { name: 'Pendências', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pendências', exact: true })).toBeVisible();
    await page.getByLabel('Empresa').selectOption({ label: companyName });
    await page.getByRole('button', { name: 'Todas' }).click();
    await page.getByRole('link', { name: title }).click();

    // The list has a "Situação" filter of its own, so wait for the detail to render
    // before reaching for the one that actually changes the request.
    await expect(page.getByRole('heading', { name: title })).toBeVisible();

    // The answer arrives with who wrote it and the file it carried, which can be opened
    // from the thread itself - the file used to be linked and shown nowhere.
    const answer = page.getByRole('listitem').filter({ hasText: 'Segue o material solicitado.' });
    await expect(answer.getByText(recipient.name)).toBeVisible();
    await expect(answer.getByText(/Anexo: material\.txt/)).toBeVisible();
    await expect(answer.getByRole('button', { name: 'Baixar' })).toBeVisible();

    await page.getByLabel('Situação').selectOption('completed');
    await expect(page.getByText('Pendência atualizada.')).toBeVisible();

    // A closed request no longer offers a reply box.
    await expect(page.getByLabel('Responder')).toHaveCount(0);
  });
});
