import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { E2E_PASSWORD, admin } from '../../fixtures';

/**
 * The deployed site, exercised the way the first administrator will meet it: the
 * health probe, the public sign-in screen, the session cookie's flags, the shell, a
 * company created and a file sent straight to storage from a real browser (which is
 * what proves the storage CORS rule for this origin), then archived, then sign-out.
 *
 * It runs in two places. In the normal suite, against the local servers with the
 * fixture administrator. Through playwright.online.config.ts, against a published
 * environment with the account named by E2E_ONLINE_ADMIN_EMAIL / _PASSWORD — an
 * account whose password has already been changed once, since the forced change on
 * first sign-in is a person's job. It leaves behind one archived company named for
 * what it is; nothing else.
 */

function account(testInfo: TestInfo) {
  const email = process.env.E2E_ONLINE_ADMIN_EMAIL;
  const password = process.env.E2E_ONLINE_ADMIN_PASSWORD;
  return email && password ? { email, password } : { ...admin(testInfo), password: E2E_PASSWORD };
}

function bytes(length: number): Buffer {
  const buffer = Buffer.allocUnsafe(length);
  for (let index = 0; index < length; index += 1) buffer[index] = (index * 31 + 7) & 0xff;
  return buffer;
}

async function submitLogin(page: Page, email: string, password: string) {
  await page.goto('/entrar');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().includes('/api/auth/login')),
    page.getByRole('button', { name: 'Entrar' }).click(),
  ]);
  return response;
}

test.describe('the deployed site', () => {
  test.setTimeout(180_000);

  test('serves, signs in with a safe cookie, stores a file, and signs out', async ({
    page,
    baseURL,
  }, testInfo) => {
    const user = account(testInfo);
    const secure = (baseURL ?? '').startsWith('https://');
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const companyName = `Validação online ${testInfo.project.name} ${stamp}`;

    // The API answers through the same origin the browser uses, database included.
    // Only the published site routes /health through the proxy; the Vite dev server
    // used locally proxies /api alone, so there this probe would only see index.html.
    if (process.env.E2E_ONLINE_BASE_URL) {
      const health = await page.request.get('/health/ready');
      expect(health.status()).toBe(200);
      expect(await health.json()).toMatchObject({ status: 'ok', database: 'ok' });
    }

    // Anonymous: the shell is closed, the sign-in screen is public and branded.
    await page.goto('/sessoes');
    await expect(page).toHaveURL(/\/entrar$/);
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();

    const login = await submitLogin(page, user.email, user.password);
    expect(login.status()).toBe(200);
    // The cookie is what authenticates every later request: never script-readable,
    // and over HTTPS never sent in the clear (10-authentication-and-sessions.md).
    const cookies = await page.context().cookies();
    const session = cookies.find((candidate) => candidate.name === 'agency_hub_session');
    expect(session, 'session cookie').toBeDefined();
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe('Lax');
    if (secure) expect(session?.secure).toBe(true);

    await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();
    await expect(page.getByText('O que precisa da sua atenção agora')).toBeVisible();

    // The shell: the bell polls, the sessions screen knows which session this is.
    await page.getByRole('link', { name: /Abrir notificações/ }).click();
    await expect(page.getByRole('heading', { name: 'Notificações', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Sessões ativas', exact: true }).click();
    await expect(page.getByText('Esta sessão')).toBeVisible();

    // A company, and a file sent from this browser straight to storage. Online this is
    // the one check that proves the bucket's CORS rule for this origin and that the
    // bytes never pass through the API.
    await page.goto('/empresas/nova');
    await page.getByLabel('Nome').fill(companyName);
    await page
      .getByLabel('Observações')
      .fill('Criada pela validação automática; pode ser arquivada.');
    await page.getByRole('button', { name: 'Criar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();

    await page.getByRole('link', { name: 'Arquivos', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Arquivos', exact: true })).toBeVisible();
    await page.getByLabel('Empresa').selectOption({ label: companyName });
    await expect(page.getByRole('heading', { name: 'Enviar arquivos' })).toBeVisible();

    const partPut = page.waitForRequest(
      (request) => request.method() === 'PUT' && request.url().includes('X-Amz-Signature'),
    );
    await page.setInputFiles('#file-uploader-input', {
      name: 'validacao-online.pdf',
      mimeType: 'application/pdf',
      buffer: bytes(64 * 1024),
    });
    const put = await partPut;
    expect(new URL(put.url()).origin).not.toBe(new URL(baseURL ?? put.url()).origin);
    await expect(page.getByText('Concluído', { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(
      page.getByRole('listitem').filter({ hasText: 'validacao-online.pdf' }).last(),
    ).toBeVisible();

    const [download] = await Promise.all([
      page.waitForResponse((response) => response.url().includes('/download')),
      page.getByRole('button', { name: 'Baixar' }).first().click(),
    ]);
    const signedUrl = (await download.json()).data.url as string;
    expect(signedUrl).toContain('X-Amz-Signature');
    const stored = await page.request.get(signedUrl);
    expect(stored.status()).toBe(200);
    expect((await stored.body()).byteLength).toBe(64 * 1024);

    // Archived, so the validation leaves a visibly retired company rather than a live one.
    await page.getByRole('link', { name: 'Empresas', exact: true }).click();
    await page.getByLabel('Buscar').fill(companyName);
    await page.getByRole('button', { name: 'Buscar' }).click();
    await page.getByRole('link', { name: 'Editar' }).first().click();
    await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Arquivar' }).click();
    await expect(page.getByRole('button', { name: 'Reativar' })).toBeVisible();

    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
    await page.goto('/');
    await expect(page).toHaveURL(/\/entrar$/);
  });
});
