'use client';

import { FINANCE_SOURCES, type FinanceSource, type SpsmClaims } from '@spsm/shared';
import { useScreenGrants } from '@/lib/screenGrants';

/**
 * Whether the person reading may see the parish's money.
 *
 * ---------------------------------------------------------------------------
 * One question, asked exactly the way `firestore.rules` asks it.
 *
 * The rule on `bookstoreStats` and `financeRollups` is `hasFinance(source)`,
 * which is `isSuper() || (screenFlag('finance') && that source)` — and
 * `canSeeFinanceSource` is that same pair, which is why this hook is a filter
 * over `FINANCE_SOURCES` and nothing more. It was `hasScreen('finance')` alone
 * on both until the grant could be narrowed.
 *
 * It has to stay that pair. A check stricter than the policy hides the screen
 * from somebody Firestore is already serving, and it fails invisibly: nothing
 * errors, the door is simply not drawn. A check looser than it draws a report
 * whose every read is refused. There is no third axis to add here — the tier
 * and the groups that used to sit beside this are gone, and an allocation is
 * now the whole of what opens anything.
 *
 * ## Not a security boundary
 *
 * This decides what to draw. What keeps a treasurer's figures away from the
 * parish is the rule, which does its own `get()` of the same grant map;
 * somebody who flips this in their own browser gets a screen that reads "could
 * not read the figures" and nothing else.
 * ---------------------------------------------------------------------------
 */
export interface FinanceSession {
  /** True once the answer is known. Nothing should be drawn before it. */
  ready: boolean;
  claims: SpsmClaims | null;
  /** Holds the finance grant. Says nothing about which sources. */
  canView: boolean;
  /**
   * Which of the three sources this person may see, in a stable order.
   *
   * Empty for somebody without the grant, and empty for somebody who has it
   * with every source unticked — which is a real allocation an administrator
   * can make, and the screen has to say so rather than render three zeroes.
   */
  sources: FinanceSource[];
  can: (source: FinanceSource) => boolean;
}

/**
 * The grant, and the sources under it.
 *
 * ---------------------------------------------------------------------------
 * `canView` was the whole of this hook, and it is now the coarser half.
 *
 * `finance` is one flag onto three collections, and a parish that wants the
 * bookkeeper to see the shop and not the children's camp fees had no way to say
 * so. `financeScopes` on the member document is that sentence — see
 * `FINANCE_SOURCES` in packages/shared/src/screens.ts — and `hasFinance()` in
 * firestore.rules is `canSeeFinanceSource` said in rules.
 *
 * Which means the pairing this file has always insisted on now has to hold
 * per-source, not just per-flag: a screen that renders a section the rules
 * refuse shows a treasurer an error where a figure should be, and one that
 * hides a section the rules would serve loses somebody a report with no
 * message at all. `sources` is what every section below is drawn from, for
 * exactly that reason.
 * ---------------------------------------------------------------------------
 */
export function useFinanceAdmin(): FinanceSession {
  const { ready, claims, canAdmin, canSeeFinance } = useScreenGrants();
  return {
    ready,
    claims,
    canView: canAdmin('finance'),
    sources: FINANCE_SOURCES.filter((source) => canSeeFinance(source)),
    can: canSeeFinance,
  };
}
