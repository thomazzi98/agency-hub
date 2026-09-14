import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * The repository keeps a single root `.env` shared by every workspace. Loading is
 * a no-op when the file is absent (containers and CI inject real environment
 * variables), and never overrides variables already present in the environment.
 */
export function loadDotenv(): void {
  config({ path: path.resolve(moduleDir, '../../../../.env'), quiet: true });
}
