import { loadDotenv } from '../src/config/dotenv.js';
import { resolveTestDatabaseUrl } from './helpers/test-database.js';

loadDotenv();

// Everything that reads DATABASE_URL (the Prisma client wrapper, the Fastify app)
// must see the test database, never the developer's working database.
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.NODE_ENV = 'test';
