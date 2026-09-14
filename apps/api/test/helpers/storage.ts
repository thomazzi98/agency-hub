/**
 * The repository's `.env` carries real Cloudflare R2 credentials for production. These
 * guards are what make it impossible for a test run to reach them: the suite refuses
 * any endpoint on R2 outright, and the bucket name must say it is a test bucket — the
 * same shape of protection as the `_test` database-name check.
 */
export function assertDisposableStorage(): void {
  const endpoint = process.env.STORAGE_ENDPOINT;
  if (!endpoint) {
    throw new Error('STORAGE_ENDPOINT is not set. Copy .env.example to .env.');
  }

  const { hostname } = new URL(endpoint);
  if (hostname.endsWith('.r2.cloudflarestorage.com')) {
    throw new Error(
      `Refusing to run tests against Cloudflare R2 (${hostname}). Point STORAGE_ENDPOINT at the local MinIO from docker-compose.`,
    );
  }
}

export function resolveTestStorageBucket(): string {
  assertDisposableStorage();

  const bucket = process.env.TEST_STORAGE_BUCKET;
  if (!bucket) {
    throw new Error('TEST_STORAGE_BUCKET is not set. Copy .env.example to .env.');
  }
  if (!bucket.includes('test')) {
    throw new Error(`Refusing to use bucket "${bucket}" for tests: the name must contain "test".`);
  }
  return bucket;
}

/** Deterministic bytes, so an assertion about size or content is reproducible. */
export function syntheticBytes(length: number, seed = 7): Buffer {
  const buffer = Buffer.allocUnsafe(length);
  let value = seed;

  for (let index = 0; index < length; index += 1) {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    buffer[index] = value & 0xff;
  }
  return buffer;
}

export async function putPart(url: string, body: Buffer): Promise<string> {
  const response = await fetch(url, {
    method: 'PUT',
    body: new Uint8Array(body),
    headers: { 'content-length': String(body.byteLength) },
  });

  if (!response.ok) {
    throw new Error(`Part PUT failed with ${response.status}: ${await response.text()}`);
  }

  const etag = response.headers.get('etag');
  if (!etag) {
    throw new Error('Storage did not return an ETag for the uploaded part.');
  }
  return etag;
}
