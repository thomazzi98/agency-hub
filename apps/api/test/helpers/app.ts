import type { FastifyInstance, InjectOptions } from 'fastify';
import type { UserRole, UserStatus } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { testPrisma } from './prisma.js';

export function buildTestApp(): FastifyInstance {
  return buildApp({ prisma: testPrisma(), logger: false });
}

export interface CreateUserOptions {
  email?: string;
  password?: string;
  name?: string;
  role?: UserRole;
  status?: UserStatus;
  mustChangePassword?: boolean;
}

export const DEFAULT_TEST_PASSWORD = 'senha-de-teste-123';

export async function createTestUser(options: CreateUserOptions = {}) {
  const prisma = testPrisma();
  return prisma.user.create({
    data: {
      name: options.name ?? 'Usuário de Teste',
      email: options.email ?? `user-${crypto.randomUUID()}@example.com`,
      passwordHash: await hashPassword(options.password ?? DEFAULT_TEST_PASSWORD),
      role: options.role ?? 'agency_manager',
      status: options.status ?? 'active',
      mustChangePassword: options.mustChangePassword ?? false,
    },
  });
}

export async function createTestCompany(name = `Cliente ${crypto.randomUUID().slice(0, 8)}`) {
  return testPrisma().company.create({ data: { name } });
}

/** Each caller gets its own source IP so the per-IP login limit never bleeds across tests. */
export function uniqueIp(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

export function withIp(options: InjectOptions, ip: string): InjectOptions {
  return {
    ...options,
    headers: { ...options.headers, 'x-forwarded-for': ip },
  };
}

export interface LoginOptions {
  ip?: string;
}

export async function loginAs(
  app: FastifyInstance,
  email: string,
  password: string = DEFAULT_TEST_PASSWORD,
  options: LoginOptions = {},
): Promise<string> {
  const response = await app.inject(
    withIp(
      { method: 'POST', url: '/api/auth/login', payload: { email, password } },
      options.ip ?? uniqueIp(),
    ),
  );

  if (response.statusCode !== 200) {
    throw new Error(`Login failed (${response.statusCode}): ${response.body}`);
  }

  const cookie = response.cookies.find((candidate) => candidate.name === 'agency_hub_session');
  if (!cookie) {
    throw new Error('Login response did not set a session cookie');
  }
  return `${cookie.name}=${cookie.value}`;
}

export function authed(options: InjectOptions, cookie: string, ip = uniqueIp()): InjectOptions {
  return {
    ...options,
    headers: { ...options.headers, cookie, 'x-forwarded-for': ip },
  };
}
