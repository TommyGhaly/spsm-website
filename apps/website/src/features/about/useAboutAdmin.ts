'use client';

import { type SpsmClaims } from '@spsm/shared';
import { useScreenGrants } from '@/lib/screenGrants';

/**
 * Whether the person reading an About page may change it.
 *
 * `content` is the flag — the one `firestore.rules` asks for on
 * `aboutOverrides` and on `content/`, and the one that had no editor behind it
 * until now. See the note on the deleted rows in `features/access/areas.ts`.
 *
 * Everything the header of `useEventsAdmin` says applies here word for word,
 * and harder: /about/who-we-are is a page a stranger arrives at from a search
 * result. This does not import `firebase/auth`; it subscribes to
 * `lib/authStore`, which loads the SDK only when a session hint says there is
 * somebody to load it for. A visitor downloads nothing extra.
 *
 * Not a security boundary. This decides what to draw.
 */
export interface AboutAdminSession {
  ready: boolean;
  claims: SpsmClaims | null;
  canEdit: boolean;
}

export function useAboutAdmin(): AboutAdminSession {
  const { ready, claims, canAdmin } = useScreenGrants();
  return { ready, claims, canEdit: canAdmin('content') };
}
