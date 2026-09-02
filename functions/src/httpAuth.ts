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
 * ## What changed when the role ladder went
 *
 * This file used to answer everything from the token: `role` was a claim, so
 * `hasRole(caller, 'staff')` was free and synchronous. There is no role now.
 * The one claim left is `superadmin`, and every other privilege is a flag in
 * the `screenAdmin` map on the member document — which means **every check here
 * is a Firestore read and every check here is async.** `mayReadFinance` was
 * already in that shape for exactly this reason; the rest have joined it.
 *
 * That is one billed read per privileged call, on calls that are already
 * talking to Square over the network. It buys the property the whole change is
 * for: this file and `firestore.rules` decide from the same map, so a grant
 * made at /access cannot work in one and be refused by the other.
 *
 * **Do not read the `screens` claim here to avoid the read.** That claim exists
 * for `storage.rules`, which cannot reach Firestore; it lags by up to a token
 * refresh, and a Function that trusted it would refuse somebody for an hour
 * after they were granted the area — or, worse, admit them for an hour after
 * they were removed from it. The document is the fact.
 * ---------------------------------------------------------------------------
 */
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { Request } from 'firebase-functions/v2/https';
import { COLLECTIONS, type AdminScreen } from '@spsm/shared';

export interface Caller {
  uid: string;
  email: string;
  /** The parish's site administrator. Everything else is an allocation. */
  superadmin: boolean;
}

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
    return {
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email : '',
      superadmin: decoded['superadmin'] === true,
    };
  } catch (error) {
    // A bad token is a 401, not a 500. Logged at info because an expired token
    // in a tab left open overnight is ordinary, not a fault.
    console.info('[auth] rejected an ID token:', (error as { code?: string })?.code ?? error);
    return null;
  }
}

/**
 * Mirrors `hasScreen()` in firestore.rules: the superadmin, or the person given
 * this area at /access.
 *
 * The single authorization predicate in this file, and everything below is a
 * named call to it. Async, and it has to be — the grant is a field on a
 * Firestore document rather than a claim, for the reasons in the header above.
 * Await it; a forgotten `await` here is a truthy Promise and an open door.
 *
 * The superadmin short-circuits before the read, which is not only a saving:
 * the parish's first administrator is bootstrapped by `grant-admin.mjs` and may
 * have no member document at all.
 */
export async function mayAdminScreen(
  caller: Caller | null,
  screen: AdminScreen,
): Promise<boolean> {
  if (!caller) return false;
  if (caller.superadmin) return true;

  const snapshot = await getFirestore().collection(COLLECTIONS.members).doc(caller.uid).get();
  return snapshot.get(`screenAdmin.${screen}`) === true;
}

/**
 * Mirrors the `orders` and `products` rules: whoever runs the shop.
 *
 * This was `inGroup(caller, 'bookstore') || hasRole(caller, 'staff')`. The
 * group and the flag named the same people and the tier named everybody, so
 * both collapsed into the one grant /access actually hands out.
 */
export function mayManageOrders(caller: Caller | null): Promise<boolean> {
  return mayAdminScreen(caller, 'bookstore');
}

/**
 * Mirrors `hasScreen('finance')` in firestore.rules: the treasurer.
 *
 * Deliberately not `mayManageOrders`. The shop's volunteer packs parcels and
 * the treasurer reconciles takings, and /access offers them as two rows because
 * they are two jobs.
 */
export function mayReadFinance(caller: Caller | null): Promise<boolean> {
  return mayAdminScreen(caller, 'finance');
}
