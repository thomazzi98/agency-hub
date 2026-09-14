import { z } from 'zod';
import type { PublicationNetwork, PublicationStatus } from '@prisma/client';

export const publicationNetwork = z.enum(['instagram', 'facebook', 'tiktok', 'youtube_shorts']);

export const publicationStatus = z.enum([
  'not_planned',
  'planned',
  'scheduled',
  'published',
  'not_published',
  'failed',
  'cancelled',
]);

/**
 * Phase 1's networks, in the order the UI shows them
 * (03-functional-requirements.md#multi-network-publication-log).
 */
export const NETWORKS: PublicationNetwork[] = ['instagram', 'facebook', 'tiktok', 'youtube_shorts'];

/**
 * Still owed: someone intends to post this and has not. `not_published`, `cancelled`
 * and `not_planned` are all decisions already taken, and `failed` is surfaced on its
 * own because it needs a different action — a retry, not a nudge.
 */
export const PENDING_STATUSES: PublicationStatus[] = ['planned', 'scheduled'];

export const publicationSelect = {
  id: true,
  contentId: true,
  network: true,
  status: true,
  publishedAt: true,
  link: true,
  responsibleUserId: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} as const;
