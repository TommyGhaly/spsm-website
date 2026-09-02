import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, where, setDoc } from 'firebase/firestore';
import { createTestEnv, asAnon, asSignedIn, asSuper } from './helpers.js';

/** Holds the About pages and nothing else. The grant is seeded below. */
const asContent = (env: RulesTestEnvironment) => env.authenticatedContext('content-1', {});

/**
 * The decision #10 regression suite.
 *
 * `npm run rules:check` compiles the policy. It passed a rule that denied every
 * public list query in existence, and it took building a page to notice. These
 * tests assert the queries the site *actually issues*, which is the only thing
 * that would have caught it.
 *
 * If someone reintroduces a `publishAt` clause into `isPublished`, the list
 * tests below go red immediately.
 */

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv('public-reads');
  // Cleared once, here. Re-clearing before every test races with the seed that
  // follows it and silently drops fixtures — see the note in writes.test.ts.
  // Every seed below is an idempotent upsert, and no other suite writes to
  // content / events / announcements, so these are the only documents present.
  await env.clearFirestore();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  // Seeded through the bypass context: this is fixture setup, not the thing
  // under test.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // The allocation `asContent` runs on. Every check in `hasScreen()` reads
    // this document, so without it that context is an ordinary signed-in
    // account.
    await setDoc(doc(db, 'members', 'content-1'), {
      displayName: 'content-1',
      email: 'content@spsmwayland.org',
      screenAdmin: { content: true },
      programAdmin: { programs: [], events: [] },
    });

    await setDoc(doc(db, 'content', 'about'), {
      section: 'about',
      title: 'About the parish',
      published: true,
      publishAt: null,
      order: 10,
    });
    await setDoc(doc(db, 'content', 'draft'), {
      section: 'about',
      title: 'Unfinished draft',
      published: false,
      publishAt: null,
      order: 20,
    });
    // The document that the old, broken rule silently excluded forever.
    await setDoc(doc(db, 'content', 'scheduled'), {
      section: 'about',
      title: 'Published, and carries a publishAt',
      published: true,
      publishAt: new Date('2026-01-01T00:00:00Z'),
      order: 30,
    });
    /*
     * A form whose document id is NOT its slug, which is the case the two
     * reads on /forms/<slug> exist for. Renaming a form's address in the
     * builder leaves the id behind, so the exact `get` misses and the query
     * below it is the only thing that finds the form.
     */
    await setDoc(doc(db, 'forms', 'form-mti86az7'), {
      slug: 'new-services-and-events',
      title: 'New services and events',
      kind: 'embed',
      externalUrl: 'https://stphilopaterstmina.breezechms.com/form/NewServicesandEvents98',
      published: true,
      fields: [],
    });
    await setDoc(doc(db, 'forms', 'form-draft'), {
      slug: 'not-ready',
      title: 'Half-built',
      kind: 'native',
      published: false,
      fields: [],
    });

    // No `published` and no `publishAt`: events do not have them any more.
    await setDoc(doc(db, 'events', 'festival'), {
      slug: 'festival',
      title: 'Parish festival',
      startAt: new Date('2026-09-01T16:00:00Z'),
      category: 'festival',
    });
    await setDoc(doc(db, 'announcements', 'a1'), {
      title: 'Coffee hour',
      published: true,
      publishAt: null,
      pinned: false,
      createdAt: new Date('2026-08-01T00:00:00Z'),
    });
  });
});

describe('anonymous list queries the site actually issues', () => {
  it('allows content filtered on published == true', async () => {
    const db = asAnon(env).firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'content'), where('published', '==', true))),
    );
  });

  it('allows the section-scoped content query', async () => {
    const db = asAnon(env).firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(db, 'content'),
          where('published', '==', true),
          where('section', '==', 'about'),
        ),
      ),
    );
  });

  /*
   * Unfiltered, which is the query `data.ts` now issues.
   *
   * This asked for `where('published','==',true)` and would still pass, because
   * Firestore judges a list by what the rule allows and the rule allows
   * everything here. The point of changing it is that it now tests the query the
   * build actually makes — and it is the one that would have failed had the read
   * rule been left as `isPublished(resource.data) || hasRole('staff')` when the
   * field went away.
   */
  it('allows the unfiltered events query the build issues', async () => {
    const db = asAnon(env).firestore();
    await assertSucceeds(getDocs(collection(db, 'events')));
  });

  it('lets an anonymous reader fetch one event', async () => {
    const db = asAnon(env).firestore();
    await assertSucceeds(getDoc(doc(db, 'events', 'festival')));
  });

  it('allows the announcements query', async () => {
    const db = asAnon(env).firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'announcements'), where('published', '==', true))),
    );
  });

  it('returns published documents that carry a publishAt', async () => {
    // The heart of decision #10. The old rule admitted only
    // `where('publishAt','==',null)`, which excluded this document forever —
    // silently, with no error anywhere.
    const db = asAnon(env).firestore();
    const snapshot = await getDocs(
      query(collection(db, 'content'), where('published', '==', true)),
    );
    const ids = snapshot.docs.map((d) => d.id).sort();
    if (!ids.includes('scheduled')) {
      throw new Error(`expected 'scheduled' in the result set, got: ${ids.join(', ')}`);
    }
    if (ids.includes('draft')) {
      throw new Error("unpublished 'draft' leaked into an anonymous query");
    }
  });
});

describe('anonymous reads are still bounded', () => {
  it('denies an unfiltered list, which could return unpublished documents', async () => {
    const db = asAnon(env).firestore();
    await assertFails(getDocs(collection(db, 'content')));
  });

  it('denies reading an unpublished document directly', async () => {
    const db = asAnon(env).firestore();
    await assertFails(getDoc(doc(db, 'content', 'draft')));
  });

  it('allows reading a published document directly', async () => {
    const db = asAnon(env).firestore();
    await assertSucceeds(getDoc(doc(db, 'content', 'about')));
  });

  it('denies anonymous writes to content', async () => {
    const db = asAnon(env).firestore();
    await assertFails(setDoc(doc(db, 'content', 'about'), { title: 'Defaced' }));
  });
});

describe('the content grant bypasses the published filter', () => {
  /*
   * `asStaff` used to stand here, and the tier is what made these pass. The
   * grant is a flag on a member document now, so the fixture has to be seeded
   * — and the assertion below is stronger for it: a signed-in account with no
   * allocation is refused the drafts, which under the old ladder was true of
   * nobody who could reach this screen at all.
   */
  it('lets the About-pages editor list everything, including drafts', async () => {
    const db = asContent(env).firestore();
    await assertSucceeds(getDocs(collection(db, 'content')));
    await assertSucceeds(getDoc(doc(db, 'content', 'draft')));
  });

  it('refuses a signed-in member with no grant', async () => {
    const db = asSignedIn(env).firestore();
    await assertFails(getDoc(doc(db, 'content', 'draft')));
    await assertFails(
      setDoc(doc(db, 'content', 'about'), { section: 'about', title: 'Defaced', published: true }),
    );
  });

  it('lets the About-pages editor write content', async () => {
    await assertSucceeds(
      setDoc(doc(asContent(env).firestore(), 'content', 'about'), {
        section: 'about',
        title: 'Edited by the content editor',
        published: true,
      }),
    );
  });
});

describe('config is world-readable and admin-written', () => {
  it('allows the anonymous build-time read', async () => {
    // The website build reads this before it holds any other credential.
    await assertSucceeds(getDoc(doc(asAnon(env).firestore(), 'config', 'integrations')));
  });

  it('denies anonymous writes', async () => {
    await assertFails(
      setDoc(doc(asAnon(env).firestore(), 'config', 'integrations'), { livestream: {} }),
    );
  });

  /*
   * `config` is deliberately not delegable — it is in ADMIN_SCREENS and /access
   * does not offer the row, because this is where the site is pointed at its
   * backends. So the widest allocation the parish can hand out is still refused
   * here, which is what this asserts.
   */
  it('denies a granted editor — pointing the site at its backends is the superadmin’s', async () => {
    await assertFails(
      setDoc(doc(asContent(env).firestore(), 'config', 'integrations'), { livestream: {} }),
    );
  });

  it('allows superadmin writes', async () => {
    await assertSucceeds(
      setDoc(doc(asSuper(env).firestore(), 'config', 'integrations'), {
        livestream: { enabled: false },
      }),
    );
  });

  /**
   * The theme document, covered separately from `integrations` on purpose.
   *
   * It is a *different document* under the same `match /config/{docId}` rule, so
   * these assertions look redundant — and they are exactly the kind that stops
   * being redundant the moment somebody adds a narrower rule for one document
   * and assumes it restricts the others. It cannot: Firestore grants when any
   * matching rule allows, which is the trap `servantsConfig` exists to avoid.
   *
   * The read matters most. The site is a static export whose build reads this
   * anonymously, before it holds any credential — if this were ever gated, every
   * page would silently fall back to the bundled theme with only a build-log
   * warning to say so.
   */
  it('allows the anonymous build-time read of config/theme', async () => {
    await assertSucceeds(getDoc(doc(asAnon(env).firestore(), 'config', 'theme')));
  });

  it('denies anonymous writes, and writes from a grant that is not theme', async () => {
    // Restyling the whole site is the superadmin's or the Colours-and-type
    // grant's. It is also a defacement vector — the parsed document is
    // interpolated into every page's <style>.
    await assertFails(
      setDoc(doc(asAnon(env).firestore(), 'config', 'theme'), { color: { accent: '#000000' } }),
    );
    // Holding About pages is not holding Colours and type. This is the
    // assertion that the carve-out for `config/theme` reads its own flag rather
    // than admitting anybody with any allocation.
    await assertFails(
      setDoc(doc(asContent(env).firestore(), 'config', 'theme'), { color: { accent: '#000000' } }),
    );
  });

  it('allows superadmin writes to config/theme', async () => {
    await assertSucceeds(
      setDoc(doc(asSuper(env).firestore(), 'config', 'theme'), {
        color: { accent: '#8c2f26' },
      }),
    );
  });
});

/**
 * Finding a form by its slug when that is not its document id.
 *
 * ---------------------------------------------------------------------------
 * Two failures met here, and neither is visible to a signed-in developer.
 *
 * `readFormBySlug` reads the exact id first and falls back to a query. For
 * anybody holding the `forms` grant both work, because their `allow read: if
 * hasScreen('forms')` answers without touching `resource`. For a visitor:
 *
 *  1. **The `get` on a missing id throws rather than coming back empty.** The
 *     public rule is `isPublished(resource.data)`; on a document that does not
 *     exist, `resource` is null, the dereference is an evaluation error, and an
 *     error denies. The page has to catch that and carry on to the query.
 *  2. **The query has to constrain `published`.** Firestore judges a list by
 *     what it could return, so `where('slug','==',…)` alone could yield a
 *     draft and is refused outright — decision #10, arriving on the page as
 *     "the form could not be loaded" for a form that is published.
 *
 * Both were found by opening an embedded Breeze form signed out.
 * ---------------------------------------------------------------------------
 */
describe('a published form, read by its slug', () => {
  it('denies the exact get on an id that does not exist', async () => {
    // Not a curiosity: this is the *first* read the page makes, on every form
    // whose slug and id differ. It must be caught rather than propagated.
    await assertFails(getDoc(doc(asAnon(env).firestore(), 'forms', 'new-services-and-events')));
  });

  it('allows the slug query the page falls back to', async () => {
    const db = asAnon(env).firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(db, 'forms'),
          where('slug', '==', 'new-services-and-events'),
          where('published', '==', true),
        ),
      ),
    );
  });

  it('refuses the same query without the published constraint', async () => {
    // The regression this suite exists for. Dropping the second `where` makes
    // every embedded form 404 for the public and for nobody else.
    const db = asAnon(env).firestore();
    await assertFails(
      getDocs(query(collection(db, 'forms'), where('slug', '==', 'new-services-and-events'))),
    );
  });

  it('still keeps a draft form to the people building it', async () => {
    const db = asAnon(env).firestore();
    await assertFails(getDoc(doc(db, 'forms', 'form-draft')));
    await assertSucceeds(getDoc(doc(asSuper(env).firestore(), 'forms', 'form-draft')));
  });
});
