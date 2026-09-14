import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../shared/validation.js';
import { unprocessable } from '../../shared/errors.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import { clientIp } from '../../shared/request-context.js';
import { requireAgencyAdmin } from '../../shared/permissions.js';
import { tenantScoped } from '../../shared/tenant-scope.js';
import { MINIMUM_CONTRAST_RATIO, WHITE, contrastRatio, isHexColor } from './contrast.js';

const brandingSelect = {
  appName: true,
  primaryColor: true,
  secondaryColor: true,
  logoUrl: true,
  faviconUrl: true,
  loginImageUrl: true,
  loginMessage: true,
  updatedAt: true,
} as const;

const hexColor = z
  .string()
  .trim()
  .toLowerCase()
  .refine(isHexColor, { message: 'must be a six-digit hex colour such as #1d4ed8' });

/**
 * Asset URLs are accepted as plain links for now. Stage 6 adds an upload control that
 * fills these same fields, so no schema or contract change is needed then
 * (docs/PROGRESS.md, Stage 4).
 */
const assetUrl = z.string().trim().url().max(2000).nullish();

const updateSchema = z
  .object({
    appName: z.string().trim().min(1).max(60),
    primaryColor: hexColor,
    secondaryColor: hexColor,
    logoUrl: assetUrl,
    faviconUrl: assetUrl,
    loginImageUrl: assetUrl,
    loginMessage: z.string().trim().max(280).nullish(),
  })
  .partial();

function assertReadableColor(label: string, color: string): void {
  const ratio = contrastRatio(color, WHITE);

  if (ratio < MINIMUM_CONTRAST_RATIO) {
    throw unprocessable(
      'insufficient_contrast',
      `A cor ${label} não tem contraste suficiente com o texto branco ` +
        `(${ratio.toFixed(2)}:1, mínimo ${MINIMUM_CONTRAST_RATIO}:1). Escolha um tom mais escuro.`,
    );
  }
}

export async function brandingRoutes(app: FastifyInstance): Promise<void> {
  // Public: the login screen renders the brand before anyone is authenticated.
  app.get('/branding', { config: { isPublic: true } }, async () => {
    const branding = await app.prisma.brandingSettings.findFirstOrThrow({
      select: brandingSelect,
    });
    return { data: branding };
  });

  app.patch(
    '/branding',
    tenantScoped(async ({ tx, actor, request }) => {
      requireAgencyAdmin(actor);
      const body = parseInput(updateSchema, request.body);

      if (body.primaryColor) assertReadableColor('principal', body.primaryColor);
      if (body.secondaryColor) assertReadableColor('secundária', body.secondaryColor);

      const current = await tx.brandingSettings.findFirstOrThrow({ select: { id: true } });
      const branding = await tx.brandingSettings.update({
        where: { id: current.id },
        data: { ...body, updatedById: actor.userId },
        select: brandingSelect,
      });

      await writeAuditLog(tx, {
        actorId: actor.userId,
        action: AuditAction.BrandingUpdated,
        entityType: 'branding_settings',
        entityId: current.id,
        ipAddress: clientIp(request),
        metadata: { changed: Object.keys(body) },
      });

      return { data: branding };
    }),
  );
}
