import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseInput } from '../../shared/validation.js';
import { conflict, notFound, tooManyRequests, unprocessable } from '../../shared/errors.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import { clientIp } from '../../shared/request-context.js';
import { authorizedCompanyIds, requireCompanyAccess } from '../../shared/permissions.js';
import { multiScoped, type ScopedDb } from '../../shared/tenant-scope.js';
import { getEnv } from '../../config/env.js';
import {
  abortMultipartUpload,
  buildStorageKey,
  completeMultipartUpload,
  createMultipartUpload,
  headObject,
  listCommittedParts,
  presignUploadPart,
  type CommittedPart,
} from '../../shared/storage.js';
import { evaluateUploadPolicy, partCountFor } from './policy.js';
import { fileSelect, serializeFile } from '../files/file.js';

const createSchema = z.object({
  companyId: z.string().uuid(),
  projectId: z.string().uuid().nullish(),
  folderId: z.string().uuid().nullish(),
  originalName: z.string().trim().min(1).max(400),
  mimeType: z.string().trim().min(3).max(160),
  sizeBytes: z.coerce.number().int().nonnegative(),
});

const idParamsSchema = z.object({ id: z.string().uuid() });

const partsQuerySchema = z.object({
  partNumbers: z
    .string()
    .min(1)
    .transform((value) => value.split(',').map((entry) => Number.parseInt(entry.trim(), 10)))
    .refine((numbers) => numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= 10_000), {
      message: 'part numbers must be integers between 1 and 10000',
    }),
});

const registerPartParamsSchema = z.object({
  id: z.string().uuid(),
  partNumber: z.coerce.number().int().min(1).max(10_000),
});

const registerPartSchema = z.object({
  etag: z.string().trim().min(1).max(120),
  sizeBytes: z.coerce.number().int().nonnegative(),
});

type SessionRow = {
  id: string;
  companyId: string;
  projectId: string | null;
  folderId: string | null;
  storageKey: string;
  originalName: string;
  mimeType: string;
  declaredSizeBytes: bigint;
  partSizeBytes: number;
  providerUploadId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'aborted' | 'expired';
  fileId: string | null;
  expiresAt: Date;
};

const sessionSelect = {
  id: true,
  companyId: true,
  projectId: true,
  folderId: true,
  storageKey: true,
  originalName: true,
  mimeType: true,
  declaredSizeBytes: true,
  partSizeBytes: true,
  providerUploadId: true,
  status: true,
  fileId: true,
  expiresAt: true,
} as const;

function serializeSession(session: SessionRow, partCount: number) {
  return {
    id: session.id,
    companyId: session.companyId,
    projectId: session.projectId,
    folderId: session.folderId,
    originalName: session.originalName,
    mimeType: session.mimeType,
    // Well inside Number.MAX_SAFE_INTEGER (9 PB); JSON has no BigInt.
    sizeBytes: Number(session.declaredSizeBytes),
    partSizeBytes: session.partSizeBytes,
    partCount,
    status: session.status,
    expiresAt: session.expiresAt,
  };
}

/**
 * Loaded fresh on every control-plane call, inside the actor's scope. No endpoint here
 * trusts that a previous call already authorized this session
 * (07-upload-architecture.md#authorization).
 */
async function loadSessionInScope(
  tx: ScopedDb,
  id: string,
  companyIds: string[] | null,
): Promise<SessionRow | null> {
  return tx.uploadSession.findFirst({
    where: { id, ...(companyIds === null ? {} : { companyId: { in: companyIds } }) },
    select: sessionSelect,
  });
}

function assertResumable(session: SessionRow): void {
  if (session.status === 'completed') {
    throw conflict('upload_already_completed', 'Este envio já foi concluído.');
  }
  if (session.status === 'aborted' || session.status === 'expired') {
    throw conflict('upload_not_resumable', 'Este envio expirou ou foi cancelado. Comece de novo.');
  }
  if (session.expiresAt <= new Date()) {
    throw conflict('upload_not_resumable', 'Este envio expirou. Comece de novo.');
  }
}

async function assertPlacementIsInCompany(
  tx: ScopedDb,
  companyId: string,
  projectId: string | null | undefined,
  folderId: string | null | undefined,
): Promise<void> {
  if (projectId) {
    const project = await tx.project.findFirst({
      where: { id: projectId, companyId },
      select: { id: true },
    });
    if (!project) throw unprocessable('unknown_project', 'Projeto não encontrado nesta empresa.');
  }

  if (folderId) {
    const folder = await tx.folder.findFirst({
      where: { id: folderId, companyId },
      select: { id: true },
    });
    if (!folder) throw unprocessable('unknown_folder', 'Pasta não encontrada nesta empresa.');
  }
}

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/uploads',
    multiScoped(async ({ runScoped, actor, request, reply }) => {
      const body = parseInput(createSchema, request.body);
      requireCompanyAccess(actor, body.companyId);

      const policy = evaluateUploadPolicy({
        sizeBytes: body.sizeBytes,
        mimeType: body.mimeType,
      });

      const env = getEnv();
      // The file id is chosen before the upload starts because it is part of the
      // storage key, which the provider needs at CreateMultipartUpload time.
      const fileId = randomUUID();
      const storageKey = buildStorageKey({
        companyId: body.companyId,
        projectId: body.projectId ?? null,
        fileId,
        originalName: body.originalName,
      });

      await runScoped(async (tx) => {
        await assertPlacementIsInCompany(tx, body.companyId, body.projectId, body.folderId);

        // Bounds control-plane load per company, independent of the data plane, which
        // the storage provider absorbs directly.
        const active = await tx.uploadSession.count({
          where: {
            companyId: body.companyId,
            status: { in: ['pending', 'in_progress'] },
            expiresAt: { gt: new Date() },
          },
        });

        if (active >= env.UPLOAD_MAX_ACTIVE_SESSIONS_PER_COMPANY) {
          throw tooManyRequests(
            'too_many_active_uploads',
            'Há envios demais em andamento nesta empresa. Conclua ou cancele um deles.',
          );
        }
      });

      const providerUploadId = await createMultipartUpload({
        storageKey,
        mimeType: body.mimeType,
      });

      const session = await runScoped(async (tx) => {
        const created = await tx.uploadSession.create({
          data: {
            companyId: body.companyId,
            projectId: body.projectId ?? null,
            folderId: body.folderId ?? null,
            initiatedById: actor.userId,
            storageKey,
            originalName: body.originalName,
            mimeType: body.mimeType,
            declaredSizeBytes: BigInt(body.sizeBytes),
            maxAllowedSizeBytes: BigInt(policy.maxAllowedSizeBytes),
            partSizeBytes: policy.partSizeBytes,
            providerUploadId,
            expiresAt: new Date(Date.now() + env.UPLOAD_SESSION_TTL_HOURS * 60 * 60 * 1000),
          },
          select: sessionSelect,
        });

        await writeAuditLog(tx, {
          actorId: actor.userId,
          companyId: body.companyId,
          action: AuditAction.UploadStarted,
          entityType: 'upload_session',
          entityId: created.id,
          ipAddress: clientIp(request),
          metadata: { originalName: body.originalName, sizeBytes: body.sizeBytes },
        });

        return created;
      });

      reply.code(201);
      return { data: serializeSession(session, policy.partCount) };
    }),
  );

  app.get(
    '/uploads/:id/parts',
    multiScoped(async ({ runScoped, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);
      const query = parseInput(partsQuerySchema, request.query);
      const env = getEnv();

      const session = await runScoped(async (tx) => {
        const found = await loadSessionInScope(tx, params.id, authorizedCompanyIds(actor));
        if (!found) throw notFound('not_found', 'Envio não encontrado.');
        assertResumable(found);
        return found;
      });

      const partCount = partCountFor(Number(session.declaredSizeBytes), session.partSizeBytes);
      const requested = query.partNumbers.slice(0, env.UPLOAD_PRESIGN_BATCH_SIZE);

      if (requested.some((partNumber) => partNumber > partCount)) {
        throw unprocessable('invalid_part_number', 'Número de parte inválido para este envio.');
      }

      const urls = await Promise.all(
        requested.map(async (partNumber) => ({
          partNumber,
          url: await presignUploadPart({
            storageKey: session.storageKey,
            providerUploadId: session.providerUploadId,
            partNumber,
            expiresInSeconds: env.UPLOAD_PRESIGN_TTL_SECONDS,
          }),
        })),
      );

      return { data: { parts: urls, expiresInSeconds: env.UPLOAD_PRESIGN_TTL_SECONDS } };
    }),
  );

  app.post(
    '/uploads/:id/parts/:partNumber',
    multiScoped(async ({ runScoped, actor, request }) => {
      const params = parseInput(registerPartParamsSchema, request.params);
      const body = parseInput(registerPartSchema, request.body);

      return runScoped(async (tx) => {
        const session = await loadSessionInScope(tx, params.id, authorizedCompanyIds(actor));
        if (!session) throw notFound('not_found', 'Envio não encontrado.');
        assertResumable(session);

        // Upsert, not create: the browser may retry this call after a network drop that
        // happened *after* the provider already accepted the part.
        await tx.uploadPart.upsert({
          where: {
            uploadSessionId_partNumber: {
              uploadSessionId: session.id,
              partNumber: params.partNumber,
            },
          },
          create: {
            uploadSessionId: session.id,
            partNumber: params.partNumber,
            etag: body.etag,
            sizeBytes: BigInt(body.sizeBytes),
          },
          update: { etag: body.etag, sizeBytes: BigInt(body.sizeBytes) },
        });

        await tx.uploadSession.update({
          where: { id: session.id },
          data: { status: 'in_progress', lastActivityAt: new Date() },
        });

        return { data: { partNumber: params.partNumber } };
      });
    }),
  );

  app.get(
    '/uploads/:id',
    multiScoped(async ({ runScoped, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);

      const session = await runScoped(async (tx) => {
        const found = await loadSessionInScope(tx, params.id, authorizedCompanyIds(actor));
        if (!found) throw notFound('not_found', 'Envio não encontrado.');
        return found;
      });

      if (session.status === 'completed') {
        return {
          data: {
            ...serializeSession(
              session,
              partCountFor(Number(session.declaredSizeBytes), session.partSizeBytes),
            ),
            committedParts: [],
            fileId: session.fileId,
          },
        };
      }

      assertResumable(session);

      // Reconciled against the provider, not read from the local mirror: a part can
      // succeed at the provider while the browser's "register this part" call never
      // arrives, and answering from the mirror would re-upload data already stored.
      const committed = await listCommittedParts({
        storageKey: session.storageKey,
        providerUploadId: session.providerUploadId,
      });

      await runScoped(async (tx) => {
        for (const part of committed) {
          await tx.uploadPart.upsert({
            where: {
              uploadSessionId_partNumber: {
                uploadSessionId: session.id,
                partNumber: part.partNumber,
              },
            },
            create: {
              uploadSessionId: session.id,
              partNumber: part.partNumber,
              etag: part.etag,
              sizeBytes: BigInt(part.sizeBytes),
            },
            update: { etag: part.etag, sizeBytes: BigInt(part.sizeBytes) },
          });
        }
      });

      return {
        data: {
          ...serializeSession(
            session,
            partCountFor(Number(session.declaredSizeBytes), session.partSizeBytes),
          ),
          committedParts: committed.map((part) => ({
            partNumber: part.partNumber,
            etag: part.etag,
            sizeBytes: part.sizeBytes,
          })),
        },
      };
    }),
  );

  app.post(
    '/uploads/:id/complete',
    multiScoped(async ({ runScoped, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);

      const session = await runScoped(async (tx) => {
        const found = await loadSessionInScope(tx, params.id, authorizedCompanyIds(actor));
        if (!found) throw notFound('not_found', 'Envio não encontrado.');
        return found;
      });

      // Duplicate completion is idempotent: the same file comes back rather than a
      // second object or an error the client cannot act on.
      if (session.status === 'completed' && session.fileId) {
        const existing = await runScoped((tx) =>
          tx.file.findFirst({
            where: { id: session.fileId as string },
            select: fileSelect,
          }),
        );
        if (existing) return { data: serializeFile(existing) };
      }

      assertResumable(session);

      const committed: CommittedPart[] = await listCommittedParts({
        storageKey: session.storageKey,
        providerUploadId: session.providerUploadId,
      });

      if (committed.length === 0) {
        throw unprocessable('no_parts_uploaded', 'Nenhuma parte foi enviada.');
      }

      const expectedParts = partCountFor(Number(session.declaredSizeBytes), session.partSizeBytes);
      if (committed.length < expectedParts) {
        throw unprocessable(
          'upload_incomplete',
          'O envio ainda não está completo. Retome o envio antes de finalizar.',
        );
      }

      // The provider's part list is used verbatim: a client cannot claim a part is
      // committed when it is not.
      await completeMultipartUpload({
        storageKey: session.storageKey,
        providerUploadId: session.providerUploadId,
        parts: committed,
      });

      const stored = await headObject(session.storageKey);
      const sizeBytes = stored?.sizeBytes ?? Number(session.declaredSizeBytes);

      const file = await runScoped(async (tx) => {
        // Guarded so two concurrent completions cannot both create a File row.
        const claimed = await tx.uploadSession.updateMany({
          where: { id: session.id, status: { in: ['pending', 'in_progress'] } },
          data: { status: 'completed', completedAt: new Date(), lastActivityAt: new Date() },
        });

        if (claimed.count === 0) {
          const already = await tx.uploadSession.findFirst({
            where: { id: session.id },
            select: { fileId: true },
          });
          const existing = already?.fileId
            ? await tx.file.findFirst({ where: { id: already.fileId }, select: fileSelect })
            : null;
          if (existing) return existing;
          throw conflict('upload_already_completed', 'Este envio já foi concluído.');
        }

        const created = await tx.file.create({
          data: {
            companyId: session.companyId,
            projectId: session.projectId,
            folderId: session.folderId,
            originalName: session.originalName,
            mimeType: session.mimeType,
            sizeBytes: BigInt(sizeBytes),
            storageKey: session.storageKey,
            uploadedById: actor.userId,
          },
          select: fileSelect,
        });

        await tx.uploadSession.update({
          where: { id: session.id },
          data: { fileId: created.id },
        });

        await writeAuditLog(tx, {
          actorId: actor.userId,
          companyId: session.companyId,
          action: AuditAction.UploadCompleted,
          entityType: 'file',
          entityId: created.id,
          ipAddress: clientIp(request),
          metadata: { originalName: session.originalName, sizeBytes },
        });

        return created;
      });

      return { data: serializeFile(file) };
    }),
  );

  app.post(
    '/uploads/:id/abort',
    multiScoped(async ({ runScoped, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);

      const session = await runScoped(async (tx) => {
        const found = await loadSessionInScope(tx, params.id, authorizedCompanyIds(actor));
        if (!found) throw notFound('not_found', 'Envio não encontrado.');
        return found;
      });

      if (session.status === 'completed') {
        throw conflict('upload_already_completed', 'Este envio já foi concluído.');
      }

      if (session.status === 'pending' || session.status === 'in_progress') {
        // Releasing the provider-side parts is the point of this call: they are billed
        // until aborted (07-upload-architecture.md#abandoned-upload-cleanup).
        await abortMultipartUpload({
          storageKey: session.storageKey,
          providerUploadId: session.providerUploadId,
        });
      }

      await runScoped(async (tx) => {
        await tx.uploadSession.updateMany({
          where: { id: session.id, status: { in: ['pending', 'in_progress'] } },
          data: { status: 'aborted', lastActivityAt: new Date() },
        });
        await tx.uploadPart.deleteMany({ where: { uploadSessionId: session.id } });

        await writeAuditLog(tx, {
          actorId: actor.userId,
          companyId: session.companyId,
          action: AuditAction.UploadAborted,
          entityType: 'upload_session',
          entityId: session.id,
          ipAddress: clientIp(request),
        });
      });

      return { data: { id: session.id, status: 'aborted' as const } };
    }),
  );
}
