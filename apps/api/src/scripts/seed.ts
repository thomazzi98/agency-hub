import { loadDotenv } from '../config/dotenv.js';

loadDotenv();

const { getPrismaClient, disconnectPrismaClient } = await import('../shared/db.js');
const { hashPassword, generateTemporaryPassword } = await import('../modules/auth/password.js');
const { normalizeEmail } = await import('../modules/auth/auth-service.js');

const prisma = getPrismaClient();

async function main(): Promise<void> {
  const existingAdmin = await prisma.user.findFirst({ where: { role: 'agency_admin' } });
  if (existingAdmin) {
    console.log(`An agency_admin already exists (${existingAdmin.email}); nothing to seed.`);
    return;
  }

  const email = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@agencyhub.local');
  const name = process.env.BOOTSTRAP_ADMIN_NAME ?? 'Administrador';
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim() || generateTemporaryPassword();

  const admin = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      role: 'agency_admin',
      status: 'active',
      mustChangePassword: true,
    },
  });

  await prisma.passwordResetAudit.create({
    data: { targetUserId: admin.id, action: 'temp_password_generated' },
  });

  // The only moment this value is ever readable — nothing persists it in plaintext.
  console.log('\nFirst administrator created.');
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log('\nA password change is required on first login.\n');
}

try {
  await main();
} finally {
  await disconnectPrismaClient();
}
