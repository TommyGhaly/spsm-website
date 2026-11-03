'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { COLLECTIONS, canAdminScreen, parseScreenAdmin } from '@spsm/shared';
import { db } from '@/lib/firebase';
import { getServerSnapshot, getSnapshot, subscribe } from '@/lib/authStore';

export interface OrdinationAdminSession {
  /** True once the grant is known. Nothing should be drawn before it. */
  ready: boolean;
  canEdit: boolean;
  uid: string | null;
  /** The signed-in person's name, which a decision is recorded under. */
  name: string;
}

/**
 * Whether the signed-in person holds the `ordination` screen.
 *
 * `useCampAdmin` with the settings and the money taken out: one member read,
 * and a failed read is "not allowed" except for the superadmin, whose claim
 * answers without it.
 */
export function useOrdinationAdmin(): OrdinationAdminSession {
  const auth = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [state, setState] = useState({ ready: false, canEdit: false });

  const signedIn = auth.kind === 'signed-in';
  const uid = signedIn ? auth.uid : null;
  const name = signedIn ? auth.name : '';
  const claims = signedIn ? auth.claims : null;

  useEffect(() => {
    if (!signedIn || !uid) {
      if (auth.kind === 'signed-out') setState({ ready: true, canEdit: false });
      return;
    }

    let live = true;
    void (async () => {
      try {
        const member = await getDoc(doc(db(), COLLECTIONS.members, uid));
        const screens = parseScreenAdmin(member.data()?.['screenAdmin']);
        if (live) setState({ ready: true, canEdit: canAdminScreen(claims, screens, 'ordination') });
      } catch (error) {
        console.warn('[ordination] could not read your grants', error);
        if (live) setState({ ready: true, canEdit: claims?.superadmin === true });
      }
    })();

    return () => {
      live = false;
    };
  }, [auth.kind, signedIn, uid, claims?.superadmin]);

  return { ...state, uid, name };
}
