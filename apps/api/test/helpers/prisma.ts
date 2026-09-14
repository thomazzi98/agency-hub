import type { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../src/shared/db.js';
import { resolveTestDatabaseUrl } from './test-database.js';

let client: PrismaClient | undefined;

export function testPrisma(): PrismaClient {
  client ??= createPrismaClient(resolveTestDatabaseUrl());
  return client;
}

export async function closeTestPrisma(): Promise<void> {
  if (client) {
    const current = client;
    client = undefined;
    await current.$disconnect();
  }
}

/**
 * Empties every application table, discovered dynamically so new stages need no edit
 * here. `DELETE` rather than `TRUNCATE`: truncating rewrites each table's file, which
 * costs ~3s per call on a Docker volume — multiplied by every test's `beforeEach`.
 * Foreign keys make delete order matter, so passes repeat until nothing is left.
 */
const RESET_SQL = `
DO $reset$
DECLARE
  target record;
  blocked integer;
  pass integer := 0;
BEGIN
  LOOP
    pass := pass + 1;
    blocked := 0;

    FOR target IN
      SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I', target.tablename);
      EXCEPTION WHEN foreign_key_violation THEN
        blocked := blocked + 1;
      END;
    END LOOP;

    EXIT WHEN blocked = 0;

    IF pass > 20 THEN
      RAISE EXCEPTION 'Could not clear the test database: % tables still blocked by foreign keys', blocked;
    END IF;
  END LOOP;
END
$reset$;
`;

export async function resetDatabase(): Promise<void> {
  await testPrisma().$executeRawUnsafe(RESET_SQL);
}
