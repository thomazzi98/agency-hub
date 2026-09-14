import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 20;
/** Enforced server-side regardless of what the client asks for (17-performance-requirements.md). */
export const MAX_PAGE_SIZE = 100;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  /**
   * Clamped rather than rejected: the acceptance criterion is that the response is
   * capped, never unbounded (22-acceptance-criteria.md #30). Answering a client that
   * asks for too much with a 400 would turn an old or mistaken caller into a broken
   * screen, where serving it a hundred rows answers the question it was actually
   * asking. The cap itself is not negotiable — it just is not a reason to fail.
   */
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_PAGE_SIZE)
    .transform((value) => Math.min(value, MAX_PAGE_SIZE)),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function paginationArgs(pagination: Pagination): { skip: number; take: number } {
  return {
    skip: (pagination.page - 1) * pagination.pageSize,
    take: pagination.pageSize,
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

export function paginated<T>(
  rows: T[],
  total: number,
  pagination: Pagination,
): PaginatedResponse<T> {
  return {
    data: rows,
    meta: { page: pagination.page, pageSize: pagination.pageSize, total },
  };
}

/**
 * Sorting is restricted to an explicit allow-list per endpoint: an arbitrary
 * client-supplied column is both an unindexed-sort denial-of-service and an
 * injection surface (15-api-conventions.md#pagination-filtering-sorting).
 */
export function sortSchema<const TFields extends readonly [string, ...string[]]>(
  sortable: TFields,
  defaultField: TFields[number],
  defaultOrder: 'asc' | 'desc' = 'desc',
) {
  return z.object({
    sort: z.enum(sortable).default(defaultField),
    order: z.enum(['asc', 'desc']).default(defaultOrder),
  });
}
