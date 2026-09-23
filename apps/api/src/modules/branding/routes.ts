import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseInput } from '../../shared/validation.js';
import { notFound, unprocessable } from '../../shared/errors.js';
import { AuditAction, writeAuditLog } from '../../shared/audit.js';
import { clientIp } from '../../shared/request-context.js';
import { requireAgencyAdmin } from '../../shared/permissions.js';
import { multiScoped, tenantScoped } from '../../shared/tenant-scope.js';
import { MINIMUM_CONTRAST_RATIO, WHITE, contrastRatio, isHexColor } from './contrast.js';
import {
  assetRuleFor,
  brandingAssetUrl,
  buildBrandingAssetKey,
  extensionFor,
  isBrandingAssetKey,
  isBrandingAssetKind,
  isBrandingAssetUrl,
} from './assets.js';
import { putObject, readObject } from '../../shared/storage.js';

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
 * Either an external link the admin pastes, or a path this API itself minted when an
 * asset was uploaded. Without the second case, re-saving the form after an upload
 * would fail validation on the value the server had just produced.
 */
const assetUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => isBrandingAssetUrl(value) || z.string().url().safeParse(value).success, {
    message: 'must be a URL or an uploaded branding asset path',
  })
  .nullish();

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

  /**
   * Served from here rather than as a signed URL: the login screen needs the brand
   * before anyone is authenticated, and a signed URL expires. The key carries a UUID,
   * so a given URL never changes content and can be cached indefinitely.
   */
  app.get('/branding/assets/*', { config: { isPublic: true } }, async (request, reply) => {
    const storageKey = `branding/${(request.params as { '*': string })['*']}`;

    if (!isBrandingAssetKey(storageKey)) {
      throw notFound('not_found', 'Arquivo não encontrado.');
    }

    const object = await readObject(storageKey);
    if (!object) {
      throw notFound('not_found', 'Arquivo não encontrado.');
    }

    return (
      reply
        .header('content-type', object.mimeType)
        .header('cache-control', 'public, max-age=31536000, immutable')
        // A logo may be an SVG, and an SVG opened as a page runs its scripts - on this
        // origin, next to the session. Rendered through <img> none of this applies; opened
        // directly, the document is sandboxed and allowed nothing but its own styles.
        .header('x-content-type-options', 'nosniff')
        .header(
          'content-security-policy',
          "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
        )
        .send(Buffer.from(object.body))
    );
  });

  app.post(
    '/branding/assets/:kind',
    multiScoped(async ({ runScoped, actor, request, reply }) => {
      requireAgencyAdmin(actor);

      const kind = (request.params as { kind: string }).kind;
      if (!isBrandingAssetKind(kind)) {
        throw unprocessable('unknown_asset_kind', 'Tipo de arquivo de marca desconhecido.');
      }

      const rule = assetRuleFor(kind);
      const upload = await request.file();
      if (!upload) {
        throw unprocessable('file_missing', 'Nenhum arquivo foi enviado.');
      }

      const body = await upload.toBuffer();
      // `toBuffer` truncates at the plugin's ceiling and flags it, so a file over the
      // limit is rejected rather than silently stored half-written.
      if (upload.file.truncated || body.byteLength > rule.maxBytes) {
        throw unprocessable(
          'file_too_large',
          `O arquivo excede o limite de ${Math.round(rule.maxBytes / 1024)} KB para este item.`,
        );
      }

      const extension = extensionFor(kind, upload.mimetype);
      const storageKey = buildBrandingAssetKey(kind, extension);
      await putObject({ storageKey, body, mimeType: upload.mimetype });

      const url = brandingAssetUrl(storageKey);

      const branding = await runScoped(async (tx) => {
        const current = await tx.brandingSettings.findFirstOrThrow({ select: { id: true } });
        const updated = await tx.brandingSettings.update({
          where: { id: current.id },
          data: { [rule.field]: url, updatedById: actor.userId },
          select: brandingSelect,
        });

        await writeAuditLog(tx, {
          actorId: actor.userId,
          action: AuditAction.BrandingUpdated,
          entityType: 'branding_settings',
          entityId: current.id,
          ipAddress: clientIp(request),
          metadata: { asset: kind, sizeBytes: body.byteLength },
        });

        return updated;
      });

      reply.code(201);
      return { data: branding };
    }),
  );

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
