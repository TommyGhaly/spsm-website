import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
  Timestamp,
} from 'firebase/firestore';
import { createTestEnv, asAnon, asMember, asStaff } from './helpers.js';

/** A bookstore volunteer: `member` plus the group, which is the real shape. */
const asBookstore = (env: RulesTestEnvironment, uid = 'bookstore-1') =>
  env.authenticatedContext(uid, { role: 'member', groups: ['bookstore'] });

/**
 * The bookstore's two new collections, against a real emulator.
 *
 * `npm run rules:check` compiles the ruleset and proves nothing about what it
 * permits — this repo has already shipped a rule that compiled cleanly and
 * denied every public query in existence. These are the assertions that would
 * catch that.
 *
 * The claim under test for `bookstoreEvents` is unusual and worth stating: it
 * is writable by anyone unauthenticated and readable by nobody at all. Both
 * halves have to hold. An open create with a readable collection is an open
 * file host; a closed create makes every statistic on the site stop.
 */

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
  await env.clearFirestore();

  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'orders/order-1'), {
      squareOrderId: 'order-1',
      contactEmail: 'buyer@example.com',
      memberUid: null,
      status: 'paid',
      fulfillment: 'unfulfilled',
      shipping: false,
      total: { amount: 2500, currency: 'USD' },
      lineItems: [],
    });
    await setDoc(doc(db, 'products/holy-bible'), {
      slug: 'holy-bible',
      name: 'Holy Bible',
      description: '',
      price: { amount: 1500, currency: 'USD' },
      imagePaths: [],
      squareCatalogObjectId: 'SQ1',
      squareVariationId: 'SQV1',
      stockCount: null,
      category: 'Bookstore',
      published: true,
      publishAt: null,
    });
    await setDoc(doc(db, 'bookstoreStats/day-2026-08-23'), {
      period: 'day',
      key: '2026-08-23',
      products: {},
      searches: {},
      zeroResultSearches: {},
      totals: { views: 3 },
    });
  });
});

afterAll(async () => {
  await env.cleanup();
});

/** A document the rule should accept. Every test varies one field of this. */
function validEvent(over: Record<string, unknown> = {}) {
  return {
    kind: 'view',
    slug: 'be-prepared',
    term: null,
    quantity: 1,
    visitor: '0123456789abcdef',
    day: '2026-08-23',
    at: serverTimestamp(),
    expiresAt: Timestamp.fromDate(new Date('2026-11-21T00:00:00Z')),
    ...over,
  };
}

describe('bookstoreEvents — the open write path', () => {
  it('lets a signed-out visitor record a product event', async () => {
    const db = asAnon(env).firestore();
    await assertSucceeds(addDoc(collection(db, 'bookstoreEvents'), validEvent()));
  });

  it('lets a signed-out visitor record a search', async () => {
    const db = asAnon(env).firestore();
    await assertSucceeds(
      addDoc(collection(db, 'bookstoreEvents'), validEvent({ kind: 'search', slug: null, term: 'psalms' })),
    );
  });

  /*
   * The half that makes the open create acceptable. If any of these ever
   * succeeds, an unauthenticated write path has become an unauthenticated read
   * path over whatever anyone chose to put in it.
   */
  it('is readable by nobody — not anonymous, not a member, not staff', async () => {
    let id = '';
    await env.withSecurityRulesDisabled(async (context) => {
      const written = await addDoc(collection(context.firestore(), 'bookstoreEvents'), {
        ...validEvent(),
        at: Timestamp.now(),
      });
      id = written.id;
    });

    for (const as of [asAnon, asMember, asStaff]) {
      const db = as(env).firestore();
      await assertFails(getDoc(doc(db, 'bookstoreEvents', id)));
      await assertFails(getDocs(collection(db, 'bookstoreEvents')));
    }
  });

  it('cannot be edited or deleted, by anyone', async () => {
    let id = '';
    await env.withSecurityRulesDisabled(async (context) => {
      const written = await addDoc(collection(context.firestore(), 'bookstoreEvents'), {
        ...validEvent(),
        at: Timestamp.now(),
      });
      id = written.id;
    });

    for (const as of [asAnon, asMember, asStaff]) {
      const db = as(env).firestore();
      await assertFails(updateDoc(doc(db, 'bookstoreEvents', id), { quantity: 99 }));
      await assertFails(deleteDoc(doc(db, 'bookstoreEvents', id)));
    }
  });
});

describe('bookstoreEvents — what the shape check refuses', () => {
  const reject = (over: Record<string, unknown>) =>
    assertFails(addDoc(collection(asAnon(env).firestore(), 'bookstoreEvents'), validEvent(over)));

  it('refuses a kind it does not know', () => reject({ kind: 'purchase' }));

  /*
   * The timestamp check. Without `at == request.time` a client could backdate
   * an event into a period that has already been rolled up and read.
   */
  it('refuses a timestamp the browser chose', () =>
    reject({ at: Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')) }));

  it('refuses a visitor id that is not 16 lowercase hex characters', async () => {
    await reject({ visitor: 'nope' });
    await reject({ visitor: 'ABCDEF0123456789' });
    await reject({ visitor: '0123456789abcdef0' });
  });

  it('refuses a malformed day', async () => {
    await reject({ day: '23/08/2026' });
    await reject({ day: '2026-8-23' });
  });

  it('refuses a quantity outside 1–20', async () => {
    await reject({ quantity: 0 });
    await reject({ quantity: 21 });
    await reject({ quantity: 1.5 });
  });

  /*
   * The exclusive-choice rule. A document carrying both would leave the rollup
   * deciding which kind of event it really was.
   */
  it('refuses a product event with a term, and a search with a slug', async () => {
    await reject({ kind: 'view', slug: 'be-prepared', term: 'psalms' });
    await reject({ kind: 'search', slug: 'be-prepared', term: 'psalms' });
  });

  it('refuses a search with no term and a view with no slug', async () => {
    await reject({ kind: 'search', slug: null, term: null });
    await reject({ kind: 'view', slug: null, term: null });
  });

  it('refuses an over-long slug or term', async () => {
    await reject({ slug: 'x'.repeat(121) });
    await reject({ kind: 'search', slug: null, term: 'x'.repeat(81) });
  });

  /*
   * `hasOnly` is the difference between a bounded document and an open-ended
   * one. Without it the collection is free storage for anything.
   */
  it('refuses a field that is not in the schema', () => reject({ payload: 'x'.repeat(500) }));

  it('refuses a document with a field missing', async () => {
    const db = asAnon(env).firestore();
    const { expiresAt, ...withoutTtl } = validEvent();
    void expiresAt;
    await assertFails(addDoc(collection(db, 'bookstoreEvents'), withoutTtl));
  });
});

describe('bookstoreStats', () => {
  it('is readable by staff', async () => {
    const db = asStaff(env).firestore();
    await assertSucceeds(getDoc(doc(db, 'bookstoreStats/day-2026-08-23')));
  });

  it('is not readable by a member or by the public', async () => {
    // These are the parish's sales figures.
    for (const as of [asAnon, asMember]) {
      await assertFails(getDoc(doc(as(env).firestore(), 'bookstoreStats/day-2026-08-23')));
    }
  });

  it('cannot be written by anyone, including staff', async () => {
    const db = asStaff(env).firestore();
    await assertFails(updateDoc(doc(db, 'bookstoreStats/day-2026-08-23'), { totals: { views: 999 } }));
  });
});

describe('orders — the fulfilment exception', () => {
  it('lets staff mark an order collected', async () => {
    const db = asStaff(env).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'orders/order-1'), {
        fulfillment: 'ready',
        updatedAt: serverTimestamp(),
        updatedBy: 'staff-1',
      }),
    );
  });

  /*
   * The reason `allow write: if false` was there in the first place. Packing a
   * parcel is not the same permission as saying the parcel was paid for.
   */
  it('does not let staff touch the money', async () => {
    const db = asStaff(env).firestore();
    await assertFails(updateDoc(doc(db, 'orders/order-1'), { status: 'refunded' }));
    await assertFails(updateDoc(doc(db, 'orders/order-1'), { total: { amount: 1, currency: 'USD' } }));
    await assertFails(
      updateDoc(doc(db, 'orders/order-1'), {
        refund: { squareRefundId: 'forged', amount: { amount: 2500, currency: 'USD' } },
      }),
    );
  });

  it('does not let a money field ride along with a legitimate fulfilment change', async () => {
    // This is exactly what `hasOnly` exists to stop.
    const db = asStaff(env).firestore();
    await assertFails(
      updateDoc(doc(db, 'orders/order-1'), {
        fulfillment: 'collected',
        status: 'refunded',
        updatedAt: serverTimestamp(),
        updatedBy: 'staff-1',
      }),
    );
  });

  it('refuses a fulfilment value that is not one of the three', async () => {
    const db = asStaff(env).firestore();
    await assertFails(
      updateDoc(doc(db, 'orders/order-1'), {
        fulfillment: 'lost-in-the-post',
        updatedAt: serverTimestamp(),
        updatedBy: 'staff-1',
      }),
    );
  });

  it('does not let a member change fulfilment, or read an order that is not theirs', async () => {
    const db = asMember(env).firestore();
    await assertFails(
      updateDoc(doc(db, 'orders/order-1'), {
        fulfillment: 'collected',
        updatedAt: serverTimestamp(),
        updatedBy: 'member-1',
      }),
    );
    await assertFails(getDoc(doc(db, 'orders/order-1')));
  });

  it('never lets anyone create or delete an order', async () => {
    for (const as of [asAnon, asMember, asStaff]) {
      const db = as(env).firestore();
      await assertFails(setDoc(doc(db, 'orders/forged'), { status: 'paid', total: { amount: 1 } }));
      await assertFails(deleteDoc(doc(db, 'orders/order-1')));
    }
  });

  it('lets a signed-in buyer read an order attributed to them', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'orders/order-mine'), {
        squareOrderId: 'order-mine',
        memberUid: 'member-1',
        contactEmail: 'member@example.com',
        status: 'paid',
        fulfillment: 'unfulfilled',
        shipping: false,
        total: { amount: 500, currency: 'USD' },
        lineItems: [],
      });
    });

    await assertSucceeds(getDoc(doc(asMember(env).firestore(), 'orders/order-mine')));
    // …and not one attributed to somebody else.
    await assertFails(getDoc(doc(asMember(env, 'member-2').firestore(), 'orders/order-mine')));
  });
});

describe('the numbers actually arrive', () => {
  /*
   * Not a policy assertion — a plumbing one. Everything above tests that the
   * rule accepts a document; this checks that a batch of accepted documents is
   * readable back by a privileged reader and holds what was written. A rollup
   * over an empty collection produces a clean, entirely wrong report.
   */
  it('stores what was written, for the rollup to read', async () => {
    const db = asAnon(env).firestore();
    await assertSucceeds(
      addDoc(collection(db, 'bookstoreEvents'), validEvent({ kind: 'cartAdd', quantity: 4, day: '2026-08-24' })),
    );

    await env.withSecurityRulesDisabled(async (context) => {
      const snapshot = await getDocs(collection(context.firestore(), 'bookstoreEvents'));
      const written = snapshot.docs
        .map((entry) => entry.data())
        .filter((data) => data['day'] === '2026-08-24');

      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({ kind: 'cartAdd', quantity: 4, slug: 'be-prepared' });
      // Set by the server, not by the browser.
      expect(written[0]?.['at']).toBeInstanceOf(Timestamp);
    });
  });
});


describe('config/bookstore — the sections list', () => {
  const sections = (uid: string, list: unknown = [{ id: 'books', label: 'Books' }]) => ({
    sections: list,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });

  it('is world-readable, like the rest of config', async () => {
    await assertSucceeds(getDoc(doc(asAnon(env).firestore(), 'config/bookstore')));
  });

  /*
   * The create branch exists precisely for this: nothing seeds this document,
   * so the first section anyone makes is a create against a missing doc. A
   * single `allow write` using `diff(resource.data)` refuses it, because
   * `resource` is null.
   */
  it('lets the bookstore group create it when it does not exist yet', async () => {
    await assertSucceeds(
      setDoc(doc(asBookstore(env).firestore(), 'config/bookstore'), sections('bookstore-1')),
    );
  });

  it('lets staff update it afterwards', async () => {
    await assertSucceeds(
      setDoc(doc(asStaff(env).firestore(), 'config/bookstore'), sections('staff-1'), {
        merge: true,
      }),
    );
  });

  it('does not let a member or the public touch it', async () => {
    await assertFails(
      setDoc(doc(asMember(env).firestore(), 'config/bookstore'), sections('member-1'), { merge: true }),
    );
    await assertFails(
      setDoc(doc(asAnon(env).firestore(), 'config/bookstore'), sections('nobody'), { merge: true }),
    );
  });

  /*
   * The key set is the whole point of the second block. Widening this document
   * for sections must not hand the bookstore group the delivery charge — that
   * is a real amount charged to a real card, and it stays admin-only.
   */
  it('does not let the group change the delivery charge or the shop copy', async () => {
    const db = asBookstore(env).firestore();
    for (const field of ['deliveryCents', 'orderEmail', 'returnsNotice', 'fulfilmentNote']) {
      await assertFails(
        setDoc(
          doc(db, 'config/bookstore'),
          { [field]: field === 'deliveryCents' ? 1 : 'x', updatedAt: serverTimestamp(), updatedBy: 'bookstore-1' },
          { merge: true },
        ),
      );
    }
  });

  it('does not let the group reach any other config document', async () => {
    const db = asBookstore(env).firestore();
    for (const id of ['integrations', 'parish', 'theme', 'events']) {
      await assertFails(setDoc(doc(db, `config/${id}`), { sections: [] }, { merge: true }));
    }
  });

  it('refuses a sections value that is not a bounded list', async () => {
    const db = asStaff(env).firestore();
    await assertFails(
      setDoc(doc(db, 'config/bookstore'), sections('staff-1', 'books'), { merge: true }),
    );
    const thirteen = Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, label: `S${i}` }));
    await assertFails(
      setDoc(doc(db, 'config/bookstore'), sections('staff-1', thirteen), { merge: true }),
    );
  });

  it('refuses an edit attributed to somebody else', async () => {
    await assertFails(
      setDoc(doc(asStaff(env).firestore(), 'config/bookstore'), sections('someone-else'), {
        merge: true,
      }),
    );
  });

  it('cannot be deleted', async () => {
    await assertFails(deleteDoc(doc(asStaff(env).firestore(), 'config/bookstore')));
  });
});

describe('products — filing a book into a section', () => {
  const file = (uid: string, section: unknown = 'books') => ({
    section,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });

  it('lets the bookstore group set a product’s section', async () => {
    await assertSucceeds(
      updateDoc(doc(asBookstore(env).firestore(), 'products/holy-bible'), file('bookstore-1')),
    );
  });

  it('lets them clear it again', async () => {
    await assertSucceeds(
      updateDoc(doc(asBookstore(env).firestore(), 'products/holy-bible'), file('bookstore-1', null)),
    );
  });

  /*
   * Square owns everything else on this document. The mirror's price is not
   * what the buyer is charged — the checkout prices from Square's own catalog —
   * but a browser that can rewrite the shop's prices is still a browser that can
   * lie to every shopper about what a book costs.
   */
  it('does not let them touch anything Square owns', async () => {
    const db = asBookstore(env).firestore();
    await assertFails(updateDoc(doc(db, 'products/holy-bible'), { price: { amount: 1, currency: 'USD' } }));
    await assertFails(updateDoc(doc(db, 'products/holy-bible'), { name: 'Free Bible' }));
    await assertFails(updateDoc(doc(db, 'products/holy-bible'), { published: false }));
    await assertFails(updateDoc(doc(db, 'products/holy-bible'), { squareVariationId: 'forged' }));
  });

  it('does not let a price ride along with a legitimate section change', async () => {
    await assertFails(
      updateDoc(doc(asBookstore(env).firestore(), 'products/holy-bible'), {
        section: 'books',
        price: { amount: 1, currency: 'USD' },
        updatedAt: serverTimestamp(),
        updatedBy: 'bookstore-1',
      }),
    );
  });

  /*
   * Bounded for the *group*, and the distinction is the rule, not a nicety.
   *
   * `products` already carried `allow write: if hasRole('staff')`, and Firestore
   * ORs matching rules — so a staff member goes through that broad rule and the
   * validation below never runs for them. This is what the narrow block actually
   * governs: the bookstore group, whose only way in is here.
   *
   * Written as a staff assertion first, and the suite caught it: `section: 42`
   * from a staff account succeeded, because of course it did.
   */
  it('refuses a section from the group that is not a bounded string', async () => {
    const db = asBookstore(env).firestore();
    await assertFails(updateDoc(doc(db, 'products/holy-bible'), file('bookstore-1', 42)));
    await assertFails(updateDoc(doc(db, 'products/holy-bible'), file('bookstore-1', 'x'.repeat(41))));
  });

  it('leaves staff unconstrained, as they already were', async () => {
    // Not a hole this change opened. `allow write: if hasRole('staff')` predates
    // it and is what the sync script and staff tooling rely on; the narrow rule
    // above only adds the group. Asserted so the difference is deliberate and
    // visible rather than discovered.
    await assertSucceeds(
      updateDoc(doc(asStaff(env).firestore(), 'products/holy-bible'), { name: 'Holy Bible' }),
    );
  });

  it('does not let a plain member file anything', async () => {
    await assertFails(
      updateDoc(doc(asMember(env).firestore(), 'products/holy-bible'), file('member-1')),
    );
  });

  /*
   * Creating a product in a browser must stay impossible. The checkout prices
   * from Square's catalog, so a row invented here has no variation id and is a
   * book on the shop that nobody can buy.
   */
  it('does not let the bookstore group invent a product', async () => {
    await assertFails(
      setDoc(doc(asBookstore(env).firestore(), 'products/forged'), {
        slug: 'forged',
        name: 'Forged',
        price: { amount: 1, currency: 'USD' },
        published: true,
        publishAt: null,
      }),
    );
  });
});
