'use client';

import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  emptyAboutOverride,
  parseAboutOverride,
  type AboutSlug,
} from '@spsm/shared';
import { db } from '@/lib/firebase';
import type { BakedAbout } from './data';

/**
 * Writing an About page's overrides. Staff only, in the browser.
 *
 * ---------------------------------------------------------------------------
 * Split from `data.ts` for the same reason `features/events/admin.ts` is: the
 * read half is imported by five server components that render public pages, and
 * a write helper in the same module is one careless import away from being in
 * their bundle. Nothing here is re-exported from `index.ts`.
 * ---------------------------------------------------------------------------
 */

/**
 * What Firestore actually holds, right now.
 *
 * Called when edit mode opens, and the reason is the same one `markSaved`
 * exists for: the form is otherwise seeded from copy baked into this page's
 * HTML at the last build, which may be days old. Without this read, a second
 * person's edit is silently overwritten by whatever this browser was serving.
 */
export async function readAboutOverride(slug: AboutSlug): Promise<BakedAbout> {
  const snapshot = await getDoc(doc(db(), COLLECTIONS.aboutOverrides, slug));
  if (!snapshot.exists()) return emptyAboutOverride(slug);
  return parseAboutOverride(slug, snapshot.data());
}

/**
 * Write the whole overlay.
 *
 * ---------------------------------------------------------------------------
 * **No `merge: true`, and that is the fix for a bug worth writing down.**
 *
 * This used to be `setDoc(..., { merge: true })`, on the reasoning that merging
 * protected `createdAt` and that `slots` and `sections` were sent complete
 * every time anyway. The second half was true and the first half was not the
 * whole story: **a Firestore merge recurses into map fields.** So a merged
 * write of `slots` unions the keys — it can add one and change one and cannot
 * remove one.
 *
 * Which is precisely what "put the original back" has to do. Reverting a slot
 * drops its key from the draft, the page immediately shows the hand-written
 * words, the write reports Saved, and the stale override is still in the
 * document — so it comes back on the next reload. Caught by reverting a
 * heading, reloading, and finding the override again.
 *
 * A full replace is the honest shape for this document anyway: `slots` and
 * `sections` together *are* the answer to "what has staff changed on this
 * page", so there is no such thing as a partial one. `createdAt` is carried
 * across by hand, which is the one thing merge was buying.
 * ---------------------------------------------------------------------------
 */
export async function saveAboutOverride(slug: AboutSlug, draft: BakedAbout): Promise<void> {
  const { auth } = await import('@/lib/auth');
  const uid = auth().currentUser?.uid ?? null;
  const ref = doc(db(), COLLECTIONS.aboutOverrides, slug);
  const existing = await getDoc(ref);
  const createdAt = existing.data()?.['createdAt'];

  await setDoc(ref, {
    // The rule checks this against the document id, which is what refuses a
    // sixth part of About. Never take it from the draft's own field.
    slug,
    slots: draft.slots,
    sections: draft.sections,
    // Carried rather than merged. A document written before this field existed
    // has none, and stamping `serverTimestamp()` over a real one would make
    // every save look like a creation.
    createdAt: createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}
