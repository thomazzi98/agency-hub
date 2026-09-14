import { unprocessable } from './errors.js';
import type { ScopedDb } from './tenant-scope.js';

/**
 * A person can only be made responsible for something in a company they can actually
 * reach — an `agency_admin` reaches every company, everyone else needs an active
 * membership (06-permissions-and-authorization.md#company-membership--permission-overrides).
 *
 * Checked on the server for the same reason every other scope check is: the client
 * picks the id, so the client cannot be the one deciding the id is allowed.
 */
export async function assertResponsibleHasAccess(
  tx: ScopedDb,
  companyId: string,
  userId: string,
): Promise<void> {
  const membership = await tx.companyMembership.findFirst({
    where: { userId, companyId, status: 'active' },
    select: { id: true },
  });
  if (membership) return;

  const admin = await tx.user.findFirst({
    where: { id: userId, role: 'agency_admin', status: 'active' },
    select: { id: true },
  });
  if (admin) return;

  throw unprocessable(
    'responsible_without_access',
    'O responsável escolhido não tem acesso a esta empresa.',
  );
}
