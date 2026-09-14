import type { TestInfo } from '@playwright/test';

/** Mirrors apps/api/src/scripts/seed-e2e.ts — synthetic fixtures, never real data. */
export const E2E_PASSWORD = 'Senha-E2E-Valida-1';

export interface FixtureUser {
  email: string;
  name: string;
}

/**
 * Accounts are per Playwright project: several flows mutate them irreversibly, so
 * sharing one between the desktop and mobile runs would make the second depend on
 * the first having not run yet.
 */
export function admin(testInfo: TestInfo): FixtureUser {
  const project = testInfo.project.name;
  return { email: `e2e-admin-${project}@example.com`, name: `Admin ${project}` };
}

export function manager(testInfo: TestInfo): FixtureUser {
  const project = testInfo.project.name;
  return { email: `e2e-gestor-${project}@example.com`, name: `Gestor ${project}` };
}

export function temporaryUser(testInfo: TestInfo, slot: 1 | 2 | 3): FixtureUser {
  const project = testInfo.project.name;
  return {
    email: `e2e-temp-${project}-${slot}@example.com`,
    name: `Temporario ${project} ${slot}`,
  };
}
