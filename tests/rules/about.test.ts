import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { createTestEnv, asAnon, asSignedIn, asSuper } from './helpers.js';

/**
 * `aboutOverrides` — staff's edits to the five About pages and to /privacy.
 *
 * ---------------------------------------------------------------------------
 * Three claims in that rule are load-bearing and none of them is obvious from
 * reading the policy, which is exactly what this file is for. `rules:check`
 * compiles the ruleset; it cannot tell you the policy denies the build.
 *
 *  1. **The world may read it.** `next build` reads this collection
 *     unauthenticated to bake the pages, and every visitor's browser re-reads
 *     it over REST. A rule that asked for `published` — the shape every other
 *     public collection here uses — would deny both, and the symptom would be
 *     a build that fails or a swap that silently never happens.
 *  2. **The slug is closed.** The editable pages are a fixed list, because a
 *     new one needs a route file the static export can enumerate and a band
 *     manifest beside it. The rule enforces that against the *document id*, so
 *     the editor cannot create one by accident and neither can a console edit.
 *  3. **`slug` must match its own id.** Without it, a writer with the grant
 *     could park one page's copy in another page's document.
 * ---------------------------------------------------------------------------
 */

/** Holds About pages and nothing else. The grant is seeded in `beforeEach`. */
const asContent = (env: RulesTestEnvironment) => env.authenticatedContext('content-1', {});

const OVERRIDE = {
  slug: 'who-we-are',
  slots: { 'what-copt-means.h2': { text: 'A word that means Egyptian' } },
  sections: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  updatedBy: 'content-1',
};

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv('about');
  await env.clearFirestore();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    /*
     * The allocation `asContent` runs on. Every `hasScreen()` check reads this
     * document, so without it that context is an ordinary signed-in account —
     * which is a failure mode worth naming, because it looks like the rule
     * being wrong rather than the fixture being absent.
     */
    await setDoc(doc(db, 'members', 'content-1'), {
      displayName: 'content-1',
      email: 'content@spsmwayland.org',
      screenAdmin: { content: true },
      programAdmin: { programs: [], events: [] },
    });

    // Somebody with a different area entirely. Proves the flag is the gate and
    // not merely "is allocated something".
    await setDoc(doc(db, 'members', 'bookstore-1'), {
      displayName: 'bookstore-1',
      email: 'shop@spsmwayland.org',
      screenAdmin: { bookstore: true },
      programAdmin: { programs: [], events: [] },
    });

    await setDoc(doc(db, 'aboutOverrides', 'our-belief'), {
      ...OVERRIDE,
      slug: 'our-belief',
    });
  });
});

describe('reading', () => {
  it('lets the world read an override — this is what `next build` does', async () => {
    const db = asAnon(env).firestore();
    await assertSucceeds(getDoc(doc(db, 'aboutOverrides', 'our-belief')));
  });

  it('lets the world read a page nobody has edited', async () => {
    // A 404 is the ordinary state for four of the five pages, and it has to be
    // *allowed* rather than denied: `getDoc` on a missing document is still a
    // rules decision, and a denial would surface as a broken build.
    const db = asAnon(env).firestore();
    await assertSucceeds(getDoc(doc(db, 'aboutOverrides', 'patron-saints')));
  });
});

describe('writing', () => {
  it('refuses an anonymous write', async () => {
    const db = asAnon(env).firestore();
    await assertFails(setDoc(doc(db, 'aboutOverrides', 'who-we-are'), OVERRIDE));
  });

  it('refuses somebody signed in with no allocation', async () => {
    const db = asSignedIn(env).firestore();
    await assertFails(setDoc(doc(db, 'aboutOverrides', 'who-we-are'), OVERRIDE));
  });

  it('refuses somebody allocated a different area', async () => {
    const db = asSignedIn(env, 'bookstore-1').firestore();
    await assertFails(setDoc(doc(db, 'aboutOverrides', 'who-we-are'), OVERRIDE));
  });

  it('allows the Content grant to create one', async () => {
    const db = asContent(env).firestore();
    await assertSucceeds(setDoc(doc(db, 'aboutOverrides', 'who-we-are'), OVERRIDE));
  });

  it('allows the Content grant to update one', async () => {
    const db = asContent(env).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'aboutOverrides', 'our-belief'), {
        slug: 'our-belief',
        slots: { 'the-see.h2': { text: 'Whose confession this is' } },
      }),
    );
  });

  it('allows the superadmin', async () => {
    // `slug` matching the document id, because the rule checks that for
    // everybody — the superadmin claim widens `hasScreen`, not the slug guard.
    // Writing `OVERRIDE` verbatim here failed, which is the guard working.
    const db = asSuper(env).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'aboutOverrides', 'future-plans'), { ...OVERRIDE, slug: 'future-plans' }),
    );
  });
});

describe('the six slugs, and only the six', () => {
  it('refuses a slug with no page behind it', async () => {
    // The one that matters. A document here with no route file behind it is
    // copy nothing renders, and the editor should not be able to make one.
    const db = asContent(env).firestore();
    await assertFails(
      setDoc(doc(db, 'aboutOverrides', 'our-history'), { ...OVERRIDE, slug: 'our-history' }),
    );
  });

  it('allows /privacy, which is not part of About', async () => {
    /*
     * The privacy notice is edited by the same overlay on the same `content`
     * flag — Tommy asked for it to work the way the About pages do. Asserted
     * here because the rule's slug list and `ABOUT_SLUGS` are two copies of the
     * same fact, and the symptom of them disagreeing is a page that looks
     * editable and refuses every save. That has happened once already: see the
     * note in `AboutEditor` about the rule being written but not deployed.
     */
    const db = asContent(env).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'aboutOverrides', 'privacy'), { ...OVERRIDE, slug: 'privacy' }),
    );
  });

  it('refuses a slug that does not match its own document id', async () => {
    const db = asContent(env).firestore();
    await assertFails(
      setDoc(doc(db, 'aboutOverrides', 'who-we-are'), { ...OVERRIDE, slug: 'our-belief' }),
    );
  });

  it('refuses a write with no slug at all', async () => {
    const db = asContent(env).firestore();
    await assertFails(
      setDoc(doc(db, 'aboutOverrides', 'who-we-are'), { slots: {}, sections: [] }),
    );
  });

  it('refuses an update that drops the slug', async () => {
    /*
     * `request.resource.data` is the document *after* the merge, so an update
     * that leaves `slug` alone still satisfies the check — but one that clears
     * it must not. Asserted because this is the difference between the rule
     * guarding the document and guarding only the first write to it.
     */
    const db = asContent(env).firestore();
    await assertFails(updateDoc(doc(db, 'aboutOverrides', 'our-belief'), { slug: null }));
  });
});

describe('deleting', () => {
  it('refuses a delete, even from the superadmin', async () => {
    // Clearing every field already restores the hand-written page — that is
    // what `copyOf` and `pictureOf` are for — so a delete buys nothing and
    // costs the audit trail.
    const db = asSuper(env).firestore();
    await assertFails(deleteDoc(doc(db, 'aboutOverrides', 'our-belief')));
  });

  it('refuses a delete from the Content grant', async () => {
    const db = asContent(env).firestore();
    await assertFails(deleteDoc(doc(db, 'aboutOverrides', 'our-belief')));
  });
});
