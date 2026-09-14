import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AdPlatform, Campaign, Prisma } from '@prisma/client';
import { parseInput } from '../../shared/validation.js';
import { forbidden, notFound, unprocessable } from '../../shared/errors.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import { clientIp } from '../../shared/request-context.js';
import {
  authorizedCompanyIds,
  canManageCampaigns,
  requireCompanyAccess,
} from '../../shared/permissions.js';
import { assertResponsibleHasAccess } from '../../shared/references.js';
import { paginated, paginationArgs, paginationSchema } from '../../shared/pagination.js';
import { tenantScoped, type ScopedDb } from '../../shared/tenant-scope.js';
import type { AuthenticatedActor } from '../../shared/actor.js';
import {
  notifyCampaignNeedsAttention,
  notifyCampaignStatusChanged,
} from '../notifications/events.js';
import { CAMPAIGN_ATTENTION_STATUSES, TRACKED_FIELDS, campaignSelect } from './campaign.js';

const platform = z.enum(['meta', 'tiktok']);
const adAccountStatus = z.enum(['active', 'paused', 'closed']);
const campaignStatus = z.enum([
  'active',
  'paused',
  'ended',
  'with_problem',
  'awaiting_approval',
  'needs_attention',
]);

/** A money figure somebody typed. Never negative, never more precise than cents. */
const money = z
  .number()
  .nonnegative()
  .max(99_999_999_999.99)
  .refine((value) => Number.isFinite(value), 'invalid');

const idParamsSchema = z.object({ id: z.string().uuid() });

const adAccountSelect = {
  id: true,
  companyId: true,
  platform: true,
  name: true,
  externalAccountId: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
} as const;

const adAccountCreateSchema = z.object({
  companyId: z.string().uuid(),
  platform,
  name: z.string().trim().min(2).max(160),
  /** Text, deliberately: there is no API call to validate it against. */
  externalAccountId: z.string().trim().max(120).nullish(),
  status: adAccountStatus.default('active'),
  notes: z.string().trim().max(5000).nullish(),
});

const adAccountUpdateSchema = adAccountCreateSchema.omit({ companyId: true }).partial();

const campaignCreateSchema = z.object({
  companyId: z.string().uuid(),
  adAccountId: z.string().uuid(),
  name: z.string().trim().min(2).max(200),
  objective: z.string().trim().max(160).nullish(),
  status: campaignStatus.default('active'),
  dailyBudget: money.nullish(),
  totalBudget: money.nullish(),
  reportedSpend: money.nullish(),
  reportedBalance: money.nullish(),
  lastCheckedAt: z.coerce.date().nullish(),
  visibleToClient: z.boolean().default(true),
  responsibleUserId: z.string().uuid().nullish(),
  notes: z.string().trim().max(5000).nullish(),
});

const campaignUpdateSchema = campaignCreateSchema
  .omit({ companyId: true })
  .partial()
  .extend({
    /** Why, in the person's own words — it lands on every row this edit writes. */
    changeNote: z.string().trim().max(500).nullish(),
  });

const listQuerySchema = paginationSchema.extend({
  companyId: z.string().uuid().optional(),
  adAccountId: z.string().uuid().optional(),
  platform: platform.optional(),
  status: z.union([campaignStatus, z.literal('all')]).default('all'),
  responsibleUserId: z.string().uuid().optional(),
  needsAttention: z.coerce.boolean().optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

/**
 * Editing is `agency_admin` always, and `agency_manager` only where their
 * `can_manage_campaigns` override is true for *that* company
 * (09-campaign-management.md#permissions). This is the first place that override
 * actually decides anything, and it is per-membership: the same manager may have it
 * for one client and not another.
 */
function requireCampaignManagement(actor: AuthenticatedActor, companyId: string): void {
  if (!canManageCampaigns(actor, companyId)) {
    throw forbidden(
      'campaign_management_not_granted',
      'Você não tem permissão para gerenciar campanhas desta empresa.',
    );
  }
}

/**
 * A `client_manager` or `contributor` only ever sees campaigns the agency marked
 * visible. Applied as a `where` clause rather than filtered afterwards, so a hidden
 * campaign is never sent to the browser at all.
 */
function visibilityScope(actor: AuthenticatedActor): Prisma.CampaignWhereInput {
  const isAgency = actor.role === 'agency_admin' || actor.role === 'agency_manager';
  return isAgency ? {} : { visibleToClient: true };
}

function companyScope(
  companyId: string | undefined,
  companyIds: string[] | null,
): Prisma.CampaignWhereInput {
  if (companyId) return { companyId };
  return companyIds === null ? {} : { companyId: { in: companyIds } };
}

async function findCampaignInScope(
  tx: ScopedDb,
  id: string,
  actor: AuthenticatedActor,
): Promise<Campaign | null> {
  const companyIds = authorizedCompanyIds(actor);
  return tx.campaign.findFirst({
    where: {
      AND: [{ id }, companyScope(undefined, companyIds), visibilityScope(actor)],
    },
  });
}

/** Renders a value the way the history stores it: text, or nothing at all. */
function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'toString' in value) return String(value);
  return String(value);
}

/**
 * One row per field that actually changed — no row for a field resubmitted unchanged,
 * which is what "exactly one history row per edit" in the roadmap means. Written with
 * a raw INSERT because the table's policies grant SELECT and INSERT only, and Prisma's
 * `create` appends a `RETURNING` the SELECT policy would then have to satisfy.
 */
async function recordChanges(
  tx: ScopedDb,
  campaignId: string,
  changedById: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  note: string | null,
): Promise<string[]> {
  const changed: string[] = [];

  for (const field of TRACKED_FIELDS) {
    const oldValue = asText(before[field]);
    const newValue = asText(after[field]);
    if (oldValue === newValue) continue;

    changed.push(field);
    await tx.$executeRaw`
      INSERT INTO "campaign_history"
        ("campaign_id", "changed_by", "field_name", "old_value", "new_value", "note")
      VALUES (
        ${campaignId}::uuid, ${changedById}::uuid, ${field},
        ${oldValue}, ${newValue}, ${note}
      )
    `;
  }

  return changed;
}

export async function campaignRoutes(app: FastifyInstance): Promise<void> {
  // ── Ad accounts ──────────────────────────────────────────────────────────────

  app.get(
    '/ad-accounts',
    tenantScoped(async ({ tx, actor, request }) => {
      const query = parseInput(
        paginationSchema.extend({
          companyId: z.string().uuid().optional(),
          platform: platform.optional(),
        }),
        request.query,
      );
      if (query.companyId) requireCompanyAccess(actor, query.companyId);

      const where: Prisma.AdAccountWhereInput = {
        AND: [
          query.companyId
            ? { companyId: query.companyId }
            : authorizedCompanyIds(actor) === null
              ? {}
              : { companyId: { in: authorizedCompanyIds(actor)! } },
          query.platform ? { platform: query.platform } : {},
        ],
      };

      const [rows, total] = await Promise.all([
        tx.adAccount.findMany({
          where,
          select: adAccountSelect,
          orderBy: { name: 'asc' },
          ...paginationArgs(query),
        }),
        tx.adAccount.count({ where }),
      ]);

      return paginated(rows, total, query);
    }),
  );

  app.post(
    '/ad-accounts',
    tenantScoped(async ({ tx, actor, request, reply }) => {
      const body = parseInput(adAccountCreateSchema, request.body);
      requireCompanyAccess(actor, body.companyId);
      requireCampaignManagement(actor, body.companyId);

      const account = await tx.adAccount.create({
        data: {
          companyId: body.companyId,
          platform: body.platform,
          name: body.name,
          externalAccountId: body.externalAccountId ?? null,
          status: body.status,
          notes: body.notes ?? null,
          createdById: actor.userId,
        },
        select: adAccountSelect,
      });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: account.companyId,
        action: AuditAction.AdAccountCreated,
        entityType: 'ad_account',
        entityId: account.id,
        ipAddress: clientIp(request),
      });

      reply.code(201);
      return { data: account };
    }),
  );

  app.patch(
    '/ad-accounts/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);
      const body = parseInput(adAccountUpdateSchema, request.body);
      const companyIds = authorizedCompanyIds(actor);

      const existing = await tx.adAccount.findFirst({
        where: {
          id: params.id,
          ...(companyIds === null ? {} : { companyId: { in: companyIds } }),
        },
        select: { id: true, companyId: true },
      });
      if (!existing) {
        throw notFound('not_found', 'Conta de anúncios não encontrada.');
      }
      requireCampaignManagement(actor, existing.companyId);

      const account = await tx.adAccount.update({
        where: { id: params.id },
        data: body,
        select: adAccountSelect,
      });

      // The platform is denormalised onto campaigns, so it cannot drift.
      if (body.platform) {
        await tx.campaign.updateMany({
          where: { adAccountId: account.id },
          data: { platform: body.platform },
        });
      }

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: account.companyId,
        action: AuditAction.AdAccountUpdated,
        entityType: 'ad_account',
        entityId: account.id,
        ipAddress: clientIp(request),
        metadata: { changed: Object.keys(body) },
      });

      return { data: account };
    }),
  );

  // ── Campaigns ────────────────────────────────────────────────────────────────

  app.get(
    '/campaigns',
    tenantScoped(async ({ tx, actor, request }) => {
      const query = parseInput(listQuerySchema, request.query);
      if (query.companyId) requireCompanyAccess(actor, query.companyId);

      const where: Prisma.CampaignWhereInput = {
        AND: [
          companyScope(query.companyId, authorizedCompanyIds(actor)),
          visibilityScope(actor),
          query.adAccountId ? { adAccountId: query.adAccountId } : {},
          query.platform ? { platform: query.platform } : {},
          query.status === 'all' ? {} : { status: query.status },
          query.responsibleUserId ? { responsibleUserId: query.responsibleUserId } : {},
          query.needsAttention ? { status: { in: CAMPAIGN_ATTENTION_STATUSES } } : {},
          query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {},
        ],
      };

      const [rows, total] = await Promise.all([
        tx.campaign.findMany({
          where,
          select: campaignSelect,
          orderBy: [{ status: 'asc' }, { name: 'asc' }],
          ...paginationArgs(query),
        }),
        tx.campaign.count({ where }),
      ]);

      return paginated(rows, total, query);
    }),
  );

  app.get(
    '/campaigns/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);
      const campaign = await findCampaignInScope(tx, params.id, actor);
      if (!campaign) {
        throw notFound('not_found', 'Campanha não encontrada.');
      }

      const history = await tx.campaignHistory.findMany({
        where: { campaignId: campaign.id },
        select: {
          id: true,
          changedById: true,
          fieldName: true,
          oldValue: true,
          newValue: true,
          note: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      return { data: { ...campaign, history } };
    }),
  );

  app.post(
    '/campaigns',
    tenantScoped(async ({ tx, actor, request, reply }) => {
      const body = parseInput(campaignCreateSchema, request.body);
      requireCompanyAccess(actor, body.companyId);
      requireCampaignManagement(actor, body.companyId);

      const account = await tx.adAccount.findFirst({
        where: { id: body.adAccountId, companyId: body.companyId },
        select: { id: true, platform: true },
      });
      if (!account) {
        throw unprocessable(
          'unknown_ad_account',
          'Conta de anúncios não encontrada nesta empresa.',
        );
      }
      if (body.responsibleUserId) {
        await assertResponsibleHasAccess(tx, body.companyId, body.responsibleUserId);
      }

      const campaign = await tx.campaign.create({
        data: {
          companyId: body.companyId,
          adAccountId: account.id,
          platform: account.platform,
          name: body.name,
          objective: body.objective ?? null,
          status: body.status,
          dailyBudget: body.dailyBudget ?? null,
          totalBudget: body.totalBudget ?? null,
          reportedSpend: body.reportedSpend ?? null,
          reportedBalance: body.reportedBalance ?? null,
          lastCheckedAt: body.lastCheckedAt ?? null,
          visibleToClient: body.visibleToClient,
          responsibleUserId: body.responsibleUserId ?? null,
          notes: body.notes ?? null,
          createdById: actor.userId,
        },
        select: campaignSelect,
      });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: campaign.companyId,
        action: AuditAction.CampaignCreated,
        entityType: 'campaign',
        entityId: campaign.id,
        ipAddress: clientIp(request),
      });

      reply.code(201);
      return { data: campaign };
    }),
  );

  app.patch(
    '/campaigns/:id',
    tenantScoped(async ({ tx, actor, request }) => {
      const params = parseInput(idParamsSchema, request.params);
      const { changeNote, ...body } = parseInput(campaignUpdateSchema, request.body);

      const existing = await findCampaignInScope(tx, params.id, actor);
      if (!existing) {
        throw notFound('not_found', 'Campanha não encontrada.');
      }
      requireCampaignManagement(actor, existing.companyId);

      let platformFromAccount: AdPlatform | undefined;
      if (body.adAccountId) {
        const account = await tx.adAccount.findFirst({
          where: { id: body.adAccountId, companyId: existing.companyId },
          select: { id: true, platform: true },
        });
        if (!account) {
          throw unprocessable(
            'unknown_ad_account',
            'Conta de anúncios não encontrada nesta empresa.',
          );
        }
        // Moving a campaign between accounts moves its platform with it. Never
        // accepted from the client: the account is the only thing that decides it.
        platformFromAccount = account.platform;
      }
      if (body.responsibleUserId) {
        await assertResponsibleHasAccess(tx, existing.companyId, body.responsibleUserId);
      }

      const campaign = await tx.campaign.update({
        where: { id: params.id },
        data: { ...body, ...(platformFromAccount ? { platform: platformFromAccount } : {}) },
        select: campaignSelect,
      });

      const changed = await recordChanges(
        tx,
        campaign.id,
        actor.userId,
        existing as unknown as Record<string, unknown>,
        campaign as unknown as Record<string, unknown>,
        changeNote ?? null,
      );

      await writeAuditLog(tx, {
        actorId: actor.userId,
        companyId: campaign.companyId,
        action: body.status ? AuditAction.CampaignStatusChanged : AuditAction.CampaignUpdated,
        entityType: 'campaign',
        entityId: campaign.id,
        ipAddress: clientIp(request),
        metadata: { changed },
      });

      if (changed.includes('status')) {
        if (CAMPAIGN_ATTENTION_STATUSES.includes(campaign.status)) {
          await notifyCampaignNeedsAttention(tx, {
            companyId: campaign.companyId,
            actorId: actor.userId,
            campaignId: campaign.id,
            name: campaign.name,
            status: campaign.status,
          });
        } else {
          await notifyCampaignStatusChanged(tx, {
            companyId: campaign.companyId,
            actorId: actor.userId,
            campaignId: campaign.id,
            name: campaign.name,
            status: campaign.status,
          });
        }
      }

      return { data: { ...campaign, changedFields: changed } };
    }),
  );
}
