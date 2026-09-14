import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { booleanQuery, parseInput } from '../../shared/validation.js';
import { forbidden, notFound, unprocessable } from '../../shared/errors.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import { clientIp } from '../../shared/request-context.js';
import {
  authorizedCompanyIds,
  canManageProduction,
  requireCompanyAccess,
} from '../../shared/permissions.js';
import { assertResponsibleHasAccess } from '../../shared/references.js';
import { paginated, paginationArgs, paginationSchema } from '../../shared/pagination.js';
import { tenantScoped, type ScopedDb } from '../../shared/tenant-scope.js';
import type { AuthenticatedActor } from '../../shared/actor.js';
import {
  NETWORKS,
  PENDING_STATUSES,
  publicationNetwork,
  publicationSelect,
  publicationStatus,
} from './publication.js';

const contentParamsSchema = z.object({ id: z.string().uuid() });

const networkParamsSchema = contentParamsSchema.extend({ network: publicationNetwork });

/**
 * One endpoint writes a network's record because there is only ever one of them: the
 * natural key is `(content_id, network)`, so "register" and "update" are the same
 * operation on the same row. Making it a PUT also means a double submit cannot create
 * a second record for the same network — the unique index would reject it, but the
 * client should not have to tell the two calls apart in the first place.
 */
const upsertSchema = z.object({
  status: publicationStatus,
  publishedAt: z.coerce.date().nullish(),
  link: z.string().trim().url().max(2048).nullish(),
  responsibleUserId: z.string().uuid().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

const listQuerySchema = paginationSchema.extend({
  companyId: z.string().uuid().optional(),
  network: publicationNetwork.optional(),
  status: z.union([publicationStatus, z.literal('all')]).default('all'),
  responsibleUserId: z.string().uuid().optional(),
  /** The dashboard's "pending publications" view (03-functional-requirements.md). */
  pending: booleanQuery.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** Logging publications is agency work (06-permissions-and-authorization.md). */
function requirePublicationManagement(actor: AuthenticatedActor): void {
  if (!canManageProduction(actor)) {
    throw forbidden('forbidden', 'Você não tem permissão para registrar publicações.');
  }
}

/**
 * Anti-IDOR: the authorized company scope is a required argument, so there is no way
 * to call this and forget it. Content outside the scope is reported as missing,
 * byte-for-byte like an id that never existed
 * (06-permissions-and-authorization.md#preventing-access-by-manipulating-ids-or-urls-anti-idor).
 */
async function findContentInScope(tx: ScopedDb, id: string, companyIds: string[] | null) {
  const content = await tx.content.findFirst({
    where: {
      id,
      deletedAt: null,
      ...(companyIds === null ? {} : { companyId: { in: companyIds } }),
    },
    select: { id: true, companyId: true, title: true },
  });

  if (!content) {
    throw notFound('not_found', 'Conteúdo não encontrado.');
  }
  return content;
}

export async function publicationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Every publication the actor can see, for the pending-publication views. Scoped
   * through the parent content, which is where `company_id` lives.
   */
  app.get(
    '/publications',
    tenantScoped(async ({ tx, actor, request }) => {
      const query = parseInput(listQuerySchema, request.query);
      if (query.companyId) requireCompanyAccess(actor, query.companyId);

      const companyIds = authorizedCompanyIds(actor);
      const contentScope: Prisma.ContentWhereInput = {
        deletedAt: null,
        ...(query.companyId
          ? { companyId: query.companyId }
          : companyIds === null
            ? {}
            : { companyId: { in: companyIds } }),
      };

      const where: Prisma.PublicationWhereInput = {
        content: contentScope,
        AND: [
          query.network ? { network: query.network } : {},
          query.status === 'all' ? {} : { status: query.status },
          query.pending ? { status: { in: PENDING_STATUSES } } : {},
          query.responsibleUserId ? { responsibleUserId: query.responsibleUserId } : {},
          query.from || query.to
            ? {
                publishedAt: {
                  ...(query.from ? { gte: query.from } : {}),
                  ...(query.to ? { lte: query.to } : {}),
                },
              }
            : {},
        ],
      };

      const [rows, total] = await Promise.all([
        tx.publication.findMany({
          where,
          select: {
            ...publicationSelect,
            content: { select: { id: true, companyId: true, title: true, scheduledAt: true } },
          },
          orderBy: [{ publishedAt: 'asc' }, { createdAt: 'asc' }],
          ...paginationArgs(query),
        }),
        tx.publication.count({ where }),
      ]);

      return paginated(rows, total, query);
    }),
  );

  app.get(
    '/content/:id/publications',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(contentParamsSchema, request.params);
      const content = await findContentInScope(tx, params.id, authorizedCompanyIds(actor));

      const rows = await tx.publication.findMany({
        where: { contentId: content.id },
        select: publicationSelect,
      });

      // Returned in a fixed network order so the chips never reshuffle between loads.
      const byNetwork = new Map(rows.map((row) => [row.network, row]));
      return {
        data: NETWORKS.map((network) => byNetwork.get(network)).filter(
          (row): row is NonNullable<typeof row> => row !== undefined,
        ),
      };
    }),
  );

  app.put(
    '/content/:id/publications/:network',
    tenantScoped(async ({ tx, actor, request, reply }) => {
      requirePublicationManagement(actor);
      const params = parseInput(networkParamsSchema, request.params);
      const body = parseInput(upsertSchema, request.body);

      const content = await findContentInScope(tx, params.id, authorizedCompanyIds(actor));
      if (body.responsibleUserId) {
        await assertResponsibleHasAccess(tx, content.companyId, body.responsibleUserId);
      }

      // A published post happened at a moment in time, and a record of one without a
      // date is a log nobody can audit later. Now is what the person marking it
      // published means, so the date only has to be typed when they disagree.
      const publishedAt =
        body.status === 'published' ? (body.publishedAt ?? new Date()) : (body.publishedAt ?? null);

      if (body.status === 'not_planned' && (body.link || publishedAt)) {
        throw unprocessable(
          'not_planned_with_details',
          'Uma rede marcada como "não planejada" não pode ter data nem link.',
        );
      }

      const existing = await tx.publication.findUnique({
        where: { contentId_network: { contentId: content.id, network: params.network } },
        select: { id: true, status: true },
      });

      const data = {
        status: body.status,
        publishedAt,
        link: body.link ?? null,
        responsibleUserId: body.responsibleUserId ?? null,
        notes: body.notes ?? null,
      };

      const publication = existing
        ? await tx.publication.update({
            where: { id: existing.id },
            data,
            select: publicationSelect,
          })
        : await tx.publication.create({
            data: { contentId: content.id, network: params.network, ...data },
            select: publicationSelect,
          });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: content.companyId,
        action: !existing
          ? AuditAction.PublicationRegistered
          : existing.status === publication.status
            ? AuditAction.PublicationUpdated
            : AuditAction.PublicationStatusChanged,
        entityType: 'publication',
        entityId: publication.id,
        ipAddress: clientIp(request),
        metadata: {
          contentId: content.id,
          network: publication.network,
          from: existing?.status ?? null,
          to: publication.status,
        },
      });

      reply.code(existing ? 200 : 201);
      return { data: publication };
    }),
  );

  /**
   * Removing the record means "we are not tracking this network here" — which is not
   * the same as `not_planned`, a deliberate decision not to post that we do want on
   * the record.
   */
  app.delete(
    '/content/:id/publications/:network',
    tenantScoped(async ({ tx, actor, request }) => {
      requirePublicationManagement(actor);
      const params = parseInput(networkParamsSchema, request.params);
      const content = await findContentInScope(tx, params.id, authorizedCompanyIds(actor));

      const existing = await tx.publication.findUnique({
        where: { contentId_network: { contentId: content.id, network: params.network } },
        select: { id: true, status: true },
      });
      if (!existing) {
        throw notFound('not_found', 'Publicação não encontrada.');
      }

      await tx.publication.delete({ where: { id: existing.id } });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: content.companyId,
        action: AuditAction.PublicationRemoved,
        entityType: 'publication',
        entityId: existing.id,
        ipAddress: clientIp(request),
        metadata: { contentId: content.id, network: params.network, status: existing.status },
      });

      return { data: { id: existing.id } };
    }),
  );
}
