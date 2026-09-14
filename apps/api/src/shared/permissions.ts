import { forbidden, notFound } from './errors.js';
import { isAgencyAdmin, type ActorMembership, type AuthenticatedActor } from './actor.js';

/**
 * Deny by default (06-permissions-and-authorization.md): every helper here answers
 * "is this specific action allowed for this specific company", and any unhandled
 * combination falls through to a denial rather than an allow.
 */
export function requireAgencyAdmin(actor: AuthenticatedActor): void {
  if (!isAgencyAdmin(actor)) {
    throw forbidden('forbidden', 'Apenas administradores da agência podem fazer isso.');
  }
}

export function membershipFor(
  actor: AuthenticatedActor,
  companyId: string,
): ActorMembership | undefined {
  return actor.memberships.find((membership) => membership.companyId === companyId);
}

export function hasCompanyAccess(actor: AuthenticatedActor, companyId: string): boolean {
  return isAgencyAdmin(actor) || membershipFor(actor, companyId) !== undefined;
}

/**
 * A company outside the actor's scope is reported as missing, never as forbidden:
 * a 403 would confirm that the id belongs to a real company in another tenant
 * (06-permissions-and-authorization.md#preventing-access-by-manipulating-ids-or-urls-anti-idor).
 */
export function requireCompanyAccess(actor: AuthenticatedActor, companyId: string): void {
  if (!hasCompanyAccess(actor, companyId)) {
    throw notFound('not_found', 'Empresa não encontrada.');
  }
}

/**
 * Planning the calendar and logging publications is agency work: the client side sees
 * it, it does not author it (06-permissions-and-authorization.md).
 */
export function canManageProduction(actor: AuthenticatedActor): boolean {
  return actor.role === 'agency_admin' || actor.role === 'agency_manager';
}

export function canManageCampaigns(actor: AuthenticatedActor, companyId: string): boolean {
  if (isAgencyAdmin(actor)) return true;
  if (actor.role !== 'agency_manager') return false;
  return membershipFor(actor, companyId)?.canManageCampaigns === true;
}

export function canDeleteOthersFiles(actor: AuthenticatedActor, companyId: string): boolean {
  if (isAgencyAdmin(actor)) return true;
  if (actor.role !== 'agency_manager') return false;
  return membershipFor(actor, companyId)?.canDeleteCompanyFiles === true;
}

/**
 * The set a list query must filter by. `null` means "every company", which only an
 * `agency_admin` ever gets — callers must treat it as "no `company_id` filter",
 * never as an empty set.
 */
export function authorizedCompanyIds(actor: AuthenticatedActor): string[] | null {
  return isAgencyAdmin(actor) ? null : actor.companyIds;
}
