import { loadDotenv } from '../src/config/dotenv.js';
import { resetEnvCache } from '../src/config/env.js';
import { resolveTestDatabaseUrl } from './helpers/test-database.js';
import { resolveTestStorageBucket } from './helpers/storage.js';

loadDotenv();

// Everything that reads DATABASE_URL (the Prisma client wrapper, the Fastify app)
// must see the test database, never the developer's working database.
process.env.DATABASE_URL = resolveTestDatabaseUrl();
// Likewise for storage: the guard refuses Cloudflare R2 outright.
process.env.STORAGE_BUCKET = resolveTestStorageBucket();
process.env.NODE_ENV = 'test';
process.env.PASSWORD_PEPPER ??= 'test-pepper-not-used-in-production-000000';

// Argon2 at production cost would add seconds to every login assertion; correctness
// of the hashing wiring is what the suite checks, not its work factor.
process.env.ARGON2_MEMORY_KIB ??= '1024';
process.env.ARGON2_TIME_COST ??= '1';

// The S3 multipart minimum. Keeps the multipart tests to a few megabytes of real
// bytes rather than the 32 MiB two production-sized parts would need.
process.env.UPLOAD_PART_SIZE_BYTES = String(5 * 1024 * 1024);

resetEnvCache();
