import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../shared/validation.js';
import { forbidden, notFound, unprocessable } from '../../shared/errors.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import { clientIp } from '../../shared/request-context.js';
import { authorizedCompanyIds, canDeleteOthersFiles } from '../../shared/permissions.js';
import { isAgencyAdmin, type AuthenticatedActor } from '../../shared/actor.js';
import { paginated, paginationArgs, paginationSchema } from '../../shared/pagination.js';
import { tenantScoped, type ScopedDb } from '../../shared/tenant-scope.js';

const commentableType = z.enum(['company', 'project', 'file', 'content', 'pending_request']);

const listQuerySchema = paginationSchema.extend({
  commentableType,
  commentableId: z.string().uuid(),
});

const createSchema = z.object({
  commentableType,
  commentableId: z.string().uuid(),
  body: z.string().trim().min(1).max(5000),
  attachmentFileId: z.string().uuid().nullish(),
});

const updateSchema = z.object({ body: z.string().trim().min(1).max(5000) });
const idParamsSchema = z.object({ id: z.string().uuid() });

const commentSelect = {
  id: true,
  companyId: true,
  commentableType: true,
  commentableId: true,
  authorId: true,
  body: true,
  attachmentFileId: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * A comment's company comes from the row it is attached to, resolved inside the
 * actor's own scope — never from the request. That is what stops a comment being
 * filed against another tenant's resource.
 */
async function resolveCommentable(
  tx: ScopedDb,
  type: z.infer<typeof commentableType>,
  id: string,
  companyIds: string[] | null,
): Promise<{ companyId: string }> {
  const scope = companyIds === null ? {} : { companyId: { in: companyIds } };

  switch (type) {
    case 'company': {
      const company = await tx.company.findFirst({
        where: { id, ...(companyIds === null ? {} : { id: { in: companyIds } }) },
        select: { id: true },
      });
      if (!company) throw notFound('not_found', 'Empresa não encontrada.');
      return { companyId: company.id };
    }
    case 'project': {
      const project = await tx.project.findFirst({
        where: { id, ...scope },
        select: { companyId: true },
      });
      if (!project) throw notFound('not_found', 'Projeto não encontrado.');
      return project;
    }
    case 'file': {
      const file = await tx.file.findFirst({
        where: { id, deletedAt: null, ...scope },
        select: { companyId: true },
      });
      if (!file) throw notFound('not_found', 'Arquivo não encontrado.');
      return file;
    }
    case 'content': {
      const content = await tx.content.findFirst({
        where: { id, deletedAt: null, ...scope },
        select: { companyId: true },
      });
      if (!content) throw notFound('not_found', 'Conteúdo não encontrado.');
      return content;
    }
    case 'pending_request': {
      const pendingRequest = await tx.pendingRequest.findFirst({
        where: { id, ...scope },
        select: { companyId: true },
      });
      if (!pendingRequest) throw notFound('not_found', 'Pendência não encontrada.');
      return pendingRequest;
    }
  }
}

/**
 * Editing or removing someone else's words is an agency act. The matrix marks the
 * manager case "🔶", and `can_delete_company_files` is the only override the data model
 * carries that speaks to authority over other people's content in a company
 * (23-open-questions.md #9).
 */
function canModerate(actor: AuthenticatedActor, companyId: string): boolean {
  return isAgencyAdmin(actor) || canDeleteOthersFiles(actor, companyId);
}

export async function commentRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/comments',
    tenantScoped(async ({ tx, actor, request }) => {
      const query = parseInput(listQuerySchema, request.query);
      await resolveCommentable(
        tx,
        query.commentableType,
        query.commentableId,
        authorizedCompanyIds(actor),
      );

      const where = {
        commentableType: query.commentableType,
        commentableId: query.commentableId,
        deletedAt: null,
      };

      const [rows, total] = await Promise.all([
        tx.comment.findMany({
          where,
          select: commentSelect,
          orderBy: { createdAt: 'asc' },
          ...paginationArgs(query),
        }),
        tx.comment.count({ where }),
      ]);

      return paginated(rows, total, query);
    }),
  );

  app.post(
    '/comments',
    tenantScoped(async ({ tx, actor, request, reply }) => {
      const body = parseInput(createSchema, request.body);
      const target = await resolveCommentable(
        tx,
        body.commentableType,
        body.commentableId,
        authorizedCompanyIds(actor),
      );

      if (body.attachmentFileId) {
        const attachment = await tx.file.findFirst({
          where: { id: body.attachmentFileId, companyId: target.companyId, deletedAt: null },
          select: { id: true },
        });
        if (!attachment) {
          throw unprocessable('unknown_file', 'Arquivo anexado não encontrado nesta empresa.');
        }
      }

      const comment = await tx.comment.create({
        data: {
          companyId: target.companyId,
          commentableType: body.commentableType,
          commentableId: body.commentableId,
          authorId: actor.userId,
          body: body.body,
          attachmentFileId: body.attachmentFileId ?? null,
        },
        select: commentSelect,
      });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: target.companyId,
        action: AuditAction.CommentCreated,
        entityType: 'comment',
        entityId: comment.id,
        ipAddress: clientIp(request),
        metadata: { commentableType: body.commentableType, commentableId: body.commentableId },
      });

      reply.code(201);
      return { data: comment };
    }),
  );

  app.patch(
    '/comments/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);
      const body = parseInput(updateSchema, request.body);
      const companyIds = authorizedCompanyIds(actor);

      const existing = await tx.comment.findFirst({
        where: {
          id: params.id,
          deletedAt: null,
          ...(companyIds === null ? {} : { companyId: { in: companyIds } }),
        },
        select: commentSelect,
      });
      if (!existing) {
        throw notFound('not_found', 'Comentário não encontrado.');
      }

      if (existing.authorId !== actor.userId && !canModerate(actor, existing.companyId)) {
        throw forbidden('forbidden', 'Você só pode editar os seus próprios comentários.');
      }

      const comment = await tx.comment.update({
        where: { id: params.id },
        data: { body: body.body },
        select: commentSelect,
      });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: comment.companyId,
        action: AuditAction.CommentUpdated,
        entityType: 'comment',
        entityId: comment.id,
        ipAddress: clientIp(request),
      });

      return { data: comment };
    }),
  );

  app.delete(
    '/comments/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);
      const companyIds = authorizedCompanyIds(actor);

      const existing = await tx.comment.findFirst({
        where: {
          id: params.id,
          deletedAt: null,
          ...(companyIds === null ? {} : { companyId: { in: companyIds } }),
        },
        select: commentSelect,
      });
      if (!existing) {
        throw notFound('not_found', 'Comentário não encontrado.');
      }

      if (existing.authorId !== actor.userId && !canModerate(actor, existing.companyId)) {
        throw forbidden('forbidden', 'Você só pode excluir os seus próprios comentários.');
      }

      // Soft delete, like every other removal here: the thread's history stays intact.
      await tx.comment.update({ where: { id: params.id }, data: { deletedAt: new Date() } });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: existing.companyId,
        action: AuditAction.CommentDeleted,
        entityType: 'comment',
        entityId: existing.id,
        ipAddress: clientIp(request),
      });

      return { data: { id: existing.id } };
    }),
  );
}
