'use client';

import { useEffect, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import {
  COLLECTIONS,
  CONFIG_DOC_CAMP,
  canAdminScreen,
  canSeeFinanceSource,
  defaultCampConfig,
  parseCampConfig,
  parseFinanceScopes,
  parseScreenAdmin,
  type CampConfig,
  type SpsmClaims,
} from '@spsm/shared';
import { db } from '@/lib/firebase';
import { getServerSnapshot, getSnapshot, subscribe } from '@/lib/authStore';

/**
 * Whether the person reading the camp screens runs the camp, whether they may
 * see its money, and what the camp is set to.
 *
 * ---------------------------------------------------------------------------
 * ## Two permissions, not one, and that is the point of this file
 *
 * `canEdit` used to be `canAdminProgram(claims, grants, config.programId)` — a
 * program grant on the camp's ministry. That made "runs the camp's paperwork"
 * and "runs the camp's event pages and gallery" the same permission, because a
 * program grant is one tick over all three. It is now the `camp` screen flag,
 * and the camp's programEvents and photographs stay with the program grant
 * where every other ministry's are. The long version is on `'camp'` in
 * `packages/shared/src/screens.ts`.
 *
 * `canSeeMoney` is the second answer and a different grant again: `finance`,
 * narrowed to the `camp` source. The camp's balances, discounts and payment
 * history are the treasurer's, and a registrar taking families at a desk does
 * not need them on screen to do their job.
 *
 * **Be exact about what that second answer is.** The fees ledger is a field on
 * a `campRegistrations` document, and rules grant documents rather than fields,
 * so `camp` can read it whatever this hook says. `canSeeMoney` is therefore a
 * *preference* — it decides what the screens draw, and it is honest about the
 * one thing it cannot be, which is a wall. What is genuinely enforced is the
 * other direction: `finance` is refused `campRegistrations` outright by
 * firestore.rules, which is why `financeRollups` exists.
 *
 * ## Two reads, and why neither is optional
 *
 * Neither permission lives in the token. Grants change often enough that
 * waiting up to an hour for a refresh would be a support call every time
 * somebody is given the camp, so both `screenAdmin` and `financeScopes` are
 * fields on the member document and cost one `get` between them. `useFormsAdmin`
 * next door pays the same cost for the same reason.
 *
 * The second read is `config/camp` — the season and the fee. It is not a
 * permission, but it is needed before anything can be created (a new
 * registration copies the fee onto itself), and fetching it here means the
 * screen never opens into a state where it cannot save.
 *
 * Only the member read is behind `signed-in`; the settings are world-readable
 * and the public sign-up form needs them.
 * ---------------------------------------------------------------------------
 *
 * ## Not a security boundary
 *
 * This decides what to draw. What protects a child's medical notes is
 * `firestore.rules` refusing the query without the flag — someone who flips
 * `canEdit` in their own browser gets an empty drawer and a permission error.
 */
export interface CampAdminSession {
  /** True once both answers are known. Controls stay absent until then. */
  ready: boolean;
  claims: SpsmClaims | null;
  /** True when this person may read and write the camp's registrations. */
  canEdit: boolean;
  /**
   * True when the camp's money may be shown: totals, balances, discounts and
   * the payment history.
   *
   * `finance` narrowed to `camp`, which is nothing to do with `canEdit` — a
   * registrar has the first and not this, a treasurer has this and not the
   * first, and the two overlap only in whoever the parish gives both to. False
   * does not mean the ledger is unreachable; see the note above.
   */
  canSeeMoney: boolean;
  config: CampConfig;
  uid: string | null;
}

/**
 * `config/camp`, kept live, or the committed defaults.
 *
 * ---------------------------------------------------------------------------
 * A listener rather than a read, and that is new as of the rebuild.
 *
 * The settings are now **edited on screen** — the season, the week dates, the
 * fee and the two form switches all live on /admin/camp, and every other camp
 * screen reads this same object. A one-shot read meant closing the sign-up form
 * on the settings panel left the register, the groups board and the second
 * laptop still showing it open until somebody reloaded, which is exactly the
 * kind of quiet disagreement that ends with two people acting on different
 * facts. It is one small world-readable document.
 *
 * Allowed to fail on its own. Falling back gives a screen that says "no fee
 * set" rather than no screen at all.
 * ---------------------------------------------------------------------------
 */
function watchCampConfig(
  onChange: (config: CampConfig) => void,
): () => void {
  return onSnapshot(
    doc(db(), COLLECTIONS.config, CONFIG_DOC_CAMP),
    (snapshot) => {
      if (!snapshot.exists()) {
        console.warn(
          `[camp] ${COLLECTIONS.config}/${CONFIG_DOC_CAMP} does not exist, so there is ` +
            `no season, fee, or waiver. Create it with: npm run camp -- --write`,
        );
        onChange(defaultCampConfig());
        return;
      }
      onChange(parseCampConfig(snapshot.data()));
    },
    (error) => {
      console.warn('[camp] could not read the camp settings; using defaults', error);
      onChange(defaultCampConfig());
    },
  );
}

export function useCampAdmin(): CampAdminSession {
  const auth = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [state, setState] = useState<{
    ready: boolean;
    canEdit: boolean;
    canSeeMoney: boolean;
    config: CampConfig;
  }>({
    ready: false,
    canEdit: false,
    canSeeMoney: false,
    config: defaultCampConfig(),
  });

  const signedIn = auth.kind === 'signed-in';
  const uid = signedIn ? auth.uid : null;
  const claims = signedIn ? auth.claims : null;

  useEffect(() => {
    /*
     * A signed-out visitor reads the settings too, and that is a change.
     *
     * This used to answer `{ ready, canEdit: false, config: defaultCampConfig() }`
     * immediately for anyone signed out, on the reasoning that the config is
     * only needed to fill in a registration and nobody signed out could. Half
     * of /forms/summer-camp is now a public form — a servant signing themselves
     * up — and every one of those defaults is wrong on it:
     *
     *   season       the current calendar year, so the page offered to sign
     *                somebody up for last summer.
     *   waiverText   empty, so the waiver never appeared and nobody agreed to
     *                anything. `campServantRequest` would then refuse the
     *                sign-up for an unsigned waiver the page never showed.
     *   weeks        the default two, silently wrong on a camp that runs one.
     *   servantSignUp  true, so a closed list still showed an open form.
     *
     * `config` is world-readable — `firestore.rules` says `allow read: if true`
     * — so this costs one document and no permission. Only the *grants* read
     * below stays behind a session.
     */
    if (!signedIn || !uid) {
      if (auth.kind !== 'signed-out') return; // restoring / signing-in: unknown.
      return watchCampConfig((config) =>
        setState({ ready: true, canEdit: false, canSeeMoney: false, config }),
      );
    }

    let live = true;
    // Captured, because the narrowing above does not follow `uid` into the
    // nested function declaration below.
    const readerUid = uid;

    /*
     * The grants are answered once, on the first settings this reads, and then
     * the settings are followed without asking again.
     *
     * Nothing on `config/camp` decides either permission any more — that was
     * true of the old program grant, which was checked against `programId`, and
     * the flag is about the caller. The settings are still awaited before
     * answering so the screen opens with a season and a fee in hand rather than
     * in two paints, and re-reading the member document on every settings edit
     * would be a Firestore read per keystroke on the season field.
     */
    let answered = false;
    const stop = watchCampConfig((config) => {
      if (answered) {
        setState((previous) => ({ ...previous, config }));
        return;
      }
      answered = true;
      void grants().then(({ canEdit, canSeeMoney }) => {
        if (live) setState({ ready: true, canEdit, canSeeMoney, config });
      });
    });

    async function grants(): Promise<{ canEdit: boolean; canSeeMoney: boolean }> {
      /*
       * A superadmin's `canEdit` is answered from the token alone.
       *
       * Not merely a saving. The first admin is bootstrapped by
       * `grant-admin.mjs` and may have no member document at all — reading
       * grants they do not need would lock the person who can do everything out
       * of the one screen they went looking for.
       *
       * `canSeeMoney` still reads the document, because the finance *sources*
       * deliberately do not short-circuit on `superadmin`: they answer "which
       * part of this do you look after", and a superadmin who has unticked the
       * camp meant it. An absent map reads as all three, so a superadmin who has
       * never touched those rows sees the money exactly as before. The long
       * version is on `canSeeFinanceSource` in packages/shared/src/screens.ts.
       */
      try {
        const member = await getDoc(doc(db(), COLLECTIONS.members, readerUid));
        const screens = parseScreenAdmin(member.data()?.['screenAdmin']);
        const scopes = parseFinanceScopes(member.data()?.['financeScopes']);
        return {
          canEdit: canAdminScreen(claims, screens, 'camp'),
          canSeeMoney: canSeeFinanceSource(claims, screens, scopes, 'camp'),
        };
      } catch (error) {
        // A failed grant read is "not allowed", not "allowed by default" — with
        // the one exception the superadmin bootstrap needs.
        console.warn('[camp] could not read your grants', error);
        return {
          canEdit: claims?.superadmin === true,
          canSeeMoney: claims?.superadmin === true,
        };
      }
    }

    return () => {
      live = false;
      stop();
    };
  }, [auth.kind, signedIn, uid, claims?.superadmin]);

  return { ...state, claims, uid };
}
