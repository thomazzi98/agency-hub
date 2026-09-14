import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default function globalSetup(): void {
  execFileSync(process.execPath, ['apps/api/scripts/prepare-e2e-db.mjs'], {
    cwd: rootDir,
    stdio: 'inherit',
  });
}
