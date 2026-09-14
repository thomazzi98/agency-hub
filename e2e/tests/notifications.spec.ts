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

test.describe('notifications', () => {
  test.setTimeout(120_000);

  test('an event reaches the recipient, deep-links, and clears the badge', async ({
    page,
  }, testInfo) => {
    const companyName = unique('Cliente', testInfo);
    const title = unique('Enviar material', testInfo);
    const recipient = collaborator(testInfo);

    await signIn(page, admin(testInfo).email);

    await page.goto('/empresas/nova');
    await page.getByLabel('Nome').fill(companyName);
    await page.getByRole('button', { name: 'Criar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();

    await page.getByRole('link', { name: 'Usuários', exact: true }).click();
    await page.getByLabel('Buscar').fill(recipient.email);
    await page.getByRole('button', { name: 'Buscar' }).click();
    await page.getByRole('link', { name: 'Editar' }).first().click();
    await page.getByLabel('Empresa').selectOption({ label: companyName });
    await page.getByRole('button', { name: 'Vincular empresa' }).click();
    await expect(page.getByRole('status').first()).toHaveText('Acesso concedido.');

    await page.getByRole('link', { name: 'Pendências', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pendências' })).toBeVisible();
    await page.getByLabel('Empresa').selectOption({ label: companyName });
    await page.getByRole('button', { name: 'Nova pendência' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova pendência' });
    await dialog.getByLabel('Título').fill(title);
    await dialog.getByLabel('Descrição').fill('Precisamos do vídeo bruto.');
    await dialog.getByLabel('Responsável').selectOption({ label: recipient.name });
    await dialog.getByRole('button', { name: 'Criar pendência' }).click();
    await page.getByRole('button', { name: 'Todas' }).click();
    await expect(page.getByRole('link', { name: title })).toBeVisible();

    // (That the actor is never notified about their own action is pinned by the
    // integration suite; here the admin legitimately has unread items from other
    // specs, so the badge says nothing useful about this one event.)

    await signOut(page);
    await signIn(page, recipient.email);

    // The badge carries the unread count into the name, so it is announced too.
    const bell = page.getByRole('link', { name: /Abrir notificações \(\d+\)/ });
    await expect(bell).toBeVisible();

    await bell.click();
    await expect(page.getByRole('heading', { name: 'Notificações', exact: true })).toBeVisible();
    await expect(page.getByText('Nova pendência para você').first()).toBeVisible();

    // Opening navigates to the resource and marks it read in the same action.
    await page.getByText(title, { exact: false }).first().click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();

    // Read, so it is gone from the unread view. Asserted against this item rather than
    // against the whole badge: these fixtures are shared, so the account may well have
    // older unread items from another test.
    await page.goto('/notificacoes');
    await page.getByLabel('Somente não lidas').check();
    await expect(page.getByText(title, { exact: false })).toHaveCount(0);
  });

  test('a push preference can be turned off without touching the in-app centre', async ({
    page,
  }, testInfo) => {
    await signIn(page, admin(testInfo).email);
    await page.goto('/notificacoes');

    // Written against whatever the account currently has rather than a fixed default:
    // this suite shares its fixtures across runs, and a preference is meant to persist.
    const preference = page.getByLabel('Você foi mencionado');
    await expect(preference).toBeVisible();
    const wasOn = await preference.isChecked();

    await preference.click();
    await expect(preference).toBeChecked({ checked: !wasOn });
    await expect(page.getByText('Preferência salva.')).toBeVisible();

    await page.reload();
    const reloaded = page.getByLabel('Você foi mencionado');
    await expect(reloaded).toBeChecked({ checked: !wasOn });

    // Put it back, so a rerun of this suite starts from where it found things.
    await reloaded.click();
    await expect(reloaded).toBeChecked({ checked: wasOn });

    // In-app is the system of record and is not offered as something to switch off.
    await expect(page.getByText('A lista de notificações no app recebe tudo.')).toBeVisible();
  });
});

test.describe('push devices', () => {
  test.setTimeout(120_000);

  /**
   * Two browser facilities are stood in for here, because headless Chromium has neither:
   * the permission prompt (the headless shell answers "denied" regardless of what the
   * context was granted) and a push service to subscribe against. The prompt is answered
   * "granted" and `PushManager.subscribe` returns a subscription shaped exactly like a
   * real one — endpoint plus the two keys. Everything else is real: the service worker,
   * and the register/list/revoke contract with the server. Delivery itself is a
   * real-device check (docs/deployment.md).
   */
  test('registers this browser, lists it, and removes it only after confirming', async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
      Notification.requestPermission = async () => 'granted';
      const fake = {
        endpoint: `https://push.example.test/e2e/${Math.random().toString(36).slice(2)}`,
        getKey: (name: string) =>
          new Uint8Array(name === 'p256dh' ? 65 : 16).fill(7).buffer as ArrayBuffer,
        unsubscribe: async () => true,
      };
      PushManager.prototype.subscribe = async () => fake as unknown as PushSubscription;
      PushManager.prototype.getSubscription = async () => null;
    });

    await signIn(page, admin(testInfo).email);
    await page.goto('/notificacoes');
    await expect(page.getByRole('heading', { name: 'Notificações', exact: true })).toBeVisible();

    // The explanation is on screen before the browser is ever asked
    // (08-notifications-and-push.md).
    await expect(
      page.getByText('Podemos avisar você no navegador', { exact: false }),
    ).toBeVisible();
    await expect(page.getByText('Nenhum dispositivo registrado.')).toBeVisible();

    const registered = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith('/api/push/devices'),
    );
    await page.getByRole('button', { name: 'Ativar avisos neste dispositivo' }).click();
    expect((await registered).status()).toBe(201);
    await expect(page.getByText('Avisos ativados neste dispositivo.')).toBeVisible();

    // Listed by what tells devices apart, never by its endpoint.
    const devices = page.getByRole('heading', { name: 'Dispositivos registrados' }).locator('..');
    await expect(devices.getByRole('listitem')).toHaveCount(1);
    await expect(devices.getByText('Nenhum dispositivo registrado.')).toHaveCount(0);

    // Dismissed: the device is still reachable (22-acceptance-criteria.md #29).
    page.once('dialog', (dialog) => void dialog.dismiss());
    await devices.getByRole('button', { name: 'Remover' }).click();
    await expect(devices.getByRole('listitem')).toHaveCount(1);

    // Accepted: revoked on the server, gone from the list.
    const revoked = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' && response.url().includes('/api/push/devices/'),
    );
    page.once('dialog', (dialog) => void dialog.accept());
    await devices.getByRole('button', { name: 'Remover' }).click();
    expect((await revoked).status()).toBe(200);
    await expect(page.getByText('Dispositivo removido.')).toBeVisible();
    await expect(page.getByText('Nenhum dispositivo registrado.')).toBeVisible();

    // A reload confirms the server agrees, not just the screen.
    await page.reload();
    await expect(page.getByText('Nenhum dispositivo registrado.')).toBeVisible();
  });
});

test.describe('the notification centre', () => {
  test.setTimeout(120_000);

  test('marks everything read at once and the badge goes quiet', async ({ page }, testInfo) => {
    const companyName = unique('Cliente', testInfo);
    const recipient = collaborator(testInfo);

    await signIn(page, admin(testInfo).email);
    await page.goto('/empresas/nova');
    await page.getByLabel('Nome').fill(companyName);
    await page.getByRole('button', { name: 'Criar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar empresa' })).toBeVisible();

    await page.getByRole('link', { name: 'Usuários', exact: true }).click();
    await page.getByLabel('Buscar').fill(recipient.email);
    await page.getByRole('button', { name: 'Buscar' }).click();
    await page.getByRole('link', { name: 'Editar' }).first().click();
    await page.getByLabel('Empresa').selectOption({ label: companyName });
    await page.getByRole('button', { name: 'Vincular empresa' }).click();
    await expect(page.getByRole('status').first()).toHaveText('Acesso concedido.');

    // Two events, so "all" means more than one.
    await page.getByRole('link', { name: 'Pendências', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pendências' })).toBeVisible();
    await page.getByLabel('Empresa').selectOption({ label: companyName });
    for (const title of [unique('Primeira', testInfo), unique('Segunda', testInfo)]) {
      await page.getByRole('button', { name: 'Nova pendência' }).click();
      const dialog = page.getByRole('dialog', { name: 'Nova pendência' });
      await dialog.getByLabel('Título').fill(title);
      await dialog.getByLabel('Descrição').fill('Material para esta semana.');
      await dialog.getByLabel('Responsável').selectOption({ label: recipient.name });
      await dialog.getByRole('button', { name: 'Criar pendência' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await signOut(page);

    await signIn(page, recipient.email);
    await expect(page.getByRole('link', { name: /Abrir notificações \(\d+\)/ })).toBeVisible();

    await page.goto('/notificacoes');
    await page.getByLabel('Somente não lidas').check();
    await expect(page.getByRole('listitem').first()).toBeVisible();

    await page.getByRole('button', { name: 'Marcar todas como lidas' }).click();
    await expect(page.getByText('Tudo marcado como lido.')).toBeVisible();

    // Nothing unread is left anywhere: not in the filtered list, not on the bell.
    await expect(page.getByText('Você está em dia.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Abrir notificações', exact: true })).toBeVisible();

    // Everything is still there once the filter is lifted — read, not deleted.
    await page.getByLabel('Somente não lidas').uncheck();
    await expect(page.getByRole('listitem').first()).toBeVisible();
  });
});
