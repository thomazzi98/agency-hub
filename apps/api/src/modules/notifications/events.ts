import type { ScopedDb } from '../../shared/tenant-scope.js';
import { campaignAudienceRoles } from '../campaigns/campaign.js';
import { NotificationType } from './catalog.js';
import {
  campaignStatusLabel,
  fileStatusLabel,
  networkLabel,
  productionStatusLabel,
  publicationStatusLabel,
} from './labels.js';
import { agencyAdmins, companyAudience, notify, usersWithCompanyAccess } from './service.js';

/**
 * The message a recipient reads, written once per event so the wording does not drift
 * between the notification centre, a push payload and (in Phase 2) an email.
 *
 * These are pt-BR because they are user-facing copy (15-api-conventions.md): unlike an
 * error `code`, a notification body is never mapped client-side — it is stored as it
 * will be read.
 */
function truncate(value: string, max = 80): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export async function notifyFileUploaded(
  tx: ScopedDb,
  input: { companyId: string; actorId: string; fileId: string; fileName: string },
): Promise<void> {
  await notify(tx, await companyAudience(tx, input.companyId, { exclude: input.actorId }), {
    companyId: input.companyId,
    type: NotificationType.FileUploaded,
    title: 'Novo arquivo enviado',
    message: `"${truncate(input.fileName)}" foi enviado.`,
    actorId: input.actorId,
    relatedType: 'file',
    relatedId: input.fileId,
  });
}

export async function notifyFileStatusChanged(
  tx: ScopedDb,
  input: {
    companyId: string;
    actorId: string;
    fileId: string;
    fileName: string;
    status: string;
  },
): Promise<void> {
  await notify(tx, await companyAudience(tx, input.companyId, { exclude: input.actorId }), {
    companyId: input.companyId,
    type: NotificationType.FileStatusChanged,
    title: 'Situação de arquivo alterada',
    message: `"${truncate(input.fileName)}" agora está como ${fileStatusLabel(input.status)}.`,
    actorId: input.actorId,
    relatedType: 'file',
    relatedId: input.fileId,
  });
}

export async function notifyCommentCreated(
  tx: ScopedDb,
  input: {
    companyId: string;
    actorId: string;
    commentableType: string;
    commentableId: string;
    body: string;
    mentionedUserIds?: readonly string[];
  },
): Promise<void> {
  const mentioned = await usersWithCompanyAccess(tx, input.companyId, input.mentionedUserIds ?? []);
  const mentionedSet = new Set(mentioned);

  // A mention is the stronger signal, so the same person never gets both.
  const audience = (await companyAudience(tx, input.companyId, { exclude: input.actorId })).filter(
    (id) => !mentionedSet.has(id),
  );

  await notify(tx, audience, {
    companyId: input.companyId,
    type: NotificationType.CommentCreated,
    title: 'Novo comentário',
    message: truncate(input.body, 140),
    actorId: input.actorId,
    relatedType: input.commentableType,
    relatedId: input.commentableId,
  });

  await notify(tx, mentioned, {
    companyId: input.companyId,
    type: NotificationType.UserMentioned,
    title: 'Você foi mencionado',
    message: truncate(input.body, 140),
    actorId: input.actorId,
    relatedType: input.commentableType,
    relatedId: input.commentableId,
  });
}

export async function notifyPendingRequestCreated(
  tx: ScopedDb,
  input: {
    companyId: string;
    actorId: string;
    requestId: string;
    title: string;
    responsibleUserId: string;
  },
): Promise<void> {
  await notify(tx, [input.responsibleUserId], {
    companyId: input.companyId,
    type: NotificationType.PendingRequestCreated,
    title: 'Nova pendência para você',
    message: truncate(input.title, 140),
    actorId: input.actorId,
    relatedType: 'pending_request',
    relatedId: input.requestId,
  });
}

export async function notifyPendingRequestAnswered(
  tx: ScopedDb,
  input: {
    companyId: string;
    actorId: string;
    requestId: string;
    title: string;
    createdById: string | null;
    withAttachment: boolean;
  },
): Promise<void> {
  const recipients = input.createdById
    ? [input.createdById]
    : await companyAudience(tx, input.companyId, { exclude: input.actorId });

  await notify(tx, recipients, {
    companyId: input.companyId,
    type: NotificationType.PendingRequestAnswered,
    title: 'Pendência respondida',
    message: truncate(input.title, 140),
    actorId: input.actorId,
    relatedType: 'pending_request',
    relatedId: input.requestId,
  });

  // The catalog lists "file sent (as a response)" on its own because it is the event
  // someone is actually waiting for when they asked for material.
  if (input.withAttachment) {
    await notify(tx, recipients, {
      companyId: input.companyId,
      type: NotificationType.FileResponseSent,
      title: 'Arquivo recebido em resposta',
      message: truncate(input.title, 140),
      actorId: input.actorId,
      relatedType: 'pending_request',
      relatedId: input.requestId,
    });
  }
}

export async function notifyContentStatusChanged(
  tx: ScopedDb,
  input: {
    companyId: string;
    actorId: string;
    contentId: string;
    title: string;
    status: string;
    responsibleUserId: string | null;
  },
): Promise<void> {
  const audience = await companyAudience(tx, input.companyId, { exclude: input.actorId });

  // "Em revisão" is the spec's "approval requested": someone has to look at it now.
  if (input.status === 'in_review') {
    await notify(tx, audience, {
      companyId: input.companyId,
      type: NotificationType.ContentApprovalRequested,
      title: 'Aprovação solicitada',
      message: `"${truncate(input.title)}" está aguardando aprovação.`,
      actorId: input.actorId,
      relatedType: 'content',
      relatedId: input.contentId,
    });
    return;
  }

  await notify(tx, audience, {
    companyId: input.companyId,
    type: NotificationType.ContentStatusChanged,
    title: 'Conteúdo atualizado',
    message: `"${truncate(input.title)}" agora está como ${productionStatusLabel(input.status)}.`,
    actorId: input.actorId,
    relatedType: 'content',
    relatedId: input.contentId,
  });
}

export async function notifyPublicationStatusChanged(
  tx: ScopedDb,
  input: {
    companyId: string;
    actorId: string;
    contentId: string;
    contentTitle: string;
    network: string;
    status: string;
  },
): Promise<void> {
  await notify(tx, await companyAudience(tx, input.companyId, { exclude: input.actorId }), {
    companyId: input.companyId,
    type: NotificationType.PublicationStatusChanged,
    title: 'Publicação atualizada',
    message: `"${truncate(input.contentTitle)}" — ${networkLabel(input.network)}: ${publicationStatusLabel(input.status)}.`,
    actorId: input.actorId,
    relatedType: 'publication',
    relatedId: input.contentId,
  });
}

export async function notifyProjectChanged(
  tx: ScopedDb,
  input: { companyId: string; actorId: string; projectId: string; name: string },
): Promise<void> {
  await notify(tx, await companyAudience(tx, input.companyId, { exclude: input.actorId }), {
    companyId: input.companyId,
    type: NotificationType.ProjectChanged,
    title: 'Projeto atualizado',
    message: `"${truncate(input.name)}" foi alterado.`,
    actorId: input.actorId,
    relatedType: 'project',
    relatedId: input.projectId,
  });
}

export async function notifyTopicCreated(
  tx: ScopedDb,
  input: {
    companyId: string;
    actorId: string;
    topicId: string;
    title: string;
    responsibleUserId: string;
  },
): Promise<void> {
  await notify(tx, [input.responsibleUserId], {
    companyId: input.companyId,
    type: NotificationType.TopicCreated,
    title: 'Novo acompanhamento para você',
    message: truncate(input.title, 140),
    actorId: input.actorId,
    relatedType: 'topic',
    relatedId: input.topicId,
  });
}

export async function notifyTopicReplied(
  tx: ScopedDb,
  input: {
    companyId: string;
    actorId: string;
    topicId: string;
    title: string;
    creatorId: string | null;
    responsibleUserId: string;
  },
): Promise<void> {
  // Both sides of the thread, minus whoever just wrote — `notify` drops the actor.
  const recipients = [input.responsibleUserId, ...(input.creatorId ? [input.creatorId] : [])];

  await notify(tx, recipients, {
    companyId: input.companyId,
    type: NotificationType.TopicReplied,
    title: 'Nova resposta no acompanhamento',
    message: truncate(input.title, 140),
    actorId: input.actorId,
    relatedType: 'topic',
    relatedId: input.topicId,
  });
}

export async function notifyDeletionRequested(
  tx: ScopedDb,
  input: { companyId: string; actorId: string; requestId: string; targetType: string },
): Promise<void> {
  // Agency-wide relevance: approving is an admin-only act, so this is one of the few
  // events that goes to admins rather than to the company's people.
  await notify(tx, await agencyAdmins(tx, input.actorId), {
    companyId: input.companyId,
    type: NotificationType.DeletionRequested,
    title: 'Solicitação de exclusão',
    message:
      input.targetType === 'content'
        ? 'Um conteúdo foi indicado para exclusão e aguarda análise.'
        : 'Um arquivo foi indicado para exclusão e aguarda análise.',
    actorId: input.actorId,
    relatedType: 'deletion_request',
    relatedId: input.requestId,
  });
}

export async function notifyDeletionReviewed(
  tx: ScopedDb,
  input: {
    companyId: string;
    actorId: string;
    requestId: string;
    /** Null once the requester's account has been removed; nobody to tell, then. */
    requestedById: string | null;
    approved: boolean;
  },
): Promise<void> {
  await notify(tx, input.requestedById ? [input.requestedById] : [], {
    companyId: input.companyId,
    type: input.approved ? NotificationType.DeletionApproved : NotificationType.DeletionRejected,
    title: input.approved ? 'Exclusão aprovada' : 'Exclusão recusada',
    message: input.approved
      ? 'A exclusão que você solicitou foi aprovada.'
      : 'A exclusão que você solicitou foi recusada.',
    actorId: input.actorId,
    relatedType: 'deletion_request',
    relatedId: input.requestId,
  });
}

interface CampaignEvent {
  companyId: string;
  actorId: string;
  campaignId: string;
  name: string;
  status: string;
  /** Whether the client may see the campaign at all - and so be told about it. */
  visibleToClient: boolean;
}

/**
 * Only people who could open the campaign hear about it. A notification carries the
 * campaign's name and status, so sending it to the whole company would hand a hidden
 * campaign to the very client it was hidden from, and any campaign to a contributor
 * (09-campaign-management.md#permissions).
 */
async function campaignAudience(tx: ScopedDb, input: CampaignEvent): Promise<string[]> {
  return companyAudience(tx, input.companyId, {
    exclude: input.actorId,
    roles: campaignAudienceRoles(input.visibleToClient),
  });
}

export async function notifyCampaignStatusChanged(
  tx: ScopedDb,
  input: CampaignEvent,
): Promise<void> {
  await notify(tx, await campaignAudience(tx, input), {
    companyId: input.companyId,
    type: NotificationType.CampaignStatusChanged,
    title: 'Campanha atualizada',
    message: `"${truncate(input.name)}" agora está como ${campaignStatusLabel(input.status)}.`,
    actorId: input.actorId,
    relatedType: 'campaign',
    relatedId: input.campaignId,
  });
}

/**
 * Deliberately its own event: "precisa de atenção" is the one campaign signal somebody
 * has to act on, and it defaults to a push while a routine status change does not
 * (08-notifications-and-push.md#preferences).
 */
export async function notifyCampaignNeedsAttention(
  tx: ScopedDb,
  input: CampaignEvent,
): Promise<void> {
  await notify(tx, await campaignAudience(tx, input), {
    companyId: input.companyId,
    type: NotificationType.CampaignNeedsAttention,
    title: 'Campanha precisa de atenção',
    message: `"${truncate(input.name)}" está como ${campaignStatusLabel(input.status)}.`,
    actorId: input.actorId,
    relatedType: 'campaign',
    relatedId: input.campaignId,
  });
}
