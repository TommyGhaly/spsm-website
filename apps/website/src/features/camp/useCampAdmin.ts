'use client';

import { useEffect, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import {
  COLLECTIONS,
  CONFIG_DOC_CAMP,
  canAdminProgram,
  defaultCampConfig,
  parseCampConfig,
  parseProgramAdmin,
  type CampConfig,
  type SpsmClaims,
} from '@spsm/shared';
import { db } from '@/lib/firebase';
import { getServerSnapshot, getSnapshot, subscribe } from '@/lib/authStore';

/**
 * Whether the person reading /forms runs the camp, and what the camp is set to.
 *
 * ---------------------------------------------------------------------------
 * Two reads, and why neither is optional.
 *
 * The permission this asks about is a **program grant**, and those deliberately
 * do not live in the token. `programAdmin.ts` says why: grants change often
 * enough that waiting up to an hour for a token refresh would be a support call
 * every time somebody is given the camp. They live on the member document
 * instead, and reading them costs one `get`. `useFormsAdmin` next door pays the
 * same cost for the same reason — since the role ladder went, every permission
 * on this site except `superadmin` is a field on that document.
 *
 * The second read is `config/camp` — the season and the fee. It is not a
 * permission, but it is needed before anything can be created (a new
 * registration copies the fee onto itself), and fetching it here means the
 * screen never opens into a state where it cannot save.
 *
 * Both are behind `signed-in`, so a visitor triggers neither. Nothing is read
 * until somebody with a session is actually on the page.
 * ---------------------------------------------------------------------------
 *
 * ## Not a security boundary
 *
 * This decides what to draw. What protects a child's medical notes is
 * `firestore.rules` refusing the query without the grant — someone who flips
 * `canEdit` in their own browser gets an empty drawer and a permission error.
 */
export interface CampAdminSession {
  /** True once both answers are known. Controls stay absent until then. */
  ready: boolean;
  claims: SpsmClaims | null;
  /** True when this person may read and write the camp's registrations. */
  canEdit: boolean;
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
  const [state, setState] = useState<{ ready: boolean; canEdit: boolean; config: CampConfig }>({
    ready: false,
    canEdit: false,
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
      return watchCampConfig((config) => setState({ ready: true, canEdit: false, config }));
    }

    let live = true;
    // Captured, because the narrowing above does not follow `uid` into the
    // nested function declaration below.
    const readerUid = uid;

    /*
     * The grant is answered once against the *first* settings this reads, and
     * then followed.
     *
     * `programId` is what the grant is checked against, and it is the one key
     * on this document a camp administrator may not write — so it cannot change
     * under somebody mid-session except by a superadmin's hand, and re-running
     * the member read on every settings edit would be a Firestore read per
     * keystroke on the season field.
     */
    let answered = false;
    const stop = watchCampConfig((config) => {
      if (answered) {
        setState((previous) => ({ ...previous, config }));
        return;
      }
      answered = true;
      void grantFor(config).then((canEdit) => {
        if (live) setState({ ready: true, canEdit, config });
      });
    });

    async function grantFor(config: CampConfig): Promise<boolean> {
      let canEdit = false;
      try {
        /*
         * A superadmin is answered from the token alone.
         *
         * Not merely a saving. The first admin is bootstrapped by
         * `grant-admin.mjs` and may have no member document at all — reading
         * grants they do not need would lock the person who can do everything
         * out of the one screen they went looking for.
         */
        if (claims?.superadmin === true) {
          canEdit = true;
        } else {
          const member = await getDoc(doc(db(), COLLECTIONS.members, readerUid));
          const grants = parseProgramAdmin(member.data()?.['programAdmin']);
          canEdit = canAdminProgram(claims, grants, config.programId);
        }
      } catch (error) {
        // A failed grant read is "not allowed", not "allowed by default".
        console.warn('[camp] could not read your program grants', error);
      }

      return canEdit;
    }

    return () => {
      live = false;
      stop();
    };
  }, [auth.kind, signedIn, uid, claims?.superadmin]);

  return { ...state, claims, uid };
}
