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

    // Object storage. The same settings address MinIO in development and Cloudflare R2
    // in production (07-upload-architecture.md).
    STORAGE_ENDPOINT: z.string().url(),
    STORAGE_ACCESS_KEY_ID: z.string().min(1),
    STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
    STORAGE_BUCKET: z.string().min(1),
    STORAGE_REGION: z.string().min(1).default('auto'),
    STORAGE_FORCE_PATH_STYLE: booleanish.default('false'),

    // Upload policy. Every value here is an initial configuration value, tunable
    // without a code change, per 07-upload-architecture.md.
    UPLOAD_MAX_FILE_BYTES: z.coerce.number().int().positive().default(32_212_254_720),
    UPLOAD_PART_SIZE_BYTES: z.coerce
      .number()
      .int()
      // The S3 multipart minimum is 5 MiB and the maximum 5 GiB; anything outside that
      // range produces uploads the provider rejects only at completion time.
      .min(5 * 1024 * 1024)
      .max(5 * 1024 * 1024 * 1024)
      .default(16 * 1024 * 1024),
    UPLOAD_PRESIGN_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    UPLOAD_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().default(1200),
    UPLOAD_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
    UPLOAD_MAX_ACTIVE_SESSIONS_PER_COMPANY: z.coerce.number().int().positive().default(5),
    UPLOAD_DOWNLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    /** Comma-separated; `image/*` matches a whole type. Empty uses the built-in list. */
    UPLOAD_ALLOWED_MIME_TYPES: z.string().optional(),

    // Background worker. pg-boss migrates its own schema, which the least-privilege
    // application role cannot do, so the queue connects with the owner credentials.
    DB_OWNER_USER: z.string().min(1),
    DB_OWNER_PASSWORD: z.string().optional(),
    WORKER_DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(5),
    UPLOAD_CLEANUP_CRON: z.string().min(1).default('0 * * * *'),
    CONTENT_OVERDUE_CRON: z.string().min(1).default('15 * * * *'),

    // Manual database backup (11-backup-and-recovery.md). The directory is shared
    // between the API and the worker: the worker writes the dump, the API streams it.
    BACKUP_DIRECTORY: z.string().min(1).default('./var/backups'),
    BACKUP_RETENTION_MINUTES: z.coerce.number().int().positive().default(120),
    BACKUP_CLEANUP_CRON: z.string().min(1).default('30 * * * *'),
    /**
     * How long a backup may sit queued or processing before a new request supersedes
     * it. Without this a worker that dies mid-dump locks backups out permanently:
     * the single-flight rule would keep refusing every later request forever, with no
     * way to clear it from the UI. Generous by default — a dump legitimately takes a
     * while — and the E2E environment sets it to 0 because it runs no worker at all.
     */
    BACKUP_STALE_MINUTES: z.coerce.number().int().nonnegative().default(60),
    /**
     * 64 hex characters (32 bytes). Set it and dumps are encrypted at rest with
     * AES-256-GCM and decrypted while streaming the download; leave it empty and the
     * file is compressed only, protected by the volume's own access control.
     *
     * "Empty" has to include the empty string, not only an unset variable: the compose
     * files hand every optional setting over as `${VAR:-}`, which is `""` when it is
     * not in `.env`. Rejecting that made the API and the worker refuse to start in
     * exactly the configuration `.env.example` describes as the default.
     */
    BACKUP_ENCRYPTION_KEY: z
      .union([z.literal(''), z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters')])
      .optional()
      .transform((value) => value || undefined),
    /** Path to pg_dump, for images where it is not on PATH. */
    PG_DUMP_PATH: z.string().min(1).default('pg_dump'),

    // Web Push (ADR-0005). Absent keys disable push entirely and the app falls back to
    // in-app notifications only, which is the system of record either way — so a
    // deployment without keys is degraded, never broken.
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    /** A mailto: or https: URL identifying the sender to the push service. */
    VAPID_SUBJECT: z.string().optional(),
    /** Thresholds, not constants, so they are tunable post-launch
        (08-notifications-and-push.md#deduplication--anti-spam-concrete-parameters). */
    PUSH_RESOURCE_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),
    PUSH_MAX_PER_USER_PER_HOUR: z.coerce.number().int().positive().default(20),
  })
  .transform((value) => ({
    ...value,
    // Insecure cookies must never be possible in production, but a developer on
    // plain http needs them off — so the default follows NODE_ENV, not a literal.
    SESSION_COOKIE_SECURE: value.SESSION_COOKIE_SECURE ?? value.NODE_ENV === 'production',
    backupEncryptionKey: value.BACKUP_ENCRYPTION_KEY
      ? Buffer.from(value.BACKUP_ENCRYPTION_KEY, 'hex')
      : null,
    /** Push is only attempted when the deployment actually has a key pair. */
    pushEnabled: Boolean(value.VAPID_PUBLIC_KEY && value.VAPID_PRIVATE_KEY && value.VAPID_SUBJECT),
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
