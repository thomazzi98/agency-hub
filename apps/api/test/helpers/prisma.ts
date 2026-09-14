import type { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../src/shared/db.js';
import { withSystemScope } from '../../src/shared/tenant-scope.js';
import { clearDatabase, resolveTestDatabaseUrl } from './test-database.js';

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

export async function resetDatabase(): Promise<void> {
  await clearDatabase(resolveTestDatabaseUrl());
}

/**
 * audit_logs is behind an RLS read policy, so a plain query on the application role
 * with no tenant context correctly returns nothing. Assertions about platform-level
 * events therefore read through the system scope.
 */
export async function auditActions(): Promise<string[]> {
  return withSystemScope(testPrisma(), async (tx) => {
    const rows = await tx.auditLog.findMany({ select: { action: true } });
    return rows.map((row) => row.action);
  });
}
