#!/usr/bin/env node
/**
 * The Prisma CLI only auto-loads `.env` from the schema directory or the current
 * working directory, but this repository keeps a single `.env` at the workspace
 * root. This wrapper loads that file and then hands off to the real CLI, so every
 * `db:*` script behaves the same locally, in CI, and in the container.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const require = createRequire(import.meta.url);
const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

loadDotenv({ path: path.resolve(apiDir, '../../.env'), quiet: true });

const packageJsonPath = require.resolve('prisma/package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const binRelative = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin.prisma;

const result = spawnSync(
  process.execPath,
  [path.join(path.dirname(packageJsonPath), binRelative), ...process.argv.slice(2)],
  { cwd: apiDir, stdio: 'inherit' },
);

process.exit(result.status ?? 1);
