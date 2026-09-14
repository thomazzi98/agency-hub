/**
 * The Phase 1 event catalog (08-notifications-and-push.md#event-catalog-phase-1).
 *
 * "New comment" and "new note" are one entry here because they are one row in one
 * table: a note is a comment on a company or a project. A preference that offered to
 * silence one without the other would be describing a distinction the data does not
 * make.
 */
export const NotificationType = {
  FileUploaded: 'file.uploaded',
  FileStatusChanged: 'file.status_changed',
  FileResponseSent: 'file.response_sent',

  CommentCreated: 'comment.created',
  UserMentioned: 'user.mentioned',

  PendingRequestCreated: 'pending_request.created',
  PendingRequestAnswered: 'pending_request.answered',

  ContentStatusChanged: 'content.status_changed',
  ContentApprovalRequested: 'content.approval_requested',
  ContentOverdue: 'content.overdue',

  PublicationStatusChanged: 'publication.status_changed',

  ProjectChanged: 'project.changed',

  TopicCreated: 'topic.created',
  TopicReplied: 'topic.replied',

  DeletionRequested: 'deletion_request.created',
  DeletionApproved: 'deletion_request.approved',
  DeletionRejected: 'deletion_request.rejected',

  /** Stage 13 emits these; they are listed here so the catalog is complete. */
  CampaignStatusChanged: 'campaign.status_changed',
  CampaignNeedsAttention: 'campaign.needs_attention',
} as const;

export type NotificationTypeValue = (typeof NotificationType)[keyof typeof NotificationType];

export const NOTIFICATION_TYPES: NotificationTypeValue[] = Object.values(NotificationType);

/**
 * Whether push is on unless the user says otherwise. In-app is always on — it is the
 * system of record — so only the push column has a default worth choosing.
 *
 * On by default: something is waiting for *you* specifically. Off by default: things
 * that are useful to see in the centre but do not justify a phone buzzing
 * (08-notifications-and-push.md#preferences).
 */
const PUSH_ON_BY_DEFAULT = new Set<string>([
  NotificationType.UserMentioned,
  NotificationType.PendingRequestCreated,
  NotificationType.PendingRequestAnswered,
  NotificationType.FileResponseSent,
  NotificationType.TopicCreated,
  NotificationType.TopicReplied,
  NotificationType.ContentApprovalRequested,
  NotificationType.ContentOverdue,
  NotificationType.DeletionRequested,
  NotificationType.DeletionApproved,
  NotificationType.DeletionRejected,
  NotificationType.CampaignNeedsAttention,
]);

export function pushDefaultFor(type: string): boolean {
  return PUSH_ON_BY_DEFAULT.has(type);
}

/**
 * Where opening a notification goes (08-notifications-and-push.md#deep-link-mapping).
 * Built on the server so every channel — the centre, a push payload, a future email —
 * agrees on the destination.
 */
export function deepLinkFor(
  type: string,
  relatedType: string | null,
  relatedId: string | null,
): string {
  switch (relatedType) {
    case 'pending_request':
      return relatedId ? `/pendencias/${relatedId}` : '/pendencias';
    case 'topic':
      return relatedId ? `/topicos/${relatedId}` : '/topicos';
    case 'content':
      return '/calendario';
    case 'publication':
      return '/publicacoes';
    case 'file':
      return '/arquivos';
    case 'project':
      return '/projetos';
    case 'deletion_request':
      return '/exclusoes';
    case 'campaign':
      return '/campanhas';
    case 'company':
      return relatedId ? `/empresas/${relatedId}` : '/empresas';
    default:
      return type.startsWith('pending_request') ? '/pendencias' : '/';
  }
}
