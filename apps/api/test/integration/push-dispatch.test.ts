import type { Company, User } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestCompany, createTestUser, grantMembership } from '../helpers/app.js';
import { closeTestPrisma, resetDatabase, systemRead, testPrisma } from '../helpers/prisma.js';
import { resetEnvCache } from '../../src/config/env.js';
import { dispatchPushNotifications } from '../../src/jobs/dispatch-push-notifications.js';

/**
 * The push sweep, with the push service itself stood in for: nothing here can reach one,
 * and what is worth proving is which notifications the sweep decides to send.
 */
const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));

vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification },
  WebPushError: class WebPushError extends Error {
    statusCode = 0;
  },
}));

const prisma = testPrisma();
const MINUTE = 60 * 1000;

interface World {
  company: Company;
  withDevice: User;
  withoutDevice: User;
}

let world: World;
const VAPID_KEYS = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;
const savedVapid = Object.fromEntries(VAPID_KEYS.map((key) => [key, process.env[key]]));

beforeEach(async () => {
  await resetDatabase();
  sendNotification.mockReset();
  sendNotification.mockResolvedValue({ statusCode: 201 });

  // Any triple turns push on; the service that would use it is mocked above.
  process.env.VAPID_PUBLIC_KEY = 'chave-publica';
  process.env.VAPID_PRIVATE_KEY = 'chave-privada';
  process.env.VAPID_SUBJECT = 'mailto:teste@example.com';
  resetEnvCache();

  const company = await createTestCompany('Empresa Push');
  const [withDevice, withoutDevice] = await Promise.all([
    createTestUser({ email: 'push-device@example.com', role: 'agency_manager' }),
    createTestUser({ email: 'push-none@example.com', role: 'client_manager' }),
  ]);
  await Promise.all([
    grantMembership(withDevice.id, company.id),
    grantMembership(withoutDevice.id, company.id),
  ]);
  await systemRead((tx) =>
    tx.pushDevice.create({
      data: {
        userId: withDevice.id,
        endpoint: 'https://push.example.com/endpoint/device-1',
        p256dhKey: 'chave',
        authKey: 'segredo',
      },
    }),
  );

  world = { company, withDevice, withoutDevice };
});

afterEach(() => {
  for (const key of VAPID_KEYS) {
    if (savedVapid[key] === undefined) delete process.env[key];
    else process.env[key] = savedVapid[key];
  }
  resetEnvCache();
});

afterAll(async () => {
  await closeTestPrisma();
});

function notification(recipientId: string, createdAt: Date, relatedId = crypto.randomUUID()) {
  return {
    recipientId,
    companyId: world.company.id,
    // On by default for push, so only the sweep's own rules decide.
    type: 'user.mentioned',
    title: 'Você foi mencionado',
    message: 'Olha isto.',
    relatedType: 'content',
    relatedId,
    createdAt,
  };
}

describe('the push sweep', () => {
  it('is not blocked by a backlog of notifications it can never push', async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * MINUTE);
    await systemRead((tx) =>
      tx.notification.createMany({
        // More than a whole batch, older than the one that matters, for someone with no
        // device - they used to fill the oldest-first batch every single minute.
        data: Array.from({ length: 250 }, () =>
          notification(world.withoutDevice.id, tenMinutesAgo),
        ),
      }),
    );
    await systemRead((tx) =>
      tx.notification.create({ data: notification(world.withDevice.id, new Date()) }),
    );

    const result = await dispatchPushNotifications(prisma);

    expect(result.sent).toBe(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0]?.[0]).toMatchObject({
      endpoint: 'https://push.example.com/endpoint/device-1',
    });
  });

  it('leaves alone what is too old to be worth a buzz', async () => {
    await systemRead((tx) =>
      tx.notification.create({
        data: notification(world.withDevice.id, new Date(Date.now() - 2 * 60 * MINUTE)),
      }),
    );

    const result = await dispatchPushNotifications(prisma);

    expect(result.considered).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('pushes a notification once, not on every sweep', async () => {
    await systemRead((tx) =>
      tx.notification.create({ data: notification(world.withDevice.id, new Date()) }),
    );

    await dispatchPushNotifications(prisma);
    await dispatchPushNotifications(prisma);

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [stored] = await systemRead((tx) => tx.notification.findMany());
    expect(stored?.pushSentAt).not.toBeNull();
  });
});
