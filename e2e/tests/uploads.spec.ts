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
  await page.getByRole('link', { name: 'Arquivos' }).click();
  await expect(page.getByRole('heading', { name: 'Arquivos' })).toBeVisible();
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
    await page.getByRole('link', { name: 'Usuários' }).click();
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

    await page.getByRole('button', { name: 'Sair' }).click();

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

    await page.getByRole('button', { name: 'Sair' }).click();
    await signIn(page, adminUser.email);

    await page.getByRole('link', { name: 'Solicitações de exclusão' }).click();
    await expect(page.getByText('Material enviado por engano.')).toBeVisible();

    await page.getByLabel('Observações da análise').fill('Confirmado com a equipe.');
    page.once('dialog', (confirmation) => void confirmation.accept());
    await page.getByRole('button', { name: 'Aprovar' }).click();
    await expect(page.getByRole('status').first()).toHaveText('Exclusão aprovada.');

    await openFilesFor(page, companyName);
    await expect(page.getByText('material.jpg')).toHaveCount(0);
  });
});
