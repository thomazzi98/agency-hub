import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';

/**
 * Runs the smoke test in tests/online against a site that is already up, instead of
 * starting servers and a fresh database the way playwright.config.ts does. Nothing here
 * creates or drops anything: the site under test is whatever answers at the URL.
 *
 *   E2E_ONLINE_BASE_URL=https://the-site \
 *   E2E_ONLINE_ADMIN_EMAIL=... E2E_ONLINE_ADMIN_PASSWORD=... \
 *     npx playwright test --config e2e/playwright.online.config.ts
 *
 * The account must be an agency_admin that has already changed its first password.
 * The test leaves one archived company behind, named for what it is.
 */

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadDotenv({ path: path.join(rootDir, '.env'), quiet: true });

const baseURL = process.env.E2E_ONLINE_BASE_URL;
if (!baseURL) {
  throw new Error('E2E_ONLINE_BASE_URL is not set: the address of the site to check.');
}
if (!process.env.E2E_ONLINE_ADMIN_EMAIL || !process.env.E2E_ONLINE_ADMIN_PASSWORD) {
  throw new Error('E2E_ONLINE_ADMIN_EMAIL and E2E_ONLINE_ADMIN_PASSWORD are required.');
}

export default defineConfig({
  testDir: './tests/online',
  fullyParallel: false,
  workers: 1,
  // A real network sits between the runner and the site.
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    // A certificate problem is a finding, not something to click past.
    ignoreHTTPSErrors: false,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
});
