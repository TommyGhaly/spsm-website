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

export const GROUPS = ['clergy', 'prayerTeam', 'bookstore', 'parking'] as const;
export type Group = (typeof GROUPS)[number];

/** Shape of the custom claims block we set via the Admin SDK. */
export interface SpsmClaims {
  role: Role;
  groups?: Group[];
}

/** Anyone not explicitly provisioned is a plain member. */
export const DEFAULT_CLAIMS: SpsmClaims = { role: 'member' };

export function hasRole(claims: SpsmClaims | null, atLeast: Role): boolean {
  if (!claims) return false;
  return ROLE_RANK[claims.role] >= ROLE_RANK[atLeast];
}

export function inGroup(claims: SpsmClaims | null, group: Group): boolean {
  return claims?.groups?.includes(group) ?? false;
}

/**
 * Prayer requests marked clergy-only are readable by clergy and admins.
 * Staff tier alone is not enough — a facilities coordinator has no business
 * reading them.
 */
export function canReadPrivatePrayerRequests(claims: SpsmClaims | null): boolean {
  return inGroup(claims, 'clergy') || hasRole(claims, 'admin');
}

export function isKnownRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
