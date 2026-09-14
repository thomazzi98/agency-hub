import type { Prisma, PrismaClient, UserRole } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export interface ActorMembership {
  companyId: string;
  canManageCampaigns: boolean;
  canDeleteCompanyFiles: boolean;
}

export interface AuthenticatedActor {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  mustChangePassword: boolean;
  sessionId: string;
  memberships: ActorMembership[];
  /**
   * Companies reachable through an active membership. Empty for an `agency_admin`,
   * whose access is role-derived and must be checked with `isAgencyAdmin` rather
   * than by inspecting this list.
   */
  companyIds: string[];
}

export function isAgencyAdmin(actor: AuthenticatedActor): boolean {
  return actor.role === 'agency_admin';
}

export async function loadActor(
  db: Db,
  userId: string,
  sessionId: string,
): Promise<AuthenticatedActor | null> {
  const user = await db.user.findFirst({
    where: { id: userId, status: 'active' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      mustChangePassword: true,
      memberships: {
        where: { status: 'active' },
        select: { companyId: true, canManageCampaigns: true, canDeleteCompanyFiles: true },
      },
    },
  });

  if (!user) return null;

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    sessionId,
    memberships: user.memberships,
    companyIds: user.memberships.map((membership) => membership.companyId),
  };
}
