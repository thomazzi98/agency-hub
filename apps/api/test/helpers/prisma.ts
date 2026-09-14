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

/** Truncates every application table, discovered dynamically so new stages need no edit here. */
export async function resetDatabase(): Promise<void> {
  const prisma = testPrisma();
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (tables.length === 0) return;

  const quoted = tables.map((table) => `"public"."${table.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
}
