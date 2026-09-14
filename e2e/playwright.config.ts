import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadDotenv({ path: path.join(rootDir, '.env'), quiet: true });

// Dedicated ports so a running development stack never collides with a test run.
const API_PORT = Number(process.env.E2E_API_PORT ?? 3101);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5273);

const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('E2E_DATABASE_URL is not set. Copy .env.example to .env.');
}

export default defineConfig({
  testDir: './tests',
  // The database is prepared by the `test:e2e` script rather than a globalSetup hook,
  // because Playwright starts `webServer` first and the API now verifies its database
  // role at boot.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // The product is mobile-first (docs/sdd/12-ui-ux-guidelines.md), so every flow
    // is proven on a phone viewport rather than only assumed to reflow.
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],

  webServer: [
    {
      command: 'npm run start:e2e --workspace=@agency-hub/api',
      cwd: rootDir,
      port: API_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        API_PORT: String(API_PORT),
        DATABASE_URL: databaseUrl,
        SESSION_COOKIE_SECURE: 'false',
        // Every browser in this suite shares one loopback address, so the per-IP
        // login limit would trip partway through a run. The limit itself is proven
        // by the integration suite, which controls the source IP per case.
        LOGIN_IP_MAX_ATTEMPTS_PER_HOUR: '10000',
        // The S3 multipart minimum, so a ~6 MiB fixture genuinely exercises chunking
        // instead of needing 32 MiB of test bytes to cross a 16 MiB part size.
        UPLOAD_PART_SIZE_BYTES: String(5 * 1024 * 1024),
        STORAGE_BUCKET: process.env.E2E_STORAGE_BUCKET ?? 'agency-hub-e2e',
      },
    },
    {
      command: 'npm run dev --workspace=@agency-hub/web',
      cwd: rootDir,
      port: WEB_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        WEB_PORT: String(WEB_PORT),
        VITE_API_URL: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
