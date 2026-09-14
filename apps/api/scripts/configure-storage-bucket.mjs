#!/usr/bin/env node
/**
 * Applies the two bucket-level settings the upload architecture depends on.
 *
 * 1. **CORS.** The browser PUTs every part straight to the bucket, so the bucket must
 *    allow that origin and expose the `ETag` response header — without the exposed
 *    header the browser can read the part's ETag only for same-origin requests, and
 *    multipart completion has nothing to assemble from.
 *
 * 2. **Abort incomplete multipart uploads after 7 days.** The hourly cleanup job is the
 *    primary mechanism (docs/sdd/07-upload-architecture.md#abandoned-upload-cleanup);
 *    this is the independent net for when that job is down or buggy, because unaborted
 *    parts are billed until something removes them.
 *
 * Run it against production explicitly and deliberately:
 *   node apps/api/scripts/configure-storage-bucket.mjs --origin https://app.example.com
 *
 * It reads STORAGE_* from the environment, so pointing it at Cloudflare R2 means
 * setting those to the R2 values first. It refuses to guess an origin.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import {
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadDotenv({ path: path.resolve(apiDir, '../../.env'), quiet: true });

const originFlag = process.argv.indexOf('--origin');
const origins =
  originFlag === -1
    ? (process.env.STORAGE_CORS_ORIGINS ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [process.argv[originFlag + 1]].filter(Boolean);

if (origins.length === 0) {
  throw new Error(
    'No origin given. Pass --origin https://your-app-domain or set STORAGE_CORS_ORIGINS.',
  );
}

const bucket = process.env.STORAGE_BUCKET;
if (!bucket) {
  throw new Error('STORAGE_BUCKET is not set.');
}

const client = new S3Client({
  region: process.env.STORAGE_REGION ?? 'auto',
  endpoint: process.env.STORAGE_ENDPOINT,
  forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? '',
  },
});

/**
 * Reported rather than fatal, because the local development server genuinely cannot do
 * either of these: MinIO does not implement PutBucketCors (it allows every origin) and
 * rejects an abort-only lifecycle rule. Cloudflare R2 implements both, so a warning
 * printed against R2 is a real problem to act on rather than noise.
 */
async function apply(label, command) {
  try {
    await client.send(command);
    console.log(`${label}: applied.`);
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 160);
    console.warn(`${label}: not applied (${reason}).`);
    return false;
  }
  return true;
}

await apply(
  `CORS on "${bucket}" for ${origins.join(', ')}`,
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: origins,
          AllowedMethods: ['PUT', 'GET', 'HEAD'],
          AllowedHeaders: ['*'],
          // Without this the browser cannot read the ETag it must report back.
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);

const lifecycleApplied = await apply(
  `Lifecycle rule on "${bucket}" (abort incomplete multipart after 7 days)`,
  new PutBucketLifecycleConfigurationCommand({
    Bucket: bucket,
    LifecycleConfiguration: {
      Rules: [
        {
          ID: 'abort-incomplete-multipart-uploads',
          Status: 'Enabled',
          Filter: { Prefix: '' },
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
        },
      ],
    },
  }),
);

if (!lifecycleApplied) {
  console.warn(
    'The hourly cleanup job still aborts abandoned uploads; this rule is the independent net for when it is down.',
  );
}

client.destroy();
