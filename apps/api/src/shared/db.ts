import { PrismaClient } from '@prisma/client';
import { getEnv } from '../config/env.js';

export type Db = PrismaClient;

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    datasourceUrl: databaseUrl,
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });
}

let singleton: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  singleton ??= createPrismaClient(getEnv().DATABASE_URL);
  return singleton;
}

export async function disconnectPrismaClient(): Promise<void> {
  if (singleton) {
    const client = singleton;
    singleton = undefined;
    await client.$disconnect();
  }
}
