import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../shared/validation.js';
import { conflict, forbidden, notFound, unprocessable } from '../../shared/errors.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import { clientIp } from '../../shared/request-context.js';
import { authorizedCompanyIds, requireCompanyAccess } from '../../shared/permissions.js';
import { tenantScoped, type ScopedDb } from '../../shared/tenant-scope.js';
import type { AuthenticatedActor } from '../../shared/actor.js';

const folderSelect = {
  id: true,
  companyId: true,
  projectId: true,
  parentFolderId: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
} as const;

const listQuerySchema = z.object({
  companyId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  /** Omitted lists every folder in scope; `root` lists only top-level ones. */
  parentFolderId: z.union([z.string().uuid(), z.literal('root')]).optional(),
});

const createSchema = z.object({
  companyId: z.string().uuid(),
  projectId: z.string().uuid().nullish(),
  parentFolderId: z.string().uuid().nullish(),
  name: z.string().trim().min(1).max(160),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  parentFolderId: z.string().uuid().nullish(),
  projectId: z.string().uuid().nullish(),
});

const idParamsSchema = z.object({ id: z.string().uuid() });

/** `client_manager` is the one role the matrix does not grant folder creation to. */
function requireFolderCreation(actor: AuthenticatedActor): void {
  if (actor.role === 'client_manager') {
    throw forbidden('forbidden', 'Você não tem permissão para criar pastas.');
  }
}

async function findFolderInScope(tx: ScopedDb, id: string, companyIds: string[] | null) {
  return tx.folder.findFirst({
    where: { id, ...(companyIds === null ? {} : { companyId: { in: companyIds } }) },
    select: folderSelect,
  });
}

/**
 * A folder moved under its own descendant would form a cycle that no listing query
 * could terminate on. Postgres will not catch it, so the walk happens here, inside
 * the same transaction as the write.
 */
async function assertNoCycle(tx: ScopedDb, folderId: string, newParentId: string): Promise<void> {
  let cursor: string | null = newParentId;

  for (let depth = 0; cursor !== null && depth < 64; depth += 1) {
    if (cursor === folderId) {
      throw unprocessable('folder_cycle', 'Uma pasta não pode ser movida para dentro dela mesma.');
    }
    const parent: { parentFolderId: string | null } | null = await tx.folder.findUnique({
      where: { id: cursor },
      select: { parentFolderId: true },
    });
    cursor = parent?.parentFolderId ?? null;
  }
}

async function assertPlacementIsInCompany(
  tx: ScopedDb,
  companyId: string,
  projectId: string | null | undefined,
  parentFolderId: string | null | undefined,
): Promise<void> {
  if (projectId) {
    const project = await tx.project.findFirst({
      where: { id: projectId, companyId },
      select: { id: true },
    });
    if (!project) {
      throw unprocessable('unknown_project', 'Projeto não encontrado nesta empresa.');
    }
  }

  if (parentFolderId) {
    const parent = await tx.folder.findFirst({
      where: { id: parentFolderId, companyId },
      select: { id: true },
    });
    if (!parent) {
      throw unprocessable(
        'unknown_parent_folder',
        'Pasta de destino não encontrada nesta empresa.',
      );
    }
  }
}

export async function folderRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/folders',
    tenantScoped(async ({ tx, actor, request }) => {
      const query = parseInput(listQuerySchema, request.query);
      const companyIds = authorizedCompanyIds(actor);

      if (query.companyId) {
        requireCompanyAccess(actor, query.companyId);
      }

      // Every member of a company sees every folder in it, whoever created it
      // (06-permissions-and-authorization.md) — there is deliberately no creator filter.
      const folders = await tx.folder.findMany({
        where: {
          ...(query.companyId
            ? { companyId: query.companyId }
            : companyIds === null
              ? {}
              : { companyId: { in: companyIds } }),
          ...(query.projectId ? { projectId: query.projectId } : {}),
          ...(query.parentFolderId === undefined
            ? {}
            : query.parentFolderId === 'root'
              ? { parentFolderId: null }
              : { parentFolderId: query.parentFolderId }),
        },
        select: { ...folderSelect, _count: { select: { children: true } } },
        orderBy: { name: 'asc' },
      });

      return { data: folders };
    }),
  );

  app.get(
    '/folders/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);
      const folder = await findFolderInScope(tx, params.id, authorizedCompanyIds(actor));

      if (!folder) {
        throw notFound('not_found', 'Pasta não encontrada.');
      }
      return { data: folder };
    }),
  );

  app.post(
    '/folders',
    tenantScoped(async ({ tx, actor, request, reply }) => {
      requireFolderCreation(actor);
      const body = parseInput(createSchema, request.body);
      requireCompanyAccess(actor, body.companyId);
      await assertPlacementIsInCompany(tx, body.companyId, body.projectId, body.parentFolderId);

      const folder = await tx.folder
        .create({
          data: {
            companyId: body.companyId,
            projectId: body.projectId ?? null,
            parentFolderId: body.parentFolderId ?? null,
            name: body.name,
            createdById: actor.userId,
          },
          select: folderSelect,
        })
        .catch((error: unknown) => {
          if ((error as { code?: string }).code === 'P2002') {
            throw conflict('folder_name_taken', 'Já existe uma pasta com este nome neste local.');
          }
          throw error;
        });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: folder.companyId,
        action: AuditAction.FolderCreated,
        entityType: 'folder',
        entityId: folder.id,
        ipAddress: clientIp(request),
      });

      reply.code(201);
      return { data: folder };
    }),
  );

  app.patch(
    '/folders/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      requireFolderCreation(actor);
      const params = parseInput(idParamsSchema, request.params);
      const body = parseInput(updateSchema, request.body);

      const existing = await findFolderInScope(tx, params.id, authorizedCompanyIds(actor));
      if (!existing) {
        throw notFound('not_found', 'Pasta não encontrada.');
      }

      await assertPlacementIsInCompany(
        tx,
        existing.companyId,
        body.projectId === undefined ? existing.projectId : body.projectId,
        body.parentFolderId === undefined ? existing.parentFolderId : body.parentFolderId,
      );

      if (body.parentFolderId) {
        await assertNoCycle(tx, existing.id, body.parentFolderId);
      }

      const folder = await tx.folder
        .update({ where: { id: params.id }, data: body, select: folderSelect })
        .catch((error: unknown) => {
          if ((error as { code?: string }).code === 'P2002') {
            throw conflict('folder_name_taken', 'Já existe uma pasta com este nome neste local.');
          }
          throw error;
        });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: folder.companyId,
        action: AuditAction.FolderUpdated,
        entityType: 'folder',
        entityId: folder.id,
        ipAddress: clientIp(request),
        metadata: { changed: Object.keys(body) },
      });

      return { data: folder };
    }),
  );

  app.delete(
    '/folders/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);
      const existing = await findFolderInScope(tx, params.id, authorizedCompanyIds(actor));

      if (!existing) {
        throw notFound('not_found', 'Pasta não encontrada.');
      }

      // A contributor may remove a folder they created; removing someone else's is an
      // agency job. Files inside follow the deletion-request workflow instead, so a
      // folder is only ever removed once it is empty.
      const isOwner = existing.createdById === actor.userId;
      const isAgency = actor.role === 'agency_admin' || actor.role === 'agency_manager';
      if (!isOwner && !isAgency) {
        throw forbidden('forbidden', 'Você só pode excluir pastas que você criou.');
      }

      // "Empty" means empty of what anyone can see or is still sending: subfolders, live
      // files, uploads in flight. Counting only subfolders let a folder full of files
      // reach the DELETE, where the foreign key refused it and the person got an
      // internal error.
      const [children, liveFiles, activeUploads] = await Promise.all([
        tx.folder.count({ where: { parentFolderId: existing.id } }),
        tx.file.count({ where: { folderId: existing.id, deletedAt: null } }),
        tx.uploadSession.count({
          where: { folderId: existing.id, status: { in: ['pending', 'in_progress'] } },
        }),
      ]);
      if (children > 0 || liveFiles > 0 || activeUploads > 0) {
        throw conflict('folder_not_empty', 'Esvazie a pasta antes de excluí-la.');
      }

      // What still points at the folder is history: files removed earlier, uploads that
      // finished or were abandoned. It keeps its record and stops naming a folder that is
      // going away - otherwise a folder that looks empty could never be deleted at all.
      const [detachedFiles] = await Promise.all([
        tx.file.updateMany({
          where: { folderId: existing.id, deletedAt: { not: null } },
          data: { folderId: null },
        }),
        tx.uploadSession.updateMany({ where: { folderId: existing.id }, data: { folderId: null } }),
      ]);

      await tx.folder.delete({ where: { id: params.id } });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: existing.companyId,
        action: AuditAction.FolderDeleted,
        entityType: 'folder',
        entityId: existing.id,
        ipAddress: clientIp(request),
        metadata: { name: existing.name, detachedDeletedFiles: detachedFiles.count },
      });

      return { data: { id: existing.id } };
    }),
  );
}
