'use client';

import { type SpsmClaims } from '@spsm/shared';
import { useScreenGrants } from '@/lib/screenGrants';

/**
 * Whether the person reading the shop may review its orders.
 *
 * ## The bundle constraint this is built around
 *
 * This subscribes to `lib/authStore` — the module singleton the masthead already
 * maintains, which lazy-loads `firebase/auth` only when a session hint says
 * somebody is signed in — rather than importing the auth SDK itself. Same
 * reasoning as `useEventsAdmin`, which this is otherwise a copy of.
 *
 * **A correction to what that file and `lib/auth.ts` claim, measured against the
 * export build on 2026-08-23.** Both say the Firestore SDK reaches the browser
 * only on /parking. It does not: every exported page pulls in about 604KB of it,
 * /bookstore included, and that was already true before any of the bookstore
 * work. So the argument for care here is not "keep the first SDK off this page"
 * — that ship has sailed and is worth its own investigation — it is the ordinary
 * one: do not make it worse, and do not ship a back office to people buying a
 * book. Which is why the section this gates is behind two `lazy` boundaries.
 *
 * ## Two answers, not one, and the second one is a fix
 *
 * This returned a single `canReview`, and `Shop.tsx` used it to draw *both* the
 * review drawer and the Edit toggle — which was fine while the only people who
 * had one had the other. Admitting `finance` broke that: the treasurer's grant
 * is to read the takings and the orders under them, and a single flag would
 * have handed them the control that rearranges the shop's shelves and rewrites
 * its catalog. `firestore.rules` would have refused every one of those writes,
 * so the visible failure is a screenful of controls that silently do nothing.
 *
 * So the session answers the two questions separately, matching the two rules:
 *
 *   canReview  `orders` and `bookstoreStats` read — bookstore **or** finance
 *   canEdit    `products` and `config/bookstore` write — bookstore only
 *
 * ## Three ways in, and the rule this has to keep matching
 *
 * A check stricter than the policy is not caution, it is a bug that looks like
 * caution — so this asks for exactly what the `orders` and `bookstoreStats`
 * rules ask for, and all three clauses earn their place:
 *
 *   - the **group**, because a bookstore volunteer is `member` plus
 *     `groups: ['bookstore']` and nothing else. Asking for the role alone would
 *     hide the queue from the only people it was built for while the rules
 *     happily served them every document in it. This clause is why this hook was
 *     never a copy of `useEventsAdmin`.
 *   - the **bookstore screen**, new with the allocation page at /access, which
 *     is how somebody is given the shop without being given the parish.
 *   - the **finance screen**, because `hasScreen('finance')` reads the takings
 *     and the orders behind them. A treasurer who could see a day's total but
 *     not the refund that reduced it has been handed a figure they cannot
 *     check.
 *
 * `useScreenGrants` short-circuits on `superadmin` exactly as `hasScreen()`
 * does in the rules, so the parish's administrator keeps everything without a
 * lookup.
 *
 * ## Not a security boundary
 *
 * This decides what to *draw*, and on this page that matters more than usual:
 * the section it gates lists real orders with real people's names on them. It is
 * still not what protects them. `firestore.rules` refuses the `orders` read
 * outright unless the ID token carries the claim, so somebody who flips
 * `canReview` to true in their own browser gets a panel that renders "Could not
 * read the orders" and nothing else.
 */
export interface BookstoreAdminSession {
  /** True once the answer is known. Controls stay absent until then. */
  ready: boolean;
  claims: SpsmClaims | null;
  /** May they see the orders queue and the sales figures? */
  canReview: boolean;
  /**
   * May they change what the shop *is* — its shelves, sections and covers?
   *
   * Deliberately narrower than `canReview`. A treasurer reading the books is
   * not thereby someone who rearranges them.
   */
  canEdit: boolean;
}

export function useBookstoreAdmin(): BookstoreAdminSession {
  const { ready, claims, canAdmin } = useScreenGrants();

  // One grant, where this was `inGroup(claims, 'bookstore') || canAdmin(...)`.
  // The group claim and the screen flag named the same people — whoever runs
  // the shop — and every rule that read them said so with an `||`. Removing the
  // role ladder removed the groups beside it.
  const runsTheShop = canAdmin('bookstore');

  return {
    ready,
    claims,
    canReview: runsTheShop || canAdmin('finance'),
    canEdit: runsTheShop,
  };
}
