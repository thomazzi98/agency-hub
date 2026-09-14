#!/usr/bin/env node
/**
 * Checks the production compose file for the mistakes that would be catastrophic and
 * silent (docs/sdd/16-security-requirements.md, docs/sdd/19-deployment-and-cicd.md).
 *
 * It reads the *resolved* configuration rather than grepping the YAML, so a port added
 * through an override, an anchor or a merge key is caught just the same.
 *
 * The placeholder values below exist only to let compose resolve the file. Real
 * settings live in the VPS's `.env` and in GitHub Secrets, never in the repository.
 */
import { execFileSync } from 'node:child_process';

const PLACEHOLDERS = {
  API_IMAGE: 'ghcr.io/example/agency-hub-api:check',
  WEB_IMAGE: 'ghcr.io/example/agency-hub-web:check',
  APP_DOMAIN: 'example.invalid',
  POSTGRES_USER: 'check',
  POSTGRES_PASSWORD: 'check',
  DATABASE_URL: 'postgresql://check:check@postgres:5432/check',
  DB_OWNER_USER: 'check',
  DB_OWNER_PASSWORD: 'check',
  PASSWORD_PEPPER: 'check',
  STORAGE_ENDPOINT: 'https://storage.example.invalid',
  STORAGE_ACCESS_KEY_ID: 'check',
  STORAGE_SECRET_ACCESS_KEY: 'check',
  STORAGE_BUCKET: 'check',
  STORAGE_PUBLIC_ORIGIN: 'https://storage.example.invalid',
};

let config;
try {
  const json = execFileSync(
    'docker',
    ['compose', '-f', 'docker-compose.prod.yml', 'config', '--format', 'json'],
    {
      env: { ...process.env, ...PLACEHOLDERS },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  config = JSON.parse(json);
} catch (error) {
  console.error('Could not resolve docker-compose.prod.yml:\n');
  console.error(error.stderr?.toString() ?? error.message);
  process.exit(1);
}

const services = config.services ?? {};
const problems = [];

// The single worst mistake available here: a database on the public internet.
if ((services.postgres?.ports ?? []).length > 0) {
  problems.push('postgres publishes a port; it must be reachable only on the internal network');
}

// A production stack pulls images by tag. Building on the VPS means the tag no longer
// identifies what is running, and a rollback stops meaning anything.
for (const [name, service] of Object.entries(services)) {
  if (service.build) problems.push(`${name} builds its image on the host instead of pulling a tag`);
}

// The session cookie carries authentication; without Secure it can leave over http.
if (services.api?.environment?.SESSION_COOKIE_SECURE !== 'true') {
  problems.push('api does not force SESSION_COOKIE_SECURE=true');
}

// Losing the database volume is unrecoverable, so it is named and must stay named.
if (!config.volumes?.postgres_data) {
  problems.push('there is no named volume for PostgreSQL data');
}

if (problems.length > 0) {
  console.error('Production compose review failed:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('Production compose reviewed: database internal, images tagged, cookie secure.');
