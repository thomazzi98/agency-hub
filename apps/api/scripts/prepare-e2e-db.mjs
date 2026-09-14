#!/usr/bin/env node
/**
 * Recreates the Playwright database from scratch, migrates it, and loads the
 * synthetic fixtures. Run by the E2E global setup so each suite starts from a
 * known state instead of inheriting whatever the previous run left behind.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config as loadDotenv } from 'dotenv';

const require = createRequire(import.meta.url);
const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

loadDotenv({ path: path.resolve(apiDir, '../../.env'), quiet: true });

const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('E2E_DATABASE_URL is not set. Copy .env.example to .env.');
}

const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
if (!databaseName.includes('_e2e')) {
  throw new Error(`Refusing to drop "${databaseName}": an E2E database name must contain "_e2e".`);
}

function maintenanceConnectionString() {
  const url = new URL(databaseUrl);
  url.pathname = '/postgres';
  url.search = '';
  return url.toString();
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: apiDir,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} ${args.join(' ')} exited with ${result.status}`);
  }
}

function binPath(packageName, binName) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const bin = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin[binName];
  return path.join(path.dirname(packageJsonPath), bin);
}

const client = new pg.Client({ connectionString: maintenanceConnectionString() });
await client.connect();
try {
  await client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${databaseName}"`);
} finally {
  await client.end();
}

run(process.execPath, [binPath('prisma', 'prisma'), 'migrate', 'deploy'], {
  DATABASE_URL: databaseUrl,
});
run(process.execPath, [binPath('tsx', 'tsx'), 'src/scripts/seed-e2e.ts'], {
  DATABASE_URL: databaseUrl,
});

console.log(`E2E database "${databaseName}" is ready.`);
