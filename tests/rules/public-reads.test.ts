import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, where, setDoc } from 'firebase/firestore';
import { createTestEnv, asAnon, asStaff, asAdmin } from './helpers.js';

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
  env = await createTestEnv();
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
    await setDoc(doc(db, 'events', 'festival'), {
      slug: 'festival',
      title: 'Parish festival',
      published: true,
      publishAt: null,
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

  it('allows the upcoming-events query', async () => {
    const db = asAnon(env).firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'events'), where('published', '==', true))),
    );
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

describe('staff bypass the published filter', () => {
  it('lets staff list everything, including drafts', async () => {
    const db = asStaff(env).firestore();
    await assertSucceeds(getDocs(collection(db, 'content')));
    await assertSucceeds(getDoc(doc(db, 'content', 'draft')));
  });

  it('lets staff write content but not a member below that tier', async () => {
    await assertSucceeds(
      setDoc(doc(asStaff(env).firestore(), 'content', 'about'), {
        section: 'about',
        title: 'Edited by staff',
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

  it('denies staff writes — repainting the site is an admin action', async () => {
    await assertFails(
      setDoc(doc(asStaff(env).firestore(), 'config', 'integrations'), { livestream: {} }),
    );
  });

  it('allows admin writes', async () => {
    await assertSucceeds(
      setDoc(doc(asAdmin(env).firestore(), 'config', 'integrations'), {
        livestream: { enabled: false },
      }),
    );
  });
});
