import type { z } from 'zod';
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
