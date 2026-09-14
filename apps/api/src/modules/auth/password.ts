import { randomBytes } from 'node:crypto';
import { type Algorithm, hash, verify } from '@node-rs/argon2';
import { getEnv } from '../../config/env.js';

// `Algorithm` is declared as a TypeScript `const enum`, which `isolatedModules`
// forbids reading as a value; 2 is `Algorithm.Argon2id`, the variant ADR-0009 requires.
const ARGON2ID = 2 as Algorithm;

function argon2Options() {
  const env = getEnv();
  return {
    algorithm: ARGON2ID,
    memoryCost: env.ARGON2_MEMORY_KIB,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
    // Argon2's keyed mode: the pepper lives only in the environment, so a stolen
    // database dump alone cannot be cracked offline.
    secret: Buffer.from(env.PASSWORD_PEPPER, 'utf8'),
  };
}

export async function hashPassword(plainPassword: string): Promise<string> {
  return hash(plainPassword, argon2Options());
}

export async function verifyPassword(
  passwordHash: string,
  plainPassword: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, plainPassword, argon2Options());
  } catch {
    return false;
  }
}

/**
 * Equalizes login timing when the email does not exist, so response time cannot be
 * used to enumerate accounts. The cost must match a real verification, hence a real
 * (throwaway) hash rather than a fixed sleep.
 */
let decoyHash: string | undefined;

export async function verifyAgainstDecoy(plainPassword: string): Promise<void> {
  decoyHash ??= await hashPassword(randomBytes(24).toString('base64url'));
  await verifyPassword(decoyHash, plainPassword);
}

/** Temporary password shown to the admin exactly once, then never recoverable. */
export function generateTemporaryPassword(): string {
  return randomBytes(12).toString('base64url');
}
