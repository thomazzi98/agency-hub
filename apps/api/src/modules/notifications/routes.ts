import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { getEnv } from '../../config/env.js';
import { parseInput, booleanQuery } from '../../shared/validation.js';
import { notFound } from '../../shared/errors.js';
import { paginated, paginationArgs, paginationSchema } from '../../shared/pagination.js';
import { tenantScoped } from '../../shared/tenant-scope.js';
import { NOTIFICATION_TYPES, deepLinkFor, pushDefaultFor } from './catalog.js';

const notificationSelect = {
  id: true,
  companyId: true,
  type: true,
  title: true,
  message: true,
  actorId: true,
  relatedType: true,
  relatedId: true,
  readAt: true,
  createdAt: true,
} as const;

const listQuerySchema = paginationSchema.extend({
  unreadOnly: booleanQuery.optional(),
  companyId: z.string().uuid().optional(),
});

const idParamsSchema = z.object({ id: z.string().uuid() });

const preferenceSchema = z.object({
  eventType: z.enum(NOTIFICATION_TYPES as [string, ...string[]]),
  /** In-app is the system of record and is always on, so only push is settable. */
  channel: z.literal('push'),
  enabled: z.boolean(),
});

const deviceSchema = z.object({
  endpoint: z.string().url().max(2000),
  p256dhKey: z.string().min(1).max(400),
  authKey: z.string().min(1).max(400),
  userAgent: z.string().max(400).nullish(),
});

function withLink<T extends { type: string; relatedType: string | null; relatedId: string | null }>(
  row: T,
) {
  return { ...row, link: deepLinkFor(row.type, row.relatedType, row.relatedId) };
}

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * The centre. Scoped to the actor in application code *and* by the read policy on
   * the table, which is per-recipient rather than per-company — a notification is the
   * one row in this system addressed to a person rather than shared with their team.
   */
  app.get(
    '/notifications',
    tenantScoped(async ({ tx, actor, request }) => {
      const query = parseInput(listQuerySchema, request.query);

      const where: Prisma.NotificationWhereInput = {
        recipientId: actor.userId,
        ...(query.unreadOnly ? { readAt: null } : {}),
        ...(query.companyId ? { companyId: query.companyId } : {}),
      };

      const [rows, total, unread] = await Promise.all([
        tx.notification.findMany({
          where,
          select: notificationSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          ...paginationArgs(query),
        }),
        tx.notification.count({ where }),
        tx.notification.count({ where: { recipientId: actor.userId, readAt: null } }),
      ]);

      return { ...paginated(rows.map(withLink), total, query), unread };
    }),
  );

  /** Polled by the badge, so it stays as small as a response can be. */
  app.get(
    '/notifications/unread-count',
    tenantScoped(async ({ tx, actor }) => {
      const unread = await tx.notification.count({
        where: { recipientId: actor.userId, readAt: null },
      });
      return { data: { unread } };
    }),
  );

  /**
   * Opening a notification marks it read in the same action
   * (08-notifications-and-push.md#readunread-behavior), so the client does not have to
   * remember to, and the link comes back with it rather than being re-derived there.
   */
  app.post(
    '/notifications/:id/read',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);

      // Constrained by recipient as well as by id: the id alone must never be enough.
      const updated = await tx.notification.updateMany({
        where: { id: params.id, recipientId: actor.userId, readAt: null },
        data: { readAt: new Date() },
      });

      const notification = await tx.notification.findFirst({
        where: { id: params.id, recipientId: actor.userId },
        select: notificationSelect,
      });
      if (!notification) {
        throw notFound('not_found', 'Notificação não encontrada.');
      }

      return { data: { ...withLink(notification), alreadyRead: updated.count === 0 } };
    }),
  );

  app.post(
    '/notifications/read-all',
    tenantScoped(async ({ tx, actor }) => {
      const result = await tx.notification.updateMany({
        where: { recipientId: actor.userId, readAt: null },
        data: { readAt: new Date() },
      });
      return { data: { markedRead: result.count } };
    }),
  );

  /**
   * The full matrix, with the defaults filled in for event types the user has never
   * touched — so the client renders one list rather than guessing what a missing row
   * means.
   */
  app.get(
    '/notifications/preferences',
    tenantScoped(async ({ tx, actor }) => {
      const stored = await tx.notificationPreference.findMany({
        where: { userId: actor.userId, channel: 'push' },
        select: { eventType: true, enabled: true },
      });
      const byType = new Map(stored.map((row) => [row.eventType, row.enabled]));

      return {
        data: NOTIFICATION_TYPES.map((eventType) => ({
          eventType,
          channel: 'push' as const,
          enabled: byType.get(eventType) ?? pushDefaultFor(eventType),
          isDefault: !byType.has(eventType),
        })),
      };
    }),
  );

  app.put(
    '/notifications/preferences',
    tenantScoped(async ({ tx, actor, request }) => {
      const body = parseInput(preferenceSchema, request.body);

      await tx.notificationPreference.upsert({
        where: {
          userId_eventType_channel: {
            userId: actor.userId,
            eventType: body.eventType,
            channel: body.channel,
          },
        },
        create: {
          userId: actor.userId,
          eventType: body.eventType,
          channel: body.channel,
          enabled: body.enabled,
        },
        update: { enabled: body.enabled },
      });

      return { data: { eventType: body.eventType, channel: body.channel, enabled: body.enabled } };
    }),
  );

  /**
   * The browser needs the public key to subscribe. It is public by definition — the
   * private half never leaves the server — and an empty value is the signal that this
   * deployment has no push at all, which the client uses to hide the control rather
   * than show one that cannot work.
   */
  app.get('/push/config', async () => {
    const env = getEnv();
    return {
      data: {
        enabled: env.pushEnabled,
        publicKey: env.pushEnabled ? env.VAPID_PUBLIC_KEY : null,
      },
    };
  });

  app.get(
    '/push/devices',
    tenantScoped(async ({ tx, actor }) => {
      const devices = await tx.pushDevice.findMany({
        where: { userId: actor.userId, revokedAt: null },
        select: {
          id: true,
          endpoint: true,
          userAgent: true,
          enabled: true,
          createdAt: true,
          lastSeenAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      // The endpoint is a capability URL for pushing to this browser; the client only
      // ever needs to tell devices apart, so it never leaves the server.
      return {
        data: devices.map(({ endpoint, ...device }) => ({
          ...device,
          fingerprint: endpoint.slice(-12),
        })),
      };
    }),
  );

  app.post(
    '/push/devices',
    tenantScoped(async ({ tx, actor, request, reply }) => {
      const body = parseInput(deviceSchema, request.body);

      // Keyed by endpoint: re-subscribing the same browser updates its registration
      // instead of leaving a trail of dead ones behind.
      const existing = await tx.pushDevice.findFirst({
        where: { endpoint: body.endpoint, userId: actor.userId },
        select: { id: true },
      });

      const data = {
        p256dhKey: body.p256dhKey,
        authKey: body.authKey,
        userAgent: body.userAgent ?? null,
        enabled: true,
        revokedAt: null,
        lastSeenAt: new Date(),
      };

      if (existing) {
        await tx.pushDevice.update({ where: { id: existing.id }, data });
        return { data: { id: existing.id } };
      }

      const device = await tx.pushDevice.create({
        data: { userId: actor.userId, endpoint: body.endpoint, ...data },
        select: { id: true },
      });

      reply.code(201);
      return { data: { id: device.id } };
    }),
  );

  app.delete(
    '/push/devices/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);

      const result = await tx.pushDevice.updateMany({
        where: { id: params.id, userId: actor.userId, revokedAt: null },
        data: { enabled: false, revokedAt: new Date() },
      });
      if (result.count === 0) {
        throw notFound('not_found', 'Dispositivo não encontrado.');
      }

      return { data: { id: params.id } };
    }),
  );
}
