import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../shared/validation.js';
import { forbidden, notFound, unprocessable } from '../../shared/errors.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import { notifyFileStatusChanged } from '../notifications/events.js';
import { clientIp } from '../../shared/request-context.js';
import {
  authorizedCompanyIds,
  canDeleteOthersFiles,
  requireCompanyAccess,
} from '../../shared/permissions.js';
import {
  paginated,
  paginationArgs,
  paginationSchema,
  sortSchema,
} from '../../shared/pagination.js';
import { multiScoped, tenantScoped, type ScopedDb } from '../../shared/tenant-scope.js';
import { getEnv } from '../../config/env.js';
import { presignDownload } from '../../shared/storage.js';
import type { AuthenticatedActor } from '../../shared/actor.js';
import { fileSelect, serializeFile } from './file.js';

const fileStatus = z.enum([
  'received',
  'in_review',
  'editing',
  'edit_complete',
  'approved',
  'archived',
]);

const listQuerySchema = paginationSchema
  .merge(sortSchema(['uploadedAt', 'originalName', 'sizeBytes'] as const, 'uploadedAt'))
  .extend({
    companyId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    folderId: z.union([z.string().uuid(), z.literal('root')]).optional(),
    status: z.union([fileStatus, z.literal('all')]).default('all'),
    uploadedById: z.string().uuid().optional(),
    search: z.string().trim().min(1).max(200).optional(),
  });

const updateSchema = z.object({
  status: fileStatus.optional(),
  folderId: z.string().uuid().nullish(),
  projectId: z.string().uuid().nullish(),
});

const idParamsSchema = z.object({ id: z.string().uuid() });

/**
 * Moving a file through the production pipeline is agency work
 * (06-permissions-and-authorization.md); a client or contributor uploads and views but
 * does not drive the status.
 */
function requireFileManagement(actor: AuthenticatedActor): void {
  if (actor.role !== 'agency_admin' && actor.role !== 'agency_manager') {
    throw forbidden('forbidden', 'Você não tem permissão para alterar arquivos.');
  }
}

async function findFileInScope(tx: ScopedDb, id: string, companyIds: string[] | null) {
  return tx.file.findFirst({
    where: {
      id,
      deletedAt: null,
      ...(companyIds === null ? {} : { companyId: { in: companyIds } }),
    },
    select: { ...fileSelect, storageKey: true },
  });
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/files',
    tenantScoped(async ({ tx, actor, request }) => {
      const query = parseInput(listQuerySchema, request.query);
      const companyIds = authorizedCompanyIds(actor);

      if (query.companyId) {
        requireCompanyAccess(actor, query.companyId);
      }

      // Every member of a company sees every file in it, whoever uploaded it
      // (06-permissions-and-authorization.md); `uploadedById` is a filter the user
      // chooses, never an implicit restriction.
      const where = {
        deletedAt: null,
        ...(query.companyId
          ? { companyId: query.companyId }
          : companyIds === null
            ? {}
            : { companyId: { in: companyIds } }),
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.folderId === undefined
          ? {}
          : query.folderId === 'root'
            ? { folderId: null }
            : { folderId: query.folderId }),
        ...(query.status === 'all' ? {} : { status: query.status }),
        ...(query.uploadedById ? { uploadedById: query.uploadedById } : {}),
        ...(query.search
          ? { originalName: { contains: query.search, mode: 'insensitive' as const } }
          : {}),
      };

      const [rows, total] = await Promise.all([
        tx.file.findMany({
          where,
          select: fileSelect,
          orderBy: [{ [query.sort]: query.order }, { id: 'asc' }],
          ...paginationArgs(query),
        }),
        tx.file.count({ where }),
      ]);

      return paginated(rows.map(serializeFile), total, query);
    }),
  );

  app.get(
    '/files/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);
      const file = await findFileInScope(tx, params.id, authorizedCompanyIds(actor));

      if (!file) {
        throw notFound('not_found', 'Arquivo não encontrado.');
      }
      // storageKey is deliberately not part of the response: a key is an internal
      // address, and every download goes through a freshly authorized signed URL.
      const visible = { ...file, storageKey: undefined };
      delete visible.storageKey;
      return { data: serializeFile(visible) };
    }),
  );

  app.patch(
    '/files/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      requireFileManagement(actor);
      const params = parseInput(idParamsSchema, request.params);
      const body = parseInput(updateSchema, request.body);

      const existing = await findFileInScope(tx, params.id, authorizedCompanyIds(actor));
      if (!existing) {
        throw notFound('not_found', 'Arquivo não encontrado.');
      }

      if (body.folderId) {
        const folder = await tx.folder.findFirst({
          where: { id: body.folderId, companyId: existing.companyId },
          select: { id: true },
        });
        if (!folder) throw unprocessable('unknown_folder', 'Pasta não encontrada nesta empresa.');
      }
      if (body.projectId) {
        const project = await tx.project.findFirst({
          where: { id: body.projectId, companyId: existing.companyId },
          select: { id: true },
        });
        if (!project)
          throw unprocessable('unknown_project', 'Projeto não encontrado nesta empresa.');
      }

      const file = await tx.file.update({
        where: { id: params.id },
        data: {
          ...body,
          ...(body.status === 'archived' ? { archivedAt: new Date() } : {}),
        },
        select: fileSelect,
      });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: file.companyId,
        action: AuditAction.FileStatusChanged,
        entityType: 'file',
        entityId: file.id,
        ipAddress: clientIp(request),
        metadata: { changed: Object.keys(body), status: body.status ?? null },
      });

      if (body.status) {
        await notifyFileStatusChanged(tx, {
          companyId: file.companyId,
          actorId: actor.userId,
          fileId: file.id,
          fileName: file.originalName,
          status: body.status,
        });
      }

      return { data: serializeFile(file) };
    }),
  );

  app.get(
    '/files/:id/download',
    multiScoped(async ({ runScoped, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);

      const file = await runScoped(async (tx) => {
        const found = await findFileInScope(tx, params.id, authorizedCompanyIds(actor));
        if (!found) throw notFound('not_found', 'Arquivo não encontrado.');

        await writeAuditLog(tx, {
          actorId: actor.userId,
          companyId: found.companyId,
          action: AuditAction.FileDownloaded,
          entityType: 'file',
          entityId: found.id,
          ipAddress: clientIp(request),
        });

        return found;
      });

      // Minted only after the authorization above, scoped to one object and one
      // method, and short-lived (16-security-requirements.md#temporarysigned-urls).
      const url = await presignDownload({
        storageKey: file.storageKey,
        downloadName: file.originalName,
        expiresInSeconds: getEnv().UPLOAD_DOWNLOAD_TTL_SECONDS,
      });

      return { data: { url, expiresInSeconds: getEnv().UPLOAD_DOWNLOAD_TTL_SECONDS } };
    }),
  );

  app.delete(
    '/files/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);
      const file = await findFileInScope(tx, params.id, authorizedCompanyIds(actor));

      if (!file) {
        throw notFound('not_found', 'Arquivo não encontrado.');
      }

      // Anyone may remove what they uploaded. Removing someone else's needs either the
      // admin role or the per-membership override; without it the answer is the
      // deletion-request workflow, not a refusal with no way forward.
      const isOwnUpload = file.uploadedById === actor.userId;
      if (!isOwnUpload && !canDeleteOthersFiles(actor, file.companyId)) {
        throw forbidden(
          'deletion_requires_approval',
          'Você não pode excluir arquivos de outras pessoas. Solicite a exclusão para um administrador aprovar.',
        );
      }

      // Soft delete: an approved-but-mistaken removal stays recoverable, and the record
      // that the file existed is never destroyed (16-security-requirements.md).
      await tx.file.update({ where: { id: params.id }, data: { deletedAt: new Date() } });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: file.companyId,
        action: AuditAction.FileDeleted,
        entityType: 'file',
        entityId: file.id,
        ipAddress: clientIp(request),
        metadata: { originalName: file.originalName, ownUpload: isOwnUpload },
      });

      return { data: { id: file.id } };
    }),
  );
}
