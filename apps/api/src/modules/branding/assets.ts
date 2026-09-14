import { randomUUID } from 'node:crypto';
import { unprocessable } from '../../shared/errors.js';

/**
 * Branding assets are the one upload that deliberately passes through this process.
 *
 * The no-bytes-through-the-backend rule exists for the 30 GB media path
 * (07-upload-architecture.md); a logo is at most 2 MB and needs something the media
 * path cannot give it: a **stable, public** URL. Objects in the bucket are private and
 * reachable only through short-lived signed URLs, which is exactly wrong for an image
 * the login screen must render before anyone has authenticated. So these few small
 * files are received here, stored under a `branding/` prefix, and served back with a
 * long cache lifetime — the URL carries a UUID, so it is immutable by construction.
 *
 * Limits resolved during Stage 4 (docs/PROGRESS.md).
 */
export type BrandingAssetKind = 'logo' | 'favicon' | 'loginImage';

interface AssetRule {
  maxBytes: number;
  mimeTypes: Record<string, string>;
  field: 'logoUrl' | 'faviconUrl' | 'loginImageUrl';
}

export const BRANDING_ASSET_RULES: Record<BrandingAssetKind, AssetRule> = {
  logo: {
    maxBytes: 2 * 1024 * 1024,
    mimeTypes: {
      'image/svg+xml': 'svg',
      'image/png': 'png',
      'image/webp': 'webp',
    },
    field: 'logoUrl',
  },
  favicon: {
    maxBytes: 256 * 1024,
    mimeTypes: {
      'image/png': 'png',
      'image/x-icon': 'ico',
      'image/vnd.microsoft.icon': 'ico',
    },
    field: 'faviconUrl',
  },
  loginImage: {
    maxBytes: 4 * 1024 * 1024,
    mimeTypes: {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    },
    field: 'loginImageUrl',
  },
};

export function isBrandingAssetKind(value: string): value is BrandingAssetKind {
  return value in BRANDING_ASSET_RULES;
}

export function assetRuleFor(kind: BrandingAssetKind): AssetRule {
  return BRANDING_ASSET_RULES[kind];
}

export function extensionFor(kind: BrandingAssetKind, mimeType: string): string {
  const extension = BRANDING_ASSET_RULES[kind].mimeTypes[mimeType.toLowerCase()];

  if (!extension) {
    throw unprocessable(
      'file_type_not_allowed',
      `Formato não aceito para este item. Use ${Object.values(BRANDING_ASSET_RULES[kind].mimeTypes)
        .filter((value, index, all) => all.indexOf(value) === index)
        .join(', ')
        .toUpperCase()}.`,
    );
  }
  return extension;
}

/** The UUID is what makes the served URL safe to cache forever. */
export function buildBrandingAssetKey(kind: BrandingAssetKind, extension: string): string {
  return `branding/${kind}/${randomUUID()}.${extension}`;
}

const KEY_PREFIX = 'branding/';
const URL_PREFIX = '/api/branding/assets/';

export function brandingAssetUrl(storageKey: string): string {
  return `${URL_PREFIX}${storageKey.slice(KEY_PREFIX.length)}`;
}

export function isBrandingAssetUrl(value: string): boolean {
  return value.startsWith(URL_PREFIX);
}

/** Only keys this module itself minted are servable, so the route cannot be a reader for the whole bucket. */
export function isBrandingAssetKey(storageKey: string): boolean {
  return /^branding\/(logo|favicon|loginImage)\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/.test(storageKey);
}
