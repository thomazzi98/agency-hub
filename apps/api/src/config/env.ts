import { z } from 'zod';

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().url(),

    // Comma-separated list of allowed browser origins. Empty disables CORS entirely,
    // which is correct when the SPA is served from the same origin behind Caddy.
    CORS_ORIGIN: z.string().optional(),

    // Argon2id — OWASP minimum, tunable to VPS capacity (ADR-0009).
    PASSWORD_PEPPER: z.string().min(16),
    ARGON2_MEMORY_KIB: z.coerce.number().int().positive().default(19456),
    ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),
    PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(10),

    SESSION_COOKIE_NAME: z.string().min(1).default('agency_hub_session'),
    SESSION_COOKIE_SECURE: booleanish.optional(),
    SESSION_SLIDING_DAYS: z.coerce.number().int().positive().default(7),
    SESSION_ABSOLUTE_DAYS: z.coerce.number().int().positive().default(30),
    REAUTH_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),

    LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOGIN_LOCKOUT_BASE_SECONDS: z.coerce.number().int().positive().default(30),
    LOGIN_LOCKOUT_MAX_SECONDS: z.coerce.number().int().positive().default(900),
    LOGIN_IP_MAX_ATTEMPTS_PER_HOUR: z.coerce.number().int().positive().default(20),
  })
  .transform((value) => ({
    ...value,
    // Insecure cookies must never be possible in production, but a developer on
    // plain http needs them off — so the default follows NODE_ENV, not a literal.
    SESSION_COOKIE_SECURE: value.SESSION_COOKIE_SECURE ?? value.NODE_ENV === 'production',
    corsOrigins: (value.CORS_ORIGIN ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  }));

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Tests mutate process.env between cases; production never calls this. */
export function resetEnvCache(): void {
  cached = undefined;
}
