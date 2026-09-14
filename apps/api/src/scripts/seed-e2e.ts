import { loadDotenv } from '../config/dotenv.js';

loadDotenv();

const { getPrismaClient, disconnectPrismaClient } = await import('../shared/db.js');
const { hashPassword } = await import('../modules/auth/password.js');

/**
 * Synthetic fixtures for the Playwright suite only — never production data
 * (docs/sdd/18-testing-strategy.md#test-data). The database-name guard below is
 * what keeps that promise enforceable rather than aspirational.
 *
 * Accounts are scoped per Playwright project because several flows mutate them
 * irreversibly (a forced password change, a revoked session); sharing one account
 * across the desktop and mobile runs would make the second run depend on the first.
 */
export const E2E_PASSWORD = 'Senha-E2E-Valida-1';
export const E2E_PROJECTS = ['desktop', 'mobile'];
export const E2E_TEMPORARY_SLOTS = [1, 2, 3];

const databaseName = new URL(process.env.DATABASE_URL ?? 'postgresql://x/none').pathname.slice(1);
if (!databaseName.includes('_e2e')) {
  throw new Error(
    `Refusing to seed E2E fixtures into "${databaseName}": the database name must contain "_e2e".`,
  );
}

const prisma = getPrismaClient();

try {
  const passwordHash = await hashPassword(E2E_PASSWORD);

  const fixtures = E2E_PROJECTS.flatMap((project) => [
    {
      email: `e2e-admin-${project}@example.com`,
      name: `Admin ${project}`,
      role: 'agency_admin' as const,
      mustChangePassword: false,
    },
    {
      email: `e2e-gestor-${project}@example.com`,
      name: `Gestor ${project}`,
      role: 'agency_manager' as const,
      mustChangePassword: false,
    },
    {
      // The campaign suite has to give a manager a company to test the
      // `can_manage_campaigns` override, which would otherwise break the
      // "manager with no company" case above the moment it ran.
      email: `e2e-gestor-campanhas-${project}@example.com`,
      name: `Gestor campanhas ${project}`,
      role: 'agency_manager' as const,
      mustChangePassword: false,
    },
    {
      // Used by the deletion-request flow, which needs someone who is *not* the
      // uploader. Kept separate so granting it a company cannot disturb the
      // "manager with no company" cases.
      email: `e2e-colab-${project}@example.com`,
      name: `Colaborador ${project}`,
      role: 'contributor' as const,
      mustChangePassword: false,
    },
    ...E2E_TEMPORARY_SLOTS.map((slot) => ({
      email: `e2e-temp-${project}-${slot}@example.com`,
      name: `Temporario ${project} ${slot}`,
      role: 'agency_manager' as const,
      mustChangePassword: true,
    })),
  ]);

  for (const fixture of fixtures) {
    await prisma.user.upsert({
      where: { email: fixture.email },
      update: {
        passwordHash,
        mustChangePassword: fixture.mustChangePassword,
        status: 'active',
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
      create: { ...fixture, passwordHash, status: 'active' },
    });
  }

  console.log(`Seeded ${fixtures.length} E2E users into ${databaseName}.`);
} finally {
  await disconnectPrismaClient();
}
