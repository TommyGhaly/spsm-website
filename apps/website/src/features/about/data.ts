import { cache } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  emptyAboutOverride,
  parseAboutOverride,
  type AboutOverride,
  type AboutSlug,
} from '@spsm/shared';
import { db } from '@/lib/firebase';
import { safely } from '@/lib/firestore';

/**
 * The build-time read of one About page's overrides.
 *
 * ---------------------------------------------------------------------------
 * ## Why this is `cache()`d rather than passed down
 *
 * A page carries a couple of dozen `<Editable>`s, each of which needs the same
 * document, and threading it through `WhoScreen` → `parts.tsx` → `Plate` would
 * put an editing concern in the signature of every component that draws a
 * paragraph — which is the thing `features/programs/editMode` exists to avoid
 * one level up. `React.cache` is per-request memoisation, so all of them share
 * one `getDoc` and the prop stays out of the tree.
 *
 * ## Why a `get` and not a query
 *
 * Because there is exactly one document per page and its id is the slug. That
 * is also what keeps this out of the way of the rule every list on this site
 * has to satisfy: a `get` proves nothing about a result set, so there is no
 * `published` filter to remember. See `lib/firestore.ts` and the rule itself.
 *
 * ## Failure renders the coded page
 *
 * `safely` returns the fallback for an unreachable Firestore or an absent
 * collection, and the fallback here is an empty override — which every merge
 * helper reads as "use the hand-written version". So the worst case of this
 * whole feature failing is the site as it was before it existed.
 *
 * A permission-denied still throws, deliberately, because that would mean the
 * public cannot read copy we are about to bake into a public page.
 * ---------------------------------------------------------------------------
 */
export type BakedAbout = Pick<AboutOverride, 'slug' | 'slots' | 'sections'>;

export const getAboutOverride = cache(async (slug: AboutSlug): Promise<BakedAbout> => {
  return safely(
    `about overrides for ${slug}`,
    async () => {
      const snapshot = await getDoc(doc(db(), COLLECTIONS.aboutOverrides, slug));
      // A document that has never been written is the ordinary state for four
      // of the five pages, not an error.
      if (!snapshot.exists()) return emptyAboutOverride(slug);
      return parseAboutOverride(slug, snapshot.data());
    },
    emptyAboutOverride(slug),
  );
});
