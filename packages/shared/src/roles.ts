/**
 * Authorization model.
 *
 * Two independent axes, deliberately kept separate:
 *
 *  - `role`  — a linear tier. Higher tiers inherit everything below them.
 *              Answers "how much of the parish's administrative surface can
 *              this person see?"
 *  - `groups` — cross-cutting capabilities that don't nest. Clergy are not
 *               "more staff than staff"; they simply have a different key.
 *               Answers "what specific responsibility does this person hold?"
 *
 * Both live in Firebase Auth custom claims and are enforced in
 * `firestore.rules`. Client-side checks using these helpers are for hiding UI
 * only — never treat them as security.
 */

export const ROLES = ['member', 'servant', 'staff', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** Higher rank ⇒ strictly more access. Used by `hasRole`. */
const ROLE_RANK: Record<Role, number> = {
  member: 0,
  servant: 1,
  staff: 2,
  admin: 3,
};

export const GROUPS = ['clergy', 'bookstore', 'parking'] as const;
export type Group = (typeof GROUPS)[number];

/** Shape of the custom claims block we set via the Admin SDK. */
export interface SpsmClaims {
  role: Role;
  groups?: Group[];
}

/**
 * What an unauthenticated visitor effectively is. Kept as the floor of the
 * ladder because `firestore.rules` reads `claims().get('role','member')` for
 * anyone without an explicit claim.
 *
 * In practice no signed-in person holds it — see `DEFAULT_SIGNIN_ROLE`.
 */
export const DEFAULT_CLAIMS: SpsmClaims = { role: 'member' };

/**
 * What a first successful sign-in grants.
 *
 * Sign-in is Microsoft-only and restricted to the parish's Entra tenant, so
 * *being able to authenticate at all* is the qualification: a parishioner has
 * no account, and only clergy, staff, and servants have a parish M365 address.
 * Tenant membership is therefore the gate, and `servant` is what it opens.
 *
 * The consequence to keep in view: this makes the Entra app registration a
 * security control rather than a convenience. If it is ever switched from
 * single-tenant to multi-tenant, any Microsoft account on earth becomes a
 * servant. `beforeUserCreated` in functions/src/auth.ts re-checks the tenant
 * for exactly that reason.
 *
 * `staff` and `admin` are never granted automatically — they come from
 * `setMemberRole`, deliberately, per person.
 */
export const DEFAULT_SIGNIN_ROLE: Role = 'servant';

export function hasRole(claims: SpsmClaims | null, atLeast: Role): boolean {
  if (!claims) return false;
  return ROLE_RANK[claims.role] >= ROLE_RANK[atLeast];
}

export function inGroup(claims: SpsmClaims | null, group: Group): boolean {
  return claims?.groups?.includes(group) ?? false;
}

export function isKnownRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
