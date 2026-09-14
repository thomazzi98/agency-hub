import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '../../src/config/env.js';
import { hashPassword, verifyPassword } from '../../src/modules/auth/password.js';
import { hashSessionToken, generateSessionToken } from '../../src/modules/auth/session-service.js';

const originalPepper = process.env.PASSWORD_PEPPER;

afterEach(() => {
  process.env.PASSWORD_PEPPER = originalPepper;
  resetEnvCache();
});

describe('password hashing', () => {
  it('produces an Argon2id hash that does not contain the password', async () => {
    const hash = await hashPassword('senha-secreta-123');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('senha-secreta-123');
  });

  it('salts each hash, so the same password never hashes identically', async () => {
    const [first, second] = await Promise.all([
      hashPassword('senha-secreta-123'),
      hashPassword('senha-secreta-123'),
    ]);

    expect(first).not.toBe(second);
  });

  it('verifies the correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('senha-secreta-123');

    await expect(verifyPassword(hash, 'senha-secreta-123')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'senha-errada-123')).resolves.toBe(false);
  });

  it('rejects a malformed hash instead of throwing', async () => {
    await expect(verifyPassword('not-a-hash', 'senha-secreta-123')).resolves.toBe(false);
  });

  it('will not verify a hash made under a different pepper', async () => {
    const hash = await hashPassword('senha-secreta-123');

    process.env.PASSWORD_PEPPER = 'a-completely-different-pepper-value';
    resetEnvCache();

    await expect(verifyPassword(hash, 'senha-secreta-123')).resolves.toBe(false);
  });
});

describe('session tokens', () => {
  it('generates high-entropy tokens that never repeat', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateSessionToken()));

    expect(tokens.size).toBe(100);
    expect([...tokens][0]?.length).toBeGreaterThanOrEqual(43);
  });

  it('hashes a token to a stable 64-character digest', () => {
    const token = generateSessionToken();

    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).toHaveLength(64);
    expect(hashSessionToken(token)).not.toBe(token);
  });
});
