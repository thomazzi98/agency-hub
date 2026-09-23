import type { PrismaClient } from '@prisma/client';
import webpush, { WebPushError } from 'web-push';
import { getEnv } from '../config/env.js';
import { withSystemScope } from '../shared/tenant-scope.js';
import { deepLinkFor, pushDefaultFor } from '../modules/notifications/catalog.js';

export const DISPATCH_PUSH_NOTIFICATIONS_JOB = 'dispatch-push-notifications';

/** One sweep never tries to drain an unbounded backlog. */
const BATCH_SIZE = 200;
const HOUR_MS = 60 * 60 * 1000;

/**
 * How old a notification can be and still be worth a push. Push only decides how soon a
 * phone buzzes; past this the centre already has it, and buzzing about something from
 * yesterday - after a worker restart, or a device registered today - helps nobody.
 */
const PUSH_HORIZON_MS = HOUR_MS;

export interface PushDispatchResult {
  considered: number;
  sent: number;
  suppressed: number;
  failed: number;
  revokedDevices: number;
}

let configured = false;

function configureWebPush(): boolean {
  const env = getEnv();
  if (!env.pushEnabled) return false;
  if (!configured) {
    webpush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
    configured = true;
  }
  return true;
}

/**
 * Sends the pushes owed since the last sweep.
 *
 * Push is a best-effort accelerant on an in-app row that already exists and is
 * authoritative (08-notifications-and-push.md#failure-fallback), which is what lets
 * this be a periodic sweep rather than an inline send: a delayed or dropped push costs
 * nothing that the notification centre does not already show.
 *
 * Three gates, all of them configuration rather than constants:
 *  - the recipient has not turned push off for this event type;
 *  - no push has gone to this (recipient, resource) pair inside the window;
 *  - the recipient is under the hourly ceiling.
 */
export async function dispatchPushNotifications(
  prisma: PrismaClient,
  now = new Date(),
): Promise<PushDispatchResult> {
  const result: PushDispatchResult = {
    considered: 0,
    sent: 0,
    suppressed: 0,
    failed: 0,
    revokedDevices: 0,
  };

  if (!configureWebPush()) return result;

  const env = getEnv();
  const windowStart = new Date(now.getTime() - env.PUSH_RESOURCE_WINDOW_SECONDS * 1000);
  const hourStart = new Date(now.getTime() - HOUR_MS);

  // Every read here crosses recipients, so it runs under the system scope — the same
  // reason the cleanup job does. No tenant data is exposed: the payload is built from
  // the notification row itself, which was already scoped when it was created.
  //
  // A row this sweep decides not to push is not marked, so it comes back next minute.
  // Unbounded, the rows that can never be pushed - most people never register a
  // device, and most event types default to in-app only - piled up at the head of an
  // oldest-first batch until they filled all of it, and push stopped for everyone.
  // Hence: recent rows only, only for people with a device to push to, newest first.
  const pending = await withSystemScope(prisma, (tx) =>
    tx.notification.findMany({
      where: {
        readAt: null,
        createdAt: { gte: new Date(now.getTime() - PUSH_HORIZON_MS) },
        OR: [{ pushSentAt: null }, { pushSentAt: { lt: prisma.notification.fields.createdAt } }],
        recipient: { pushDevices: { some: { enabled: true, revokedAt: null } } },
      },
      select: {
        id: true,
        recipientId: true,
        companyId: true,
        type: true,
        title: true,
        message: true,
        relatedType: true,
        relatedId: true,
      },
      orderBy: { createdAt: 'desc' },
      take: BATCH_SIZE,
    }),
  );

  result.considered = pending.length;
  if (pending.length === 0) return result;

  for (const notification of pending) {
    const decision = await withSystemScope(prisma, async (tx) => {
      const [preference, recentForResource, sentThisHour, devices] = await Promise.all([
        tx.notificationPreference.findUnique({
          where: {
            userId_eventType_channel: {
              userId: notification.recipientId,
              eventType: notification.type,
              channel: 'push',
            },
          },
          select: { enabled: true },
        }),
        tx.notification.count({
          where: {
            recipientId: notification.recipientId,
            relatedType: notification.relatedType,
            relatedId: notification.relatedId,
            pushSentAt: { gte: windowStart },
          },
        }),
        tx.notification.count({
          where: { recipientId: notification.recipientId, pushSentAt: { gte: hourStart } },
        }),
        tx.pushDevice.findMany({
          where: { userId: notification.recipientId, enabled: true, revokedAt: null },
          select: { id: true, endpoint: true, p256dhKey: true, authKey: true },
        }),
      ]);

      const allowed = preference?.enabled ?? pushDefaultFor(notification.type);

      // A membership revoked since the row was written must not be pushed about
      // (08-notifications-and-push.md#recipient-resolution-rules). Re-checked here
      // rather than trusted from creation time.
      const stillHasAccess =
        notification.companyId === null
          ? true
          : (await tx.companyMembership.count({
              where: {
                userId: notification.recipientId,
                companyId: notification.companyId,
                status: 'active',
              },
            })) > 0 ||
            (await tx.user.count({
              where: { id: notification.recipientId, role: 'agency_admin', status: 'active' },
            })) > 0;

      return {
        send:
          allowed &&
          stillHasAccess &&
          recentForResource === 0 &&
          sentThisHour < env.PUSH_MAX_PER_USER_PER_HOUR &&
          devices.length > 0,
        devices,
      };
    });

    if (!decision.send) {
      result.suppressed += 1;
      continue;
    }

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.message,
      url: deepLinkFor(notification.type, notification.relatedType, notification.relatedId),
      notificationId: notification.id,
    });

    let delivered = false;
    const revoked: string[] = [];

    for (const device of decision.devices) {
      try {
        await webpush.sendNotification(
          {
            endpoint: device.endpoint,
            keys: { p256dh: device.p256dhKey, auth: device.authKey },
          },
          payload,
        );
        delivered = true;
      } catch (error) {
        // 404/410 means the browser threw the subscription away; anything else is
        // transient and is not retried — the next event tries again normally.
        if (
          error instanceof WebPushError &&
          (error.statusCode === 404 || error.statusCode === 410)
        ) {
          revoked.push(device.id);
        } else {
          console.error('[worker] push delivery failed', error);
        }
      }
    }

    if (revoked.length > 0) {
      await withSystemScope(prisma, (tx) =>
        tx.pushDevice.updateMany({
          where: { id: { in: revoked } },
          data: { enabled: false, revokedAt: new Date() },
        }),
      );
      result.revokedDevices += revoked.length;
    }

    if (delivered) {
      await withSystemScope(prisma, (tx) =>
        tx.notification.update({
          where: { id: notification.id },
          data: { pushSentAt: new Date() },
        }),
      );
      result.sent += 1;
    } else {
      result.failed += 1;
    }
  }

  return result;
}
