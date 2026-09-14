import { z } from 'zod';
import { validationErrorFrom } from './errors.js';

/** Validation runs before authorization and business logic, so bad input fails fast. */
export function parseInput<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  data: unknown,
): z.infer<TSchema> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw validationErrorFrom(result.error);
  }
  return result.data;
}

/**
 * A boolean in a query string. Deliberately not `z.coerce.boolean()`, which reads the
 * string "false" as `true` — every non-empty string is truthy — and would quietly turn
 * an explicit opt-out into an opt-in.
 */
export const booleanQuery = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');
