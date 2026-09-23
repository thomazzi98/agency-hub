import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

/** The smallest environment the schema accepts; each case builds on it. */
const required = {
  DATABASE_URL: 'postgresql://app:pw@localhost:5432/db',
  PASSWORD_PEPPER: 'a-pepper-long-enough-for-the-schema',
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_ACCESS_KEY_ID: 'key',
  STORAGE_SECRET_ACCESS_KEY: 'secret',
  STORAGE_BUCKET: 'bucket',
  DB_OWNER_USER: 'owner',
};

describe('environment configuration', () => {
  /**
   * docker-compose.yml and docker-compose.prod.yml pass every optional setting as
   * `${VAR:-}`, which reaches the process as an empty string whenever the variable is
   * not in `.env`. An optional setting therefore has to treat "" exactly like "unset",
   * or the container refuses to start in the default configuration - which is what
   * happened with the backup key before this test existed.
   */
  it('treats the empty strings compose hands over as unset', () => {
    const env = loadEnv({
      ...required,
      BACKUP_ENCRYPTION_KEY: '',
      VAPID_PUBLIC_KEY: '',
      VAPID_PRIVATE_KEY: '',
      VAPID_SUBJECT: '',
      CORS_ORIGIN: '',
      DB_OWNER_PASSWORD: '',
      APP_TIMEZONE: '',
    });

    expect(env.backupEncryptionKey).toBeNull();
    expect(env.pushEnabled).toBe(false);
    expect(env.corsOrigins).toEqual([]);
    expect(env.APP_TIMEZONE).toBe('America/Sao_Paulo');
  });

  it('turns a 64-hex backup key into 32 bytes and refuses anything else', () => {
    const key = 'ab'.repeat(32);
    expect(loadEnv({ ...required, BACKUP_ENCRYPTION_KEY: key }).backupEncryptionKey).toEqual(
      Buffer.from(key, 'hex'),
    );

    expect(() => loadEnv({ ...required, BACKUP_ENCRYPTION_KEY: 'too-short' })).toThrow(
      /BACKUP_ENCRYPTION_KEY: must be 64 hex characters/,
    );
  });

  it('enables push only when the whole VAPID triple is present', () => {
    const vapid = {
      VAPID_PUBLIC_KEY: 'pub',
      VAPID_PRIVATE_KEY: 'priv',
      VAPID_SUBJECT: 'mailto:a@b.c',
    };
    expect(loadEnv({ ...required, ...vapid }).pushEnabled).toBe(true);
    expect(loadEnv({ ...required, ...vapid, VAPID_SUBJECT: '' }).pushEnabled).toBe(false);
  });

  it('defaults the cookie to Secure in production and not before', () => {
    expect(loadEnv({ ...required, NODE_ENV: 'production' }).SESSION_COOKIE_SECURE).toBe(true);
    expect(loadEnv({ ...required, NODE_ENV: 'development' }).SESSION_COOKIE_SECURE).toBe(false);
  });
});
