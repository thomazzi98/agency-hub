import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, admin, collaborator } from '../fixtures';

/**
 * The upload path end to end in a real browser: Uppy splits the file, PUTs each part
 * straight to storage with a presigned URL, and the backend only signs and records.
 * These are the cases the spec calls out as must-work, not a smoke test.
 */

async function signIn(page: Page, email: string) {
  await page.goto('/entrar');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();
}

/**
 * Signing out navigates on its own once the request lands. Reaching for the sign-in
 * form before that redirect has happened races it - on a slow runner the test's own
 * navigation is aborted by the page's - so wait for the form first.
 */
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

async function openFilesFor(page: Page, companyName: string) {
  await page.getByRole('link', { name: 'Arquivos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Arquivos', exact: true })).toBeVisible();
  await page.getByLabel('Empresa').selectOption({ label: companyName });
  await expect(page.getByRole('heading', { name: 'Enviar arquivos' })).toBeVisible();
}

/** Deterministic bytes so the reported size is exactly what was sent. */
function bytes(length: number): Buffer {
  const buffer = Buffer.allocUnsafe(length);
  for (let index = 0; index < length; index += 1) {
    buffer[index] = (index * 31 + 7) & 0xff;
  }
  return buffer;
}

test.describe('uploading', () => {
  test('uploads a small file straight to storage and lists it', async ({ page }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    const companyName = unique('Cliente', testInfo);
    await createCompany(page, companyName);
    await openFilesFor(page, companyName);

    await page.setInputFiles('#file-uploader-input', {
      name: 'briefing.pdf',
      mimeType: 'application/pdf',
      buffer: bytes(64 * 1024),
    });

    await expect(page.getByText('Concluído', { exact: true })).toBeVisible({ timeout: 30_000 });

    // The listed row, not the uploader's progress line, is what proves it was stored.
    const row = page.getByRole('listitem').filter({ hasText: 'briefing.pdf' }).last();
    await expect(row).toBeVisible();
    await expect(row.getByText('64 KB', { exact: false })).toBeVisible();
  });

  test('splits a file over the part size into several parts and assembles it', async ({
    page,
  }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    const companyName = unique('Cliente', testInfo);
    await createCompany(page, companyName);
    await openFilesFor(page, companyName);

    // Above the 5 MiB part size the E2E API runs with, so this is genuinely multipart.
    await page.setInputFiles('#file-uploader-input', {
      name: 'video.mp4',
      mimeType: 'video/mp4',
      buffer: bytes(6 * 1024 * 1024),
    });

    await expect(page.getByText('Concluído', { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    await expect(page.getByText('video.mp4').first()).toBeVisible();
  });

  test('refuses a file type outside the allow-list before sending anything', async ({
    page,
  }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    const companyName = unique('Cliente', testInfo);
    await createCompany(page, companyName);
    await openFilesFor(page, companyName);

    await page.setInputFiles('#file-uploader-input', {
      name: 'script.sh',
      mimeType: 'application/x-sh',
      buffer: Buffer.from('#!/bin/sh\necho oi\n'),
    });

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText('Concluído', { exact: true })).toHaveCount(0);
  });

  test('hands back a working download link', async ({ page }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    const companyName = unique('Cliente', testInfo);
    await createCompany(page, companyName);
    await openFilesFor(page, companyName);

    await page.setInputFiles('#file-uploader-input', {
      name: 'contrato.pdf',
      mimeType: 'application/pdf',
      buffer: bytes(32 * 1024),
    });
    await expect(page.getByText('Concluído', { exact: true })).toBeVisible({ timeout: 30_000 });

    const [downloadResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes('/download')),
      page.getByRole('button', { name: 'Baixar' }).first().click(),
    ]);

    const signedUrl = (await downloadResponse.json()).data.url as string;
    // Straight at storage, not through the API — the bytes never pass through it.
    expect(signedUrl).toContain('X-Amz-Signature');
    expect(signedUrl).not.toContain('/api/');

    // And it actually serves the file that was uploaded.
    const stored = await page.request.get(signedUrl);
    expect(stored.status()).toBe(200);
    expect((await stored.body()).byteLength).toBe(32 * 1024);
  });

  test('finds a file by name wherever it was filed', async ({ page }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    const companyName = unique('Cliente', testInfo);
    await createCompany(page, companyName);
    await openFilesFor(page, companyName);

    // Filed two levels away from where the search starts.
    await page.getByLabel('Nome da pasta').fill('Fotos');
    await page.getByRole('button', { name: 'Nova pasta' }).click();
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Fotos' })
      .getByRole('button', { name: 'Abrir' })
      .click();
    await page.setInputFiles('#file-uploader-input', {
      name: 'fachada-principal.jpg',
      mimeType: 'image/jpeg',
      buffer: bytes(16 * 1024),
    });
    await expect(page.getByText('Concluído', { exact: true })).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Raiz' }).click();
    await page.getByLabel('Buscar arquivo pelo nome').fill('fachada');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();

    await expect(page.getByText(/Resultados para "fachada"/)).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'fachada-principal.jpg' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Limpar busca' }).click();
    await expect(page.getByRole('navigation', { name: 'Caminho' })).toBeVisible();
  });
});

test.describe('deleting a file someone else uploaded', () => {
  // A full journey: grant access, upload, request, sign in as someone else, approve.
  // The default 30s covers a single interaction, not a story this long.
  test.setTimeout(120_000);

  test('routes a contributor through request and admin approval', async ({ page }, testInfo) => {
    const adminUser = admin(testInfo);
    const contributor = collaborator(testInfo);
    const companyName = unique('Cliente', testInfo);

    await signIn(page, adminUser.email);
    await createCompany(page, companyName);

    // Give the contributor access to this company.
    await page.getByRole('link', { name: 'Usuários', exact: true }).click();
    await page.getByLabel('Buscar').fill(contributor.email);
    await page.getByRole('button', { name: 'Buscar' }).click();
    await page.getByRole('link', { name: 'Editar' }).first().click();
    await expect(page.getByRole('heading', { name: 'Editar usuário' })).toBeVisible();
    await page.getByLabel('Empresa').selectOption({ label: companyName });
    await page.getByRole('button', { name: 'Vincular empresa' }).click();
    await expect(page.getByRole('status').first()).toHaveText('Acesso concedido.');

    // The admin uploads the file, so it is not the contributor's to delete.
    await openFilesFor(page, companyName);
    await page.setInputFiles('#file-uploader-input', {
      name: 'material.jpg',
      mimeType: 'image/jpeg',
      buffer: bytes(24 * 1024),
    });
    await expect(page.getByText('Concluído', { exact: true })).toBeVisible({ timeout: 30_000 });

    await signOut(page);

    await signIn(page, contributor.email);
    await openFilesFor(page, companyName);

    // No direct delete: the contributor is offered the request flow instead.
    await expect(page.getByRole('button', { name: 'Excluir' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Solicitar exclusão' }).click();

    const dialog = page.getByRole('dialog', { name: 'Solicitar exclusão' });
    await dialog.getByLabel('Motivo').fill('Material enviado por engano.');
    await dialog.getByRole('button', { name: 'Enviar solicitação' }).click();
    await expect(page.getByRole('status').first()).toHaveText('Solicitação enviada para análise.');

    // The file is still there until an admin decides.
    await expect(page.getByText('material.jpg').first()).toBeVisible();

    await signOut(page);
    await signIn(page, adminUser.email);

    await page.getByRole('link', { name: 'Solicitações de exclusão', exact: true }).click();
    await expect(page.getByText('Material enviado por engano.')).toBeVisible();
    // What is to be deleted, where, and at whose request - not just "Arquivo".
    const pendingRequest = page
      .getByRole('listitem')
      .filter({ hasText: 'Material enviado por engano.' });
    await expect(pendingRequest.getByText('material.jpg')).toBeVisible();
    await expect(pendingRequest.getByText(companyName)).toBeVisible();
    await expect(pendingRequest.getByText(contributor.name)).toBeVisible();

    await page.getByLabel('Observações da análise').fill('Confirmado com a equipe.');
    page.once('dialog', (confirmation) => void confirmation.accept());
    await page.getByRole('button', { name: 'Aprovar' }).click();
    await expect(page.getByRole('status').first()).toHaveText('Exclusão aprovada.');

    await openFilesFor(page, companyName);
    await expect(page.getByText('material.jpg')).toHaveCount(0);
  });
});

/**
 * Parks every part PUT to storage until released, so a transfer can be caught mid-flight
 * deterministically instead of racing a loopback MinIO that finishes 6 MiB in well under
 * a second. Requests the page aborts meanwhile (pause, cancel) are simply let go.
 */
async function holdStoragePuts(page: Page) {
  let holding = true;
  const parked: Array<() => void> = [];
  await page.route(/:9000\//, async (route) => {
    if (route.request().method() !== 'PUT' || !holding) return route.continue();
    await new Promise<void>((resolve) => parked.push(resolve));
    await route.continue().catch(() => undefined);
  });
  const firstPut = page.waitForRequest(
    (request) => request.method() === 'PUT' && request.url().includes(':9000/'),
  );
  return {
    firstPut,
    release: () => {
      holding = false;
      for (const resume of parked.splice(0)) resume();
    },
  };
}

test.describe('upload lifecycle controls', () => {
  test.setTimeout(120_000);

  test('sends several files at once and lists every one of them', async ({ page }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    const companyName = unique('Cliente', testInfo);
    await createCompany(page, companyName);
    await openFilesFor(page, companyName);

    const names = ['roteiro.pdf', 'capa.jpg', 'teaser.mp4'] as const;
    await page.setInputFiles('#file-uploader-input', [
      { name: names[0], mimeType: 'application/pdf', buffer: bytes(64 * 1024) },
      { name: names[1], mimeType: 'image/jpeg', buffer: bytes(96 * 1024) },
      { name: names[2], mimeType: 'video/mp4', buffer: bytes(128 * 1024) },
    ]);

    // One row per file, each with its own progress, all finishing.
    await expect(page.getByRole('progressbar')).toHaveCount(3);
    await expect(page.getByText('Concluído', { exact: true })).toHaveCount(3, { timeout: 60_000 });
    for (const name of names) {
      await expect(page.getByRole('listitem').filter({ hasText: name }).last()).toBeVisible();
    }

    // The finished rows can be cleared; the stored files stay listed.
    await page.getByRole('button', { name: 'Limpar concluídos' }).click();
    await expect(page.getByText('Concluído', { exact: true })).toHaveCount(0);
    await expect(page.getByText(names[0]).first()).toBeVisible();
  });

  test('pauses a transfer and resumes it to completion', async ({ page }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    const companyName = unique('Cliente', testInfo);
    await createCompany(page, companyName);
    await openFilesFor(page, companyName);

    const storage = await holdStoragePuts(page);
    await page.setInputFiles('#file-uploader-input', {
      name: 'entrevista.mp4',
      mimeType: 'video/mp4',
      buffer: bytes(6 * 1024 * 1024),
    });
    await storage.firstPut;

    await page.getByRole('button', { name: 'Pausar' }).click();
    await expect(page.getByText('Pausado', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retomar' })).toBeVisible();

    // Nothing finishes on its own while paused, even with storage answering again.
    storage.release();
    await expect(page.getByText('Concluído', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Retomar' }).click();
    await expect(page.getByText('Concluído', { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    await expect(
      page.getByRole('listitem').filter({ hasText: 'entrevista.mp4' }).last(),
    ).toBeVisible();
  });

  test('cancelling asks first, then aborts the session on the server', async ({
    page,
  }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    const companyName = unique('Cliente', testInfo);
    await createCompany(page, companyName);
    await openFilesFor(page, companyName);

    const storage = await holdStoragePuts(page);
    await page.setInputFiles('#file-uploader-input', {
      name: 'bastidores.mp4',
      mimeType: 'video/mp4',
      buffer: bytes(6 * 1024 * 1024),
    });
    await storage.firstPut;

    // Dismissed: still in flight, still controllable (22-acceptance-criteria.md #29).
    page.once('dialog', (dialog) => void dialog.dismiss());
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('button', { name: 'Pausar' })).toBeVisible();
    await expect(page.getByText('Cancelado', { exact: true })).toHaveCount(0);

    // Accepted: the browser stops, and the server is told to release the parts.
    const aborted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/uploads\/[^/]+\/abort$/.test(response.url()),
    );
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByText('Cancelado', { exact: true })).toBeVisible();
    expect((await aborted).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Pausar' })).toHaveCount(0);

    storage.release();
    await expect(page.getByText('Concluído', { exact: true })).toHaveCount(0);
  });

  test('a failed start is reported on the row, and the same file can be sent again', async ({
    page,
  }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    const companyName = unique('Cliente', testInfo);
    await createCompany(page, companyName);
    await openFilesFor(page, companyName);

    await page.route('**/api/uploads', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal_error', message: 'x' } }),
      });
    });

    const file = { name: 'relatorio.pdf', mimeType: 'application/pdf', buffer: bytes(48 * 1024) };
    await page.setInputFiles('#file-uploader-input', file);

    const row = page.getByRole('listitem').filter({ hasText: 'relatorio.pdf' }).first();
    await expect(row.getByText('Falhou', { exact: true })).toBeVisible();
    await expect(row.getByRole('alert')).toContainText('Erro interno');
    await expect(page.getByText('Concluído', { exact: true })).toHaveCount(0);

    // The picker was reset, so choosing the very same file again is a fresh attempt.
    await page.unroute('**/api/uploads');
    await page.setInputFiles('#file-uploader-input', file);
    await expect(page.getByText('Concluído', { exact: true })).toBeVisible({ timeout: 30_000 });
  });

  test('a part refused once by storage is retried, not failed', async ({ page }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    const companyName = unique('Cliente', testInfo);
    await createCompany(page, companyName);
    await openFilesFor(page, companyName);

    // Each part's first attempt meets a transient 503 — the unstable connection
    // 07-upload-architecture.md#retry-strategy is written for.
    const refused = new Set<string>();
    await page.route(/:9000\//, async (route) => {
      const request = route.request();
      if (request.method() !== 'PUT') return route.continue();
      const part = new URL(request.url()).searchParams.get('partNumber') ?? '1';
      if (refused.has(part)) return route.continue();
      refused.add(part);
      await route.fulfill({ status: 503, body: 'try again later' });
    });

    await page.setInputFiles('#file-uploader-input', {
      name: 'instavel.mp4',
      mimeType: 'video/mp4',
      buffer: bytes(6 * 1024 * 1024),
    });

    await expect(page.getByText('Concluído', { exact: true })).toBeVisible({ timeout: 60_000 });
    // Two parts at 5 MiB, so both were refused exactly once and both got through after.
    expect(refused.size).toBe(2);
    await expect(page.getByText('Falhou', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    await expect(
      page.getByRole('listitem').filter({ hasText: 'instavel.mp4' }).last(),
    ).toBeVisible();
  });
});
