/**
 * Who is calling an HTTP Function, established from their ID token.
 *
 * ---------------------------------------------------------------------------
 * Why this is not `firestore.rules`.
 *
 * Every other authorization decision on this site is a rule, because every
 * other privileged action is a Firestore write and rules are the actual policy.
 * A refund is not: it is a call to Square, made by the Admin SDK, which bypasses
 * rules entirely. There is nothing for a rule to guard, so the check has to
 * happen at the door of the Function — and the door has to be locked in code
 * that looks nothing like the rest of the codebase's authorization, which is
 * exactly why it is in a file of its own with this comment on it.
 *
 * The claims read here are the same two axes as roles.ts: `role` is a linear
 * tier, `groups` are cross-cutting capabilities. They come out of the verified
 * ID token, never out of a Firestore document — a member who could grant
 * themselves `staff` by editing their own profile would be able to refund
 * orders to their own card.
 * ---------------------------------------------------------------------------
 */
import { getAuth } from 'firebase-admin/auth';
import type { Request } from 'firebase-functions/v2/https';
import { type Group, type Role } from '@spsm/shared';

export interface Caller {
  uid: string;
  email: string;
  role: Role;
  groups: Group[];
}

const RANK: Record<Role, number> = { member: 0, servant: 1, staff: 2, admin: 3 };

/**
 * Verify the `Authorization: Bearer` header, or return null.
 *
 * `checkRevoked: true`, and it is worth the extra read. The default only
 * verifies the signature and expiry, so a token minted before someone was
 * removed from the parish tenant keeps working for up to an hour. An hour is a
 * long time to be able to refund orders after being let go.
 */
export async function callerOf(req: Request): Promise<Caller | null> {
  const header = String(req.headers.authorization ?? '');
  const match = /^Bearer (.+)$/.exec(header.trim());
  if (!match?.[1]) return null;

  try {
    const decoded = await getAuth().verifyIdToken(match[1], true);
    const role = (decoded['role'] as Role) ?? 'member';
    const groups = Array.isArray(decoded['groups']) ? (decoded['groups'] as Group[]) : [];
    return {
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email : '',
      role: role in RANK ? role : 'member',
      groups,
    };
  } catch (error) {
    // A bad token is a 401, not a 500. Logged at info because an expired token
    // in a tab left open overnight is ordinary, not a fault.
    console.info('[auth] rejected an ID token:', (error as { code?: string })?.code ?? error);
    return null;
  }
}

export function hasRole(caller: Caller | null, role: Role): boolean {
  return caller != null && RANK[caller.role] >= RANK[role];
}

export function inGroup(caller: Caller | null, group: Group): boolean {
  return caller != null && caller.groups.includes(group);
}

/** Mirrors the `orders` rule: bookstore volunteers, or anyone staff and above. */
export function mayManageOrders(caller: Caller | null): boolean {
  return inGroup(caller, 'bookstore') || hasRole(caller, 'staff');
}
