'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  canAdminScreen,
  financeSourcesFor,
  parseFinanceScopes,
  parseScreenAdmin,
  type FinanceScopes,
  type FinanceSource,
} from '@spsm/shared';
import { db } from '@/lib/firebase';
import { getServerSnapshot, getSnapshot, subscribe } from '@/lib/authStore';

/**
 * The admin screen's contents, and who may see them.
 *
 * ---------------------------------------------------------------------------
 * There is a section on this site now, and that reverses a decision.
 *
 * `/admin` was deleted once, deliberately: editing belongs on the page being
 * edited, reached by an Edit control that appears for whoever may use it, and a
 * separate back-office section is how a site ends up with two ways to change
 * everything. That argument still holds and this does not weaken it — nothing
 * that can be edited in place has moved here, and nothing should.
 *
 * What is here is the other kind of screen: work that is not *about* a page.
 * Arranging four hundred children into groups is not an edit to /forms/summer-camp
 * or to anything else a visitor can see; it is a task with its own tools that
 * happens to use the camp's data. There was nowhere to put that, and inventing a
 * fourth tab on the registration form to hold a full-width drag-and-drop board
 * would have been the wrong shape for both.
 *
 * ## Why a list rather than a hardcoded link
 *
 * Because the account menu has to know whether to show the entry at all, and
 * "does this person have anything in the admin screen" is a question with a
 * different answer per person. One list, computed once, read by the menu and by
 * the screen itself, is what stops the menu offering a door onto an empty room.
 *
 * ## Not a security boundary
 *
 * This decides what to draw. Every screen behind it is refused by
 * `firestore.rules` on its own terms — someone who flips a boolean in their own
 * browser gets an empty board and a permission error.
 * ---------------------------------------------------------------------------
 */
export interface AdminSection {
  href: string;
  title: string;
  /** One sentence, in the same voice as the rest of the site: what the screen
      is for, not why it is exciting. */
  blurb: string;
  /**
   * What the account menu calls it, when this is the only section somebody has
   * and the menu links straight to it.
   *
   * Separate from `title` because the two are read in different places. A card
   * on the hub can say "Summer camp allocation"; a row in a dropdown beside
   * "Sign out" has about twelve characters before it starts wrapping.
   */
  menuLabel: string;
  /**
   * Which mark the account-menu row draws.
   *
   * Presentation, in a file that is otherwise about permissions — and it earns
   * its place here for the same reason `title` does: this module owns the
   * question "what are this person's sections", and the alternative is
   * `HeaderAuth` matching on `href`, which is a second list to keep in step.
   */
  glyph: 'camp' | 'finance';
}

/**
 * Whether the camp's screens are offered in the account menu and on /admin.
 *
 * ---------------------------------------------------------------------------
 * **Back on as of 2 Sep 2026**, with the camp rebuilt around a single
 * /admin/camp page. It was switched off on 1 Sep and nothing was deleted; this
 * is that one word changed back.
 *
 * The switch stays for the same reason the matching one in
 * `features/forms/FormsHub.tsx` does: the camp runs for two weeks a year, and a
 * menu advertising it in February is advertising something that is not
 * happening. Turning it off never closes the door — anybody holding the address
 * still reaches the screen, and `firestore.rules` is what decides whether they
 * see anything when they do.
 * ---------------------------------------------------------------------------
 */
const SHOW_CAMP: boolean = true;

export interface AdminAccess {
  /** True once the answer is known. Nothing should be drawn before it. */
  ready: boolean;
  sections: AdminSection[];
}

/**
 * Answers, kept for the life of the page, keyed by uid.
 *
 * The account menu asks this every time it is opened, and the answer costs two
 * Firestore reads. Without a cache, a signed-in member who opens the menu six
 * times pays for twelve reads to be told the same thing — and each of them is a
 * round trip that has to land before the Admin entry can appear, so the menu
 * visibly changes shape a beat after opening, every time.
 *
 * Deliberately not persisted anywhere. A grant given while somebody is on the
 * site should reach them on their next page load, not on their next browser.
 */
const answered = new Map<string, AdminSection[]>();

/**
 * What this person may reach in the admin screen.
 *
 * `enabled` exists so the account menu can ask nothing at all until it is
 * opened. Every page on the site renders the header, and two Firestore reads
 * per page load, for every signed-in visitor, to decide whether to draw one
 * line in a menu most of them never open, is not a trade worth making.
 */
export function useAdminAccess(enabled = true): AdminAccess {
  const auth = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const uid = auth.kind === 'signed-in' ? auth.uid : null;
  const superadmin = auth.kind === 'signed-in' && auth.claims.superadmin;

  const [state, setState] = useState<AdminAccess>(() =>
    uid && answered.has(uid) ? { ready: true, sections: answered.get(uid)! } : { ready: false, sections: [] },
  );

  useEffect(() => {
    if (!enabled) return;

    if (!uid) {
      setState({ ready: true, sections: [] });
      return;
    }

    const cached = answered.get(uid);
    if (cached) {
      setState({ ready: true, sections: cached });
      return;
    }

    let live = true;

    void (async () => {
      const sections: AdminSection[] = [];

      try {
        /*
         * Claims read from the store here rather than taken from the render's
         * `auth`, so this effect can depend on the uid and the one claim alone.
         * The auth object is rebuilt on every emission — including the hourly
         * token refresh — and depending on it would restart this read each time.
         */
        const now = getSnapshot();
        const claims = now.kind === 'signed-in' ? now.claims : null;

        /*
         * One member read, every axis — and it is not skipped for a superadmin.
         *
         * It used to be: a superadmin was answered from the token alone,
         * because `canAdminScreen` short-circuits on the claim and the first
         * administrator may have no member document at all. That still holds for
         * the flags, and they still short-circuit below. It does not hold for
         * `financeScopes`, which is not a permission a superadmin already has
         * but a statement of which part of the money they look after — and
         * skipping the read made the one person who can set it the one person it
         * did not apply to.
         *
         * The program grants used to be parsed here too, for the camp row. Every
         * row on this menu is a screen flag now.
         *
         * A missing document is an ordinary answer here: every parser reads
         * `undefined` as its default, which is no screens and all three sources.
         * The claim does the rest.
         */
        const member = await getDoc(doc(db(), COLLECTIONS.members, uid));
        const screens = parseScreenAdmin(member.data()?.['screenAdmin']);
        // An absent map reads as all three — see `FINANCE_SOURCES` in
        // shared/screens.ts.
        const money: FinanceScopes = parseFinanceScopes(member.data()?.['financeScopes']);
        /*
         * The camp is a screen flag as of 2 Sep 2026, and this row is where the
         * change is most visible.
         *
         * It was `canAdminProgram(claims, grants, config.programId)`, which
         * meant this menu row appeared for whoever ran the camp *as a ministry*
         * — the person posting the week's photographs — and the screen behind it
         * held children's medical notes. It is `camp` now, and the ministry
         * grant draws no row here at all, because a program grant's screens are
         * the gallery and the event page and both are edited in place.
         *
         * That deleted a read: this used to fetch `config/camp` for one field,
         * the ministry the grant was checked against. Nothing on that document
         * decides a permission any more.
         */
        if (SHOW_CAMP && canAdminScreen(claims, screens, 'camp')) {
          sections.push({
            href: '/admin/camp',
            title: 'Summer camp',
            menuLabel: 'Summer camp',
            glyph: 'camp',
            blurb:
              'Registrations, groups and the daily register, with the season, the week ' +
              'dates, the fee and the two forms\u2019 switches.',
          });
        }

        /*
         * Finance.
         *
         * The second screen of this kind, and it belongs here for the same
         * reason the first one does: there is no page on this site whose
         * contents are "what the church took in August", so there is nowhere
         * in-place for it to live.
         *
         * `financeSourcesFor` is `hasFinance()` in firestore.rules said in
         * TypeScript — a superadmin, or somebody entrusted with the money and
         * with at least one part of it left ticked. Keeping the two in step is
         * the whole job of this line: a stricter check here hides a screen
         * Firestore would happily serve, and a looser one draws a door onto a
         * permission error.
         *
         * It is the sources and not the bare flag, and that difference matters
         * more here than anywhere else.
         *
         * The flag can now be narrowed to the shop, the camp or the paid forms
         * — see `FINANCE_SOURCES` in packages/shared/src/screens.ts — and
         * somebody holding it with every source unticked has a door onto a
         * screen that can only tell them nothing has been opened to them. That
         * is precisely the "door onto an empty room" this whole list exists to
         * prevent, so the row is drawn from what they can actually see rather
         * than from the flag that would let them see it.
         */
        const mine = financeSourcesFor(claims, screens, money);
        if (mine.length > 0) {
          sections.push({
            href: '/admin/finance',
            title: 'Finance',
            menuLabel: 'Finance',
            glyph: 'finance',
            /*
             * Assembled from the sources held, not written out.
             *
             * The card on /admin is the one place outside the screen itself that
             * describes what Finance contains, and a fixed sentence naming the
             * bookstore, the camp and the paid forms would tell somebody given
             * one of them what the other two are. The screen is careful about
             * this throughout — see `FinanceBody` — and the door onto it has to
             * be as careful, or the care is decorative.
             */
            blurb:
              `What ${financeBlurbList(mine)} ${mine.length === 1 ? 'has' : 'have'} taken, ` +
              'and what is still owed. Figures only — nothing here changes a record.',
          });
        }
      } catch {
        // A failed grant read is "nothing", not "everything". The screens behind
        // these links would refuse the data anyway.
      }

      if (!live) return;
      answered.set(uid, sections);
      setState({ ready: true, sections });
    })();

    return () => {
      live = false;
    };
  }, [enabled, uid, superadmin]);

  return state;
}

/**
 * The rows the account panel draws: one per section, and no hub row.
 *
 * ---------------------------------------------------------------------------
 * There was an `adminDoor()` here that collapsed this to a single row — the
 * screen's own name when somebody had one section, and "Admin" pointing at
 * /admin when they had two. **At Tommy's direction the panel now lists both.**
 *
 * Which is the same argument the collapse was built on, followed one step
 * further. The reason the row said "Summer camp" rather than "Admin" while
 * there was one screen was that *a hub whose entire content is the link you
 * just clicked is a page nobody wants*. With two screens and two rows in the
 * panel, that is true twice over: somebody holding both would click "Admin" to
 * be shown the two links they were already looking at.
 *
 * The people this affects are the ones who use these every day — the camp
 * administrator in August, the treasurer after a Sunday — so a click saved is
 * worth more than the tidiness of one row.
 *
 * **The /admin hub still exists and still works.** It is simply not linked here
 * any more: it renders the same cards with their blurbs, which is the better
 * page for somebody arriving cold or from a bookmark, and `AdminScreen`
 * already handles "you have nothing here". If a third and fourth screen ever
 * land, a hub row is the right answer again and this is the function to bring
 * back.
 *
 * Living here rather than in `HeaderAuth` because this module owns the address,
 * the label and the question of who may reach it. The menu once hardcoded the
 * word "Summer camp" beside a href, which was true while there was one section
 * and would have labelled the treasurer's row "Summer camp" the moment there
 * were two.
 * ---------------------------------------------------------------------------
 */
/**
 * "the bookstore and the paid forms" — the sources somebody holds, as English.
 *
 * Deliberately not shared with the screen's own `listOf`: that one lives in a
 * client component this module must not pull into every page's bundle, and two
 * short list builders are cheaper than the import that would join them.
 */
function financeBlurbList(sources: readonly FinanceSource[]): string {
  const names = sources.map((source) =>
    source === 'bookstore' ? 'the bookstore' : source === 'camp' ? 'the summer camp' : 'the paid forms',
  );
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function adminRows(access: AdminAccess): AdminSection[] {
  return access.ready ? access.sections : [];
}
