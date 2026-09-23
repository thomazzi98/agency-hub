/**
 * The words a notification uses for a status. A notification body is stored as it will
 * be read (events.ts), so it cannot carry an enum value and rely on the client to
 * translate it the way a screen does - "agora está como in_review" is what that
 * produced. Worded exactly like the badges in apps/web/src/lib/strings.ts, so the
 * notification and the screen it links to say the same thing.
 */

const FILE_STATUS: Record<string, string> = {
  received: 'Recebido',
  in_review: 'Em análise',
  editing: 'Em edição',
  edit_complete: 'Edição concluída',
  approved: 'Aprovado',
  archived: 'Arquivado',
};

const PRODUCTION_STATUS: Record<string, string> = {
  planned: 'Planejado',
  awaiting_material: 'Aguardando material',
  in_production: 'Em produção',
  in_review: 'Em revisão',
  approved: 'Aprovado',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

const PUBLICATION_STATUS: Record<string, string> = {
  not_planned: 'Não planejada',
  planned: 'Planejada',
  scheduled: 'Agendada',
  published: 'Publicada',
  not_published: 'Não publicada',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};

const NETWORK: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube_shorts: 'YouTube Shorts',
};

const CAMPAIGN_STATUS: Record<string, string> = {
  active: 'Ativa',
  paused: 'Pausada',
  ended: 'Encerrada',
  with_problem: 'Com problema',
  awaiting_approval: 'Aguardando aprovação',
  needs_attention: 'Precisa de atenção',
};

/** Falls back to the raw value rather than to nothing, should an enum grow a member. */
const label = (table: Record<string, string>) => (value: string) => table[value] ?? value;

export const fileStatusLabel = label(FILE_STATUS);
export const productionStatusLabel = label(PRODUCTION_STATUS);
export const publicationStatusLabel = label(PUBLICATION_STATUS);
export const networkLabel = label(NETWORK);
export const campaignStatusLabel = label(CAMPAIGN_STATUS);
