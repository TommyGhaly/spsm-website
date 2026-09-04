import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  createTestEnv,
  asAnonymousSession,
  asServant,
  asSignedIn,
  asSuper,
} from './helpers.js';

/**
 * `hasScreen()` — the whole of the site's authorization.
 *
 * ---------------------------------------------------------------------------
 * ## Why this file has to exist
 *
 * `screenAdmin` was written on every member document since sign-in was built
 * and read by nothing. The allocation screen at /access writes it, and these
 * are the assertions that say writing it means something — that somebody who
 * holds `forms` can actually read a submission, and that somebody who does not
 * still cannot.
 *
 * It matters more than it did. There was a `staff` tier above these flags when
 * this file was written, so a flag was a *widening* and a bug in one of these
 * rules cost a delegated administrator their screen. The tier is gone: these
 * flags and the program grants beside them are now the only thing between a
 * signed-in parish account and every screen on the site, so a bug in one of
 * these rules is the difference between a policy and a suggestion.
 *
 * `npm run rules:check` cannot answer either question. It compiles the ruleset,
 * and this repo has already shipped a ruleset that compiled cleanly and denied
 * every public list query on the site.
 *
 * ## The one that is easy to get wrong
 *
 * `hasScreen()` does a `get()` on the caller's member document, and a `get()`
 * on a **missing** document is an evaluation error rather than an empty map —
 * and an evaluation error denies. Which would mean the first superadmin, who is
 * bootstrapped by `grant-admin.mjs` and may have no member document at all,
 * gets refused from every screen on the site. Hence `exists()` in front of it,
 * and hence `describe('a superadmin with no member document')` below, which is
 * the regression test for exactly that.
 *
 * The same failure shape as the one already recorded for camp registrations: a
 * rule that reads a document which is not there denies for a reason nobody can
 * see in the error.
 * ---------------------------------------------------------------------------
 */

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv('access');
  await env.clearFirestore();

  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    // Four servants, each entrusted with exactly one area, plus one with
    // nothing — which is the control every assertion below is measured against.
    for (const [uid, screen] of [
      ['forms-servant', 'forms'],
      ['content-servant', 'content'],
      ['events-servant', 'events'],
      ['finance-servant', 'finance'],
      ['bookstore-servant', 'bookstore'],
      ['bulletin-servant', 'bulletin'],
      ['parking-servant', 'parking'],
      ['rota-servant', 'servants'],
      ['theme-servant', 'theme'],
    ] as const) {
      await setDoc(doc(db, `members/${uid}`), {
        displayName: uid,
        email: `${uid}@spsmwayland.org`,
        screenAdmin: { [screen]: true },
        programAdmin: { programs: [], events: [] },
      });
    }

    /*
     * Two treasurers narrowed to one source each, and one narrowed to nothing.
     *
     * `finance-servant` above deliberately has no `financeScopes` map at all —
     * that is the grandfathered shape, and the assertion that it still reaches
     * all three is the regression test for the one place this model reads a
     * missing key as `true`. These three are the explicit shapes: a map that
     * names a source is honoured exactly, including when it names all three
     * `false`.
     */
    for (const [uid, scopes] of [
      ['camp-treasurer', { bookstore: false, camp: true, forms: false }],
      ['shop-treasurer', { bookstore: true, camp: false, forms: false }],
      ['nothing-treasurer', { bookstore: false, camp: false, forms: false }],
    ] as const) {
      await setDoc(doc(db, `members/${uid}`), {
        displayName: uid,
        email: `${uid}@spsmwayland.org`,
        screenAdmin: { finance: true },
        financeScopes: scopes,
        programAdmin: { programs: [], events: [] },
      });
    }

    /*
     * Somebody given a source and *not* the finance grant. The map only ever
     * narrows, so this account must reach nothing — the test below is what
     * stops `hasFinance()` from being rewritten as an alternative door.
     */
    /*
     * Runs the camp's back office and nothing else — the `camp` flag, no
     * `finance`, no program grant. The counterpart to `camp-treasurer` below:
     * one holds the families and not the totals, the other the totals and not
     * the families, and the rules have to refuse each of them the other half.
     */
    await setDoc(doc(db, 'members/camp-office'), {
      displayName: 'camp-office',
      email: 'camp-office@spsmwayland.org',
      screenAdmin: { camp: true },
      programAdmin: { programs: [], events: [] },
    });

    await setDoc(doc(db, 'members/scoped-nobody'), {
      displayName: 'scoped-nobody',
      email: 'scoped-nobody@spsmwayland.org',
      screenAdmin: {},
      financeScopes: { bookstore: true, camp: true, forms: true },
      programAdmin: { programs: [], events: [] },
    });

    /*
     * A second servant with nothing, kept apart from `plain-servant` on
     * purpose. The escalation test below asserts that a self-write is refused,
     * and "refused" is indistinguishable from "allowed" when the value being
     * written is the value already stored — which is exactly what happened the
     * first time this file ran: the `granting` test above had already given
     * `plain-servant` the camp, so the escalation attempt was a no-op the rule
     * correctly permitted, and the suite reported a hole that was not there.
     * Nothing else touches this uid.
     */
    await setDoc(doc(db, 'members/self-servant'), {
      displayName: 'self-servant',
      email: 'self@spsmwayland.org',
      screenAdmin: {},
      programAdmin: { programs: [], events: [] },
    });

    await setDoc(doc(db, 'members/plain-servant'), {
      displayName: 'plain-servant',
      email: 'plain@spsmwayland.org',
      screenAdmin: {},
      programAdmin: { programs: [], events: [] },
    });

    /*
     * A third account with nothing, and it is kept apart for the same reason as
     * `self-servant`: the granting suite writes real grants onto
     * `plain-servant`, so the suite that asserts "signing in is worth nothing"
     * would pass or fail depending on the order vitest ran the describes in.
     * Nothing else touches this uid.
     */
    await setDoc(doc(db, 'members/nothing-servant'), {
      displayName: 'nothing-servant',
      email: 'nothing@spsmwayland.org',
      screenAdmin: {},
      programAdmin: { programs: [], events: [] },
    });

    // Deliberately no `members/admin-1`. See the note at the top.

    await setDoc(doc(db, 'forms/vehicle'), {
      slug: 'vehicle',
      title: 'Vehicle registration',
      published: false,
      fields: [],
    });
    // The two the church always has, and one that is ordinary paperwork. The
    // difference between them is asserted below — it is a rule, not a UI habit.
    for (const id of ['contact', 'vehicle-registration', 'festival-stall']) {
      await setDoc(doc(db, `forms/${id}`), {
        slug: id,
        title: id,
        published: true,
        fields: [],
      });
    }
    await setDoc(doc(db, 'formSubmissions/sub-1'), {
      formId: 'vehicle',
      answers: { name: 'A parishioner' },
      totalCents: 0,
    });
    await setDoc(doc(db, 'content/our-belief'), {
      title: 'Our belief',
      body: '',
      published: false,
    });
    await setDoc(doc(db, 'events/liturgy-1'), {
      title: 'Divine Liturgy',
      start: '2026-09-06T08:00:00.000Z',
    });
    await setDoc(doc(db, 'bookstoreStats/day-2026-08-30'), {
      revenueCents: 12500,
      orders: 4,
    });
    // The two totals-only rollups. Both are written by a Cloud Function using
    // the Admin SDK, which bypasses this whole file — so here they are seeded
    // the same way, with the rules disabled.
    await setDoc(doc(db, 'financeRollups/camp__summercamp__2027'), {
      kind: 'camp',
      programId: 'summercamp',
      season: '2027',
      money: { receivedCents: 45000, outstandingCents: 7500 },
    });
    await setDoc(doc(db, 'financeRollups/form__retreat'), {
      kind: 'form',
      formId: 'retreat',
      formTitle: 'Retreat',
      grossCents: 18000,
    });
    await setDoc(doc(db, 'orders/order-1'), {
      squareOrderId: 'order-1',
      memberUid: null,
      status: 'paid',
      fulfillment: 'unfulfilled',
      total: { amount: 2500, currency: 'USD' },
      lineItems: [],
    });
    await setDoc(doc(db, 'products/holy-bible'), {
      slug: 'holy-bible',
      name: 'Holy Bible',
      published: true,
      section: 'bibles',
    });
    await setDoc(doc(db, 'announcements/notice-1'), {
      title: 'Vespers moved',
      published: false,
    });
    await setDoc(doc(db, 'vehicles/car-1'), {
      plate: 'ABC123',
      ownerName: 'A parishioner',
      ownerUid: null,
      active: true,
    });
    await setDoc(doc(db, 'servantEvents/rota-1'), { title: 'Altar, 8am' });
    await setDoc(doc(db, 'scheduleEntries/entry-1'), { title: 'Parish cleanup' });
    await setDoc(doc(db, 'calendarDetails/occ-1'), { note: 'Bring a dish' });
    await setDoc(doc(db, 'config/theme'), { tokens: {} });
  });
});

afterAll(async () => {
  await env.cleanup();
});

describe('a servant with no grants', () => {
  it('cannot read an unpublished form or any submission', async () => {
    const db = asServant(env, 'plain-servant').firestore();
    await assertFails(getDoc(doc(db, 'forms/vehicle')));
    await assertFails(getDoc(doc(db, 'formSubmissions/sub-1')));
  });

  it('cannot write the About pages or the calendar', async () => {
    const db = asServant(env, 'plain-servant').firestore();
    await assertFails(updateDoc(doc(db, 'content/our-belief'), { title: 'Mine now' }));
    await assertFails(updateDoc(doc(db, 'events/liturgy-1'), { title: 'Cancelled' }));
  });

  it('cannot read the takings', async () => {
    const db = asServant(env, 'plain-servant').firestore();
    await assertFails(getDoc(doc(db, 'bookstoreStats/day-2026-08-30')));
    await assertFails(getDoc(doc(db, 'orders/order-1')));
  });
});

describe('the forms grant', () => {
  it('opens the definitions and the replies, for read and for write', async () => {
    const db = asServant(env, 'forms-servant').firestore();
    await assertSucceeds(getDoc(doc(db, 'forms/vehicle')));
    await assertSucceeds(getDoc(doc(db, 'formSubmissions/sub-1')));
    await assertSucceeds(updateDoc(doc(db, 'forms/vehicle'), { title: 'Vehicles' }));
    await assertSucceeds(updateDoc(doc(db, 'formSubmissions/sub-1'), { reviewed: true }));
  });

  it('lists submissions, which a `get`-only rule would have denied', async () => {
    // The distinction that matters and that `rules:check` cannot see: a `list`
    // is evaluated against the query's potential result set, not the documents
    // returned. The admin panel opens with exactly this query.
    const db = asServant(env, 'forms-servant').firestore();
    await assertSucceeds(getDocs(collection(db, 'formSubmissions')));
  });

  it('opens nothing else', async () => {
    const db = asServant(env, 'forms-servant').firestore();
    await assertFails(updateDoc(doc(db, 'content/our-belief'), { title: 'Mine now' }));
    await assertFails(getDoc(doc(db, 'bookstoreStats/day-2026-08-30')));
  });

  /**
   * The two forms nobody may delete.
   *
   * `/forms/vehicle-registration` is on an NFC tag and a printed card in the
   * car park; `/forms/contact` is behind every "ask the church office" link on
   * the site and on the parish's stationery. Neither address can be corrected
   * by editing a file, so a delete is not an edit — it is a 404 found by
   * somebody standing in a car park on a Sunday.
   *
   * The drawer withholds the button and `deleteForm` throws before Firestore is
   * reached. Both of those are a page, and a page is whatever the browser
   * running it says it is. This is the one that holds.
   */
  it('refuses to delete the contact form or the vehicle registration', async () => {
    const db = asServant(env, 'forms-servant').firestore();
    await assertFails(deleteDoc(doc(db, 'forms/contact')));
    await assertFails(deleteDoc(doc(db, 'forms/vehicle-registration')));
    // Not even the superadmin, who is the one account that walks through
    // everything else in this file.
    await assertFails(deleteDoc(doc(asSuper(env).firestore(), 'forms/contact')));

    // The control: an ordinary form deletes exactly as before, so this is a
    // rule about two documents and not a collection somebody has frozen.
    await assertSucceeds(deleteDoc(doc(db, 'forms/festival-stall')));
  });

  it('still lets them be edited — permanent is not read-only', async () => {
    // The blurb, the picture, the notification address and the questions are
    // all still the office's to change. What is withheld is delete, and (in
    // the drawer, not here) unpublish.
    const db = asServant(env, 'forms-servant').firestore();
    await assertSucceeds(updateDoc(doc(db, 'forms/contact'), { blurb: 'Write to us.' }));
    await assertSucceeds(
      updateDoc(doc(db, 'forms/vehicle-registration'), { image: '/img/stock-parking-lot-1000.webp' }),
    );
  });
});

describe('the content grant', () => {
  it('reads an unpublished page and writes it', async () => {
    const db = asServant(env, 'content-servant').firestore();
    await assertSucceeds(getDoc(doc(db, 'content/our-belief')));
    await assertSucceeds(updateDoc(doc(db, 'content/our-belief'), { body: 'We believe…' }));
  });

  it('does not thereby reach the forms', async () => {
    const db = asServant(env, 'content-servant').firestore();
    await assertFails(getDoc(doc(db, 'formSubmissions/sub-1')));
  });
});

describe('the events grant', () => {
  it('writes the parish calendar', async () => {
    const db = asServant(env, 'events-servant').firestore();
    await assertSucceeds(updateDoc(doc(db, 'events/liturgy-1'), { title: 'Divine Liturgy' }));
  });

  it('does not open the servants schedule, which is a different collection', async () => {
    const db = asServant(env, 'events-servant').firestore();
    await assertFails(setDoc(doc(db, 'servantEvents/shift-1'), { title: 'A shift' }));
  });
});

describe('the finance grant', () => {
  it('reads the takings and the orders behind them', async () => {
    const db = asServant(env, 'finance-servant').firestore();
    await assertSucceeds(getDoc(doc(db, 'bookstoreStats/day-2026-08-30')));
    await assertSucceeds(getDoc(doc(db, 'orders/order-1')));
  });

  it('cannot write either — a report the reported-on can edit is not a report', async () => {
    const db = asServant(env, 'finance-servant').firestore();
    await assertFails(updateDoc(doc(db, 'bookstoreStats/day-2026-08-30'), { revenueCents: 0 }));
    await assertFails(updateDoc(doc(db, 'orders/order-1'), { status: 'refunded' }));
  });

  it('reads the camp and form totals, which is the whole point of them', async () => {
    /*
     * The other half of the pair below, and the two have to be read together.
     *
     * `finance` reaches the camp's money now — but through `financeRollups`,
     * which a Cloud Function writes with the people taken out, and not through
     * the records those figures came from. That distinction is the entire
     * design, so it is asserted twice: once that the door exists, and once that
     * the other one is still shut.
     */
    const db = asServant(env, 'finance-servant').firestore();
    await assertSucceeds(getDoc(doc(db, 'financeRollups/camp__summercamp__2027')));
    await assertSucceeds(getDoc(doc(db, 'financeRollups/form__retreat')));
    /*
     * The screen lists them, and the query it sends is constrained by `kind`.
     *
     * It has to be. The rule narrows this collection by source, a `list` is
     * evaluated against the query's potential results rather than the documents
     * returned, and nothing about a bare `collection()` proves that every
     * document coming back is a kind this reader holds. So the unconstrained
     * read is now refused *for everybody*, including somebody who holds all
     * three — asserted below, because that is the shape of failure a future
     * change to `features/finance/data.ts` would reintroduce.
     */
    await assertSucceeds(getDocs(query(collection(db, 'financeRollups'), where('kind', '==', 'camp'))));
    await assertSucceeds(getDocs(query(collection(db, 'financeRollups'), where('kind', '==', 'form'))));
    await assertFails(getDocs(collection(db, 'financeRollups')));
  });

  it('reaches all three sources when the member document names none', async () => {
    /*
     * The grandfathered shape, and the reason `hasFinance()` reads a missing
     * map as all three rather than as nothing.
     *
     * `finance-servant` is seeded with no `financeScopes` at all — which is
     * every treasurer in the parish on the morning this deploys. Reading that
     * as "no sources" would revoke, silently, a grant somebody made
     * deliberately. `parseFinanceScopes` in packages/shared/src/screens.ts says
     * the same thing in TypeScript and this is the pair of them asserted once.
     */
    const db = asServant(env, 'finance-servant').firestore();
    await assertSucceeds(getDoc(doc(db, 'bookstoreStats/day-2026-08-30')));
    await assertSucceeds(getDoc(doc(db, 'financeRollups/camp__summercamp__2027')));
    await assertSucceeds(getDoc(doc(db, 'financeRollups/form__retreat')));
  });

  it('cannot write a rollup either — the Function is the only author', async () => {
    const db = asServant(env, 'finance-servant').firestore();
    await assertFails(
      updateDoc(doc(db, 'financeRollups/camp__summercamp__2027'), {
        money: { receivedCents: 0, outstandingCents: 0 },
      }),
    );
  });

  /**
   * The mirror image of the test below it, and the pair is the whole model.
   *
   * `camp` and `finance` were separated on 2 Sep 2026 into two grants that both
   * touch the camp's money and touch different halves of it. The camp's back
   * office holds the families — names, grades, allergies, and the fee ledger on
   * the same document, because rules grant documents and not fields. The
   * treasurer holds the totals, with no name in them.
   *
   * So neither can stand in for the other, and this asserts the direction that
   * is easy to lose: somebody running the camp is not thereby a treasurer.
   * /admin/finance is refused them, rollup by rollup, including the camp's own.
   */
  it('the camp’s back office reaches no rollup, not even the camp’s', async () => {
    const db = asServant(env, 'camp-office').firestore();

    // What they do hold. Seeded in the same shape the camp screens read.
    await assertSucceeds(
      getDocs(query(collection(db, 'campRegistrations'), where('programId', '==', 'summercamp'))),
    );

    // And what they do not.
    await assertFails(getDoc(doc(db, 'financeRollups/camp__summercamp__2027')));
    await assertFails(getDocs(query(collection(db, 'financeRollups'), where('kind', '==', 'camp'))));
    await assertFails(getDoc(doc(db, 'bookstoreStats/day-2026-08-30')));
    await assertFails(getDoc(doc(db, 'orders/order-1')));
  });

  /**
   * And it does not reach the forms drawer either.
   *
   * The camp's public sign-up lives at /forms/summer-camp and the hub lists it
   * beside the church's other forms, which makes "whoever runs the camp edits
   * the camp's form" a very easy thing to assume. It is not true and must not
   * become true: the drawer on /forms edits *every* form definition and reads
   * *every* submission behind them — the contact form's messages and the
   * vehicle register among them — so a camp grant that opened it would hand the
   * camp's administrator the parish's whole correspondence.
   *
   * The camp's own settings are `config/camp`, a different rule, which they do
   * hold; and the servant sign-up is not a `forms` document at all.
   */
  it('the camp\u2019s back office cannot read or edit the forms', async () => {
    const db = asServant(env, 'camp-office').firestore();

    /*
     * A form's settings are its own document — the definition, the two flags on
     * the row, and `order`. There is nothing narrower to hold, so all three are
     * refused together, and so is reading one at all.
     */
    await assertFails(getDoc(doc(db, 'forms/vehicle')));
    await assertFails(updateDoc(doc(db, 'forms/vehicle'), { title: 'Vehicles' }));
    await assertFails(updateDoc(doc(db, 'forms/vehicle'), { open: false }));
    await assertFails(updateDoc(doc(db, 'forms/vehicle'), { order: 10 }));
    await assertFails(deleteDoc(doc(db, 'forms/vehicle')));

    // And the replies behind them.
    await assertFails(getDoc(doc(db, 'formSubmissions/sub-1')));
    await assertFails(getDocs(collection(db, 'formSubmissions')));

    // What they do hold, asserted here too so that a change which took the camp
    // away could not make this test pass by leaving them holding nothing.
    await assertSucceeds(
      getDocs(query(collection(db, 'campRegistrations'), where('programId', '==', 'summercamp'))),
    );
  });

  it('still does not reach the camp ledger or the form submissions', async () => {
    /*
     * The line that must not move, asserted rather than merely written down.
     *
     * Camp fees and form totals live inside documents that also hold children's
     * medical notes and people's answers, and Firestore grants documents rather
     * than fields. Building the rollups deliberately did *not* widen these:
     * the totals came out through a Function, precisely so that these two stay
     * refused. If somebody later widens them, this is the test that should stop
     * them and make them say so out loud.
     */
    const db = asServant(env, 'finance-servant').firestore();
    await assertFails(getDoc(doc(db, 'formSubmissions/sub-1')));
    await assertFails(getDocs(collection(db, 'campRegistrations')));
  });
});

describe('the finance grant, narrowed to one source', () => {
  /*
   * ---------------------------------------------------------------------------
   * `financeScopes` — the map that only ever narrows.
   *
   * A parish that wants the bookkeeper to see the shop and not the children's
   * camp fees had no way to say so while `finance` was one boolean, so /access
   * now offers three sources under that row. This suite is what makes them a
   * permission rather than a rendering decision: everything below is asserted
   * against the rules, on the same three collections the screen reads.
   *
   * The three-way split is not arbitrary — it is exactly what
   * `features/finance/data.ts` asks for, one query per source, and the `kind`
   * field is what a `list` can prove.
   * ---------------------------------------------------------------------------
   */
  it('the camp treasurer reads the seasons and not the shop', async () => {
    const db = asServant(env, 'camp-treasurer').firestore();
    await assertSucceeds(getDoc(doc(db, 'financeRollups/camp__summercamp__2027')));
    await assertSucceeds(getDocs(query(collection(db, 'financeRollups'), where('kind', '==', 'camp'))));
    await assertFails(getDoc(doc(db, 'bookstoreStats/day-2026-08-30')));
    await assertFails(getDoc(doc(db, 'orders/order-1')));
    await assertFails(getDoc(doc(db, 'financeRollups/form__retreat')));
    await assertFails(getDocs(query(collection(db, 'financeRollups'), where('kind', '==', 'form'))));
  });

  it('the shop treasurer reads the takings and not the camp', async () => {
    /*
     * `orders` moves with the shop's source rather than with the flag, and that
     * is the one narrowing here that reaches a document with a name on it. The
     * argument on the rule stands — a refund cannot be reconciled without the
     * sale it reverses — but it is an argument about the *bookstore*, so
     * somebody given only the camp has no business in it.
     */
    const db = asServant(env, 'shop-treasurer').firestore();
    await assertSucceeds(getDoc(doc(db, 'bookstoreStats/day-2026-08-30')));
    await assertSucceeds(getDoc(doc(db, 'orders/order-1')));
    await assertFails(getDoc(doc(db, 'financeRollups/camp__summercamp__2027')));
    await assertFails(getDocs(query(collection(db, 'financeRollups'), where('kind', '==', 'camp'))));
  });

  it('all three unticked is a real answer, not an empty map', async () => {
    /*
     * The distinction the whole model rests on. An *absent* map means all three
     * — see the grandfathering test above — and a map that names the three
     * sources `false` means none of them. `keys().hasAny([...])` in the rules
     * and `FINANCE_SOURCES.some(key => key in source)` in TypeScript are the
     * two halves of that sentence; if either is ever rewritten as "is the map
     * empty", this is the test that goes red.
     */
    const db = asServant(env, 'nothing-treasurer').firestore();
    await assertFails(getDoc(doc(db, 'bookstoreStats/day-2026-08-30')));
    await assertFails(getDoc(doc(db, 'financeRollups/camp__summercamp__2027')));
    await assertFails(getDoc(doc(db, 'financeRollups/form__retreat')));
  });

  it('a source without the finance grant opens nothing', async () => {
    /*
     * The map narrows and never widens. `hasFinance()` asks
     * `screenFlag('finance')` first for exactly this reason: a ticked source is
     * not a second door onto the church's money, and an administrator who
     * ticked the sources and forgot the row above has given nothing away.
     */
    const db = asServant(env, 'scoped-nobody').firestore();
    await assertFails(getDoc(doc(db, 'bookstoreStats/day-2026-08-30')));
    await assertFails(getDoc(doc(db, 'financeRollups/camp__summercamp__2027')));
    await assertFails(getDoc(doc(db, 'financeRollups/form__retreat')));
  });

  it('cannot be widened by the person it narrows', async () => {
    /*
     * `financeScopes` is pinned against a self-write exactly as `screenAdmin`
     * is. Without it the camp treasurer hands themselves the shop's orders by
     * editing their own profile, which is the same escalation the two maps
     * beside it were pinned to prevent.
     */
    const db = asServant(env, 'camp-treasurer').firestore();
    await assertFails(
      updateDoc(doc(db, 'members/camp-treasurer'), {
        financeScopes: { bookstore: true, camp: true, forms: true },
      }),
    );
    // ...and may still edit their own name, with the map left alone.
    await assertSucceeds(
      updateDoc(doc(db, 'members/camp-treasurer'), { displayName: 'The camp treasurer' }),
    );
  });

  it('is a superadmin\u2019s to set, and does not narrow the superadmin', async () => {
    const db = asSuper(env).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'members/camp-treasurer'), {
        financeScopes: { bookstore: false, camp: true, forms: true },
      }),
    );
    // The claim short-circuits every source, as it does every screen.
    await assertSucceeds(getDoc(doc(db, 'bookstoreStats/day-2026-08-30')));
    await assertSucceeds(getDoc(doc(db, 'financeRollups/form__retreat')));
  });
});

describe('the rollups are not open to everybody', () => {
  it('a servant with no finance grant is refused', async () => {
    const db = asServant(env, 'plain-servant').firestore();
    await assertFails(getDoc(doc(db, 'financeRollups/camp__summercamp__2027')));
    // Constrained by `kind`, so this is a denial about the grant and not about
    // the query shape — a bare `collection()` is refused for everybody now.
    await assertFails(getDocs(query(collection(db, 'financeRollups'), where('kind', '==', 'camp'))));
  });

  it('so is the bookstore volunteer, whose grant is the shop and not the church', async () => {
    /*
     * `bookstoreStats` admits the bookstore group and the bookstore flag,
     * because those figures are the shop's own. These are not: a camp season's
     * fees are nothing to do with the person packing parcels, and the rule is
     * `hasScreen('finance')` alone rather than the three-way one above it.
     */
    const db = asServant(env, 'bookstore-servant').firestore();
    await assertSucceeds(getDoc(doc(db, 'bookstoreStats/day-2026-08-30')));
    await assertFails(getDoc(doc(db, 'financeRollups/camp__summercamp__2027')));
  });
});

describe('the bookstore grant', () => {
  /*
   * The one that was a broken promise until the rules caught up. /access offers
   * Bookstore as "the orders queue, the sales figures, and how the shop's
   * shelves are arranged", and `products` and `config/bookstore` were still
   * `hasRole('staff')` — so the grant drew every control and refused every save.
   */
  it('arranges the shelves, which is the half that used to be refused', async () => {
    const db = asServant(env, 'bookstore-servant').firestore();
    // `updatedBy` is not decoration. `products` has no broad `allow write` any
    // more — see the long note on that collection in firestore.rules — so the
    // only way in is the bounded rule, which requires all three keys and pins
    // `updatedBy` to the caller. Without it this fails with "Property updatedBy
    // is undefined", which reads like a missing grant and is a missing field.
    await assertSucceeds(
      updateDoc(doc(db, 'products/holy-bible'), {
        section: 'icons',
        updatedAt: 1,
        updatedBy: 'bookstore-servant',
      }),
    );
    await assertSucceeds(
      setDoc(doc(db, 'config/bookstore'), {
        sections: [{ id: 'icons', label: 'Icons' }],
        updatedAt: 1,
        updatedBy: 'bookstore-servant',
      }),
    );
  });

  it('advances an order and reads the takings', async () => {
    const db = asServant(env, 'bookstore-servant').firestore();
    await assertSucceeds(getDoc(doc(db, 'orders/order-1')));
    await assertSucceeds(getDoc(doc(db, 'bookstoreStats/day-2026-08-30')));
    await assertSucceeds(
      updateDoc(doc(db, 'orders/order-1'), {
        fulfillment: 'ready',
        updatedAt: 1,
        updatedBy: 'bookstore-servant',
      }),
    );
  });
});

describe('finance is narrower than bookstore, on purpose', () => {
  it('reads an order but cannot advance it, and cannot touch the catalog', async () => {
    // Reading the books is not running the shop. This is the split that
    // `useBookstoreAdmin` mirrors with `canReview` vs `canEdit` — a treasurer
    // shown the shelf editor would be a treasurer whose every save is refused.
    const db = asServant(env, 'finance-servant').firestore();
    await assertSucceeds(getDoc(doc(db, 'orders/order-1')));
    await assertFails(
      updateDoc(doc(db, 'orders/order-1'), {
        fulfillment: 'ready',
        updatedAt: 1,
        updatedBy: 'finance-servant',
      }),
    );
    await assertFails(updateDoc(doc(db, 'products/holy-bible'), { section: 'icons' }));
  });
});

describe('the bulletin grant', () => {
  it('reads an unpublished announcement and writes it', async () => {
    const db = asServant(env, 'bulletin-servant').firestore();
    await assertSucceeds(getDoc(doc(db, 'announcements/notice-1')));
    await assertSucceeds(updateDoc(doc(db, 'announcements/notice-1'), { title: 'Vespers 6pm' }));
  });
});

describe('the parking grant', () => {
  it('reads the plate register and removes an entry', async () => {
    const db = asServant(env, 'parking-servant').firestore();
    await assertSucceeds(getDocs(collection(db, 'vehicles')));
    await assertSucceeds(updateDoc(doc(db, 'vehicles/car-1'), { active: false }));
  });

  it('is refused to a servant without it — a plate list is not browsable', async () => {
    const db = asServant(env, 'plain-servant').firestore();
    await assertFails(getDocs(collection(db, 'vehicles')));
  });
});

describe('the servants grant', () => {
  it('writes the rota', async () => {
    const db = asServant(env, 'rota-servant').firestore();
    await assertSucceeds(updateDoc(doc(db, 'servantEvents/rota-1'), { title: 'Altar, 9am' }));
  });

  it('leaves reading the rota to the plain role, as it always was', async () => {
    // Needing a grant to see when you are serving would be exactly backwards.
    const db = asServant(env, 'plain-servant').firestore();
    await assertSucceeds(getDoc(doc(db, 'servantEvents/rota-1')));
    await assertFails(updateDoc(doc(db, 'servantEvents/rota-1'), { title: 'Mine' }));
  });

  it('does not reach the public calendar, which is the events grant', async () => {
    const db = asServant(env, 'rota-servant').firestore();
    await assertFails(updateDoc(doc(db, 'scheduleEntries/entry-1'), { title: 'Moved' }));
  });
});

describe('the events grant covers the calendar’s two editable layers', () => {
  it('writes scheduleEntries and calendarDetails', async () => {
    const db = asServant(env, 'events-servant').firestore();
    await assertSucceeds(updateDoc(doc(db, 'scheduleEntries/entry-1'), { title: 'Moved' }));
    await assertSucceeds(updateDoc(doc(db, 'calendarDetails/occ-1'), { note: 'Cancelled' }));
  });
});

describe('the theme grant reaches only the theme', () => {
  it('lets the flag-holder write the design tokens', async () => {
    const db = asServant(env, 'theme-servant').firestore();
    await assertSucceeds(updateDoc(doc(db, 'config/theme'), { tokens: { hue: 1 } }));
  });

  /*
   * `config/theme` is carved out of the `config` block so this grant can reach
   * it, and the carve-out has to be exact in both directions: the theme flag
   * must not open the rest of `config`, and no other flag may open the theme.
   *
   * This was `hasStrictScreen()` and a `staff` assertion, from when honouring a
   * flag through the ordinary helper would have handed the design tokens to the
   * whole staff. There is no tier now and the two helpers collapsed into one —
   * so what needs asserting is the document boundary rather than the tier.
   */
  it('does not open the rest of config', async () => {
    const db = asServant(env, 'theme-servant').firestore();
    await assertFails(updateDoc(doc(db, 'config/integrations'), { livestream: {} }));
  });

  it('is not opened by holding some other area', async () => {
    const db = asServant(env, 'content-servant').firestore();
    await assertFails(updateDoc(doc(db, 'config/theme'), { tokens: { hue: 2 } }));
  });

  it('still belongs to a superadmin', async () => {
    const db = asSuper(env).firestore();
    await assertSucceeds(updateDoc(doc(db, 'config/theme'), { tokens: { hue: 3 } }));
  });
});

describe('the two screens that are deliberately not delegable', () => {
  it('ignores a members flag — the power to grant stays with the claim', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'members/would-be-granter'),
        {
          displayName: 'would-be-granter',
          email: 'wbg@spsmwayland.org',
          screenAdmin: { members: true, config: true },
          programAdmin: { programs: [], events: [] },
        },
      );
    });

    const db = asServant(env, 'would-be-granter').firestore();
    await assertFails(
      updateDoc(doc(db, 'members/plain-servant'), { screenAdmin: { finance: true } }),
    );
    await assertFails(updateDoc(doc(db, 'config/integrations'), { livestream: {} }));
  });
});

describe('granting', () => {
  it('is a superadmin’s alone', async () => {
    const db = asSuper(env).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'members/plain-servant'), {
        screenAdmin: { forms: true },
        programAdmin: { programs: ['summercamp'], events: [] },
      }),
    );
  });

  /**
   * The directory itself narrowed with the ladder, and this is where that shows.
   *
   * `members` read was `isSelf(uid) || hasRole('staff')`, which handed the whole
   * administrative tier everybody's phone number and email for no caller that
   * wanted it: the only screen that reads another person's member document is
   * /access, and /access is the superadmin's. So the rule is `isSelf(uid) ||
   * isSuper()` now, and holding every area on the allocation screen does not
   * open the list it is drawn from.
   */
  it('is refused to an allocated administrator, who cannot even read the directory', async () => {
    const db = asServant(env, 'forms-servant').firestore();
    await assertFails(getDocs(collection(db, 'members')));
    await assertFails(
      updateDoc(doc(db, 'members/plain-servant'), { screenAdmin: { finance: true } }),
    );
  });

  it('lets the superadmin read the directory the screen is drawn from', async () => {
    await assertSucceeds(getDocs(collection(asSuper(env).firestore(), 'members')));
  });

  it('cannot be done to oneself', async () => {
    // The escalation this whole axis would otherwise be. A member may edit
    // their own profile, and both permission maps must come back byte-identical
    // across that edit — `programAdmin` especially, since the gallery and camp
    // rules read it through `get()` and it is the one permission a self-written
    // member document could actually exercise.
    const db = asServant(env, 'self-servant').firestore();
    await assertFails(
      updateDoc(doc(db, 'members/self-servant'), { screenAdmin: { finance: true } }),
    );
    await assertFails(
      updateDoc(doc(db, 'members/self-servant'), {
        programAdmin: { programs: ['summercamp'], events: [] },
      }),
    );
  });

  it('still lets somebody edit their own name without touching their grants', async () => {
    // The other half of the same rule, and the reason it is an equality check
    // rather than a blanket refusal: a member owns their profile.
    const db = asServant(env, 'self-servant').firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'members/self-servant'), { displayName: 'Mina G' }),
    );
  });
});

describe('a superadmin with no member document', () => {
  /*
   * `admin-1` is deliberately absent from `members`. Every rule below routes
   * through `hasScreen()`, which does a `get()` on that document — and a `get()`
   * on a document that is not there is an evaluation error, which denies.
   *
   * The `exists()` guard is what stops that, and this is the test for it. It
   * matters because the account it protects is the one that cannot be rescued:
   * the first superadmin is created by `scripts/grant-admin.mjs`, which sets a
   * claim and writes no profile.
   */
  it('still reaches every area', async () => {
    const db = asSuper(env).firestore();
    await assertSucceeds(getDoc(doc(db, 'formSubmissions/sub-1')));
    await assertSucceeds(updateDoc(doc(db, 'content/our-belief'), { body: 'Edited' }));
    await assertSucceeds(updateDoc(doc(db, 'events/liturgy-1'), { title: 'Divine Liturgy' }));
    await assertSucceeds(getDoc(doc(db, 'bookstoreStats/day-2026-08-30')));
  });
});

/**
 * The direction the model changed, asserted rather than described.
 *
 * These flags used to *grant and never revoke*: every rule read "staff, or
 * specifically entrusted with this", so a flag added one person to a tier that
 * already had the door open. This suite once held a test called "leaves staff
 * with everything, holding no flags at all" for exactly that reason.
 *
 * The tier is gone, so the flag is the door — and what needs asserting now is
 * the opposite property: that a signed-in parish account with no allocation
 * reaches nothing. It is the state almost every account on this site is in.
 */
describe('signing in, on its own, is worth nothing but the rota', () => {
  it('reaches no administrative screen at all', async () => {
    // `nothing-servant`, not `plain-servant`: the granting suite above hands
    // `plain-servant` the forms flag, and a suite that measured against them
    // would pass or fail depending on which order vitest ran the describes in.
    // The same trap the `self-servant` fixture exists for.
    const db = asSignedIn(env, 'nothing-servant').firestore();
    await assertFails(getDoc(doc(db, 'formSubmissions/sub-1')));
    await assertFails(updateDoc(doc(db, 'content/our-belief'), { body: 'Not mine to edit' }));
    await assertFails(updateDoc(doc(db, 'events/liturgy-1'), { title: 'Not mine either' }));
    await assertFails(getDoc(doc(db, 'orders/order-1')));
    await assertFails(getDoc(doc(db, 'bookstoreStats/day-2026-08-30')));
    await assertFails(getDocs(collection(db, 'members')));
  });

  /**
   * …and the one thing it *is* worth.
   *
   * `servantEvents` is `isPerson()`, which is the whole of what an account buys:
   * needing an allocation to see when you are serving would be exactly
   * backwards. If this ever starts failing, the model has lost its floor.
   *
   * The pair to this is in "an anonymous upload session" below, and neither
   * test means much alone: this one says an account with nothing still reads
   * the rota, that one says a token with nothing behind it does not.
   */
  it('reads the servants’ rota', async () => {
    const db = asSignedIn(env, 'nothing-servant').firestore();
    await assertSucceeds(getDoc(doc(db, 'servantEvents/rota-1')));
  });
});

/**
 * An anonymous upload session, which holds a token and is nobody.
 *
 * ---------------------------------------------------------------------------
 * The Anonymous provider was enabled on this project on 2026-09-04 so that
 * parishioners without accounts could send photographs to the galleries. It had
 * to be — sign-in is Microsoft-only against the church's Entra tenant, so the
 * people who *can* hold an account are clergy, staff and servants, precisely
 * not the grandmother with forty photographs of the camp.
 *
 * The cost of that switch is these tests. Every rule on this site that said
 * "signed in" was written while anonymous sign-in was impossible, so it meant
 * "in the church directory" without having to say so. That inference is dead.
 * An anonymous uid is free and anybody can mint one from a browser console with
 * the web API key, which is in the public bundle by design and cannot not be.
 *
 * The rota is the collection this would have cost. `servantEvents` is read by
 * anybody with an account on purpose, and for one day it was readable by
 * anybody at all — every servant's name against every date they are down to
 * serve, to whoever asked. `isPerson()` is what keeps the two apart, and it is
 * asserted here rather than described because `rules:check` compiles a policy
 * that denies nothing and calls it a pass.
 * ---------------------------------------------------------------------------
 */
describe('an anonymous upload session', () => {
  it('cannot read the servants’ rota', async () => {
    const db = asAnonymousSession(env).firestore();
    await assertFails(getDoc(doc(db, 'servantEvents/rota-1')));
  });

  it('cannot write it either, which was never in doubt', async () => {
    const db = asAnonymousSession(env).firestore();
    await assertFails(updateDoc(doc(db, 'servantEvents/rota-1'), { title: 'Mine' }));
  });

  it('buys nothing else a stranger did not already have', async () => {
    // The same denials `asAnon` gets. If any of these ever starts passing, a
    // rule has been written with `signedIn()` where it meant `isPerson()`.
    const db = asAnonymousSession(env).firestore();
    await assertFails(getDoc(doc(db, 'formSubmissions/sub-1')));
    await assertFails(getDoc(doc(db, 'vehicles/car-1')));
    await assertFails(getDocs(collection(db, 'members')));
    await assertFails(updateDoc(doc(db, 'config/theme'), { tokens: { hue: 9 } }));
  });

  it('still reads what the public reads, so the galleries keep working', async () => {
    // The other direction, and the reason this is not simply "deny anonymous
    // everywhere": the upload form runs under this session and its page has to
    // render. A regression here empties the gallery pages for uploaders only.
    const db = asAnonymousSession(env).firestore();
    await assertSucceeds(getDoc(doc(db, 'events/liturgy-1')));
    await assertSucceeds(getDoc(doc(db, 'scheduleEntries/entry-1')));
  });
});

describe('the public is unaffected', () => {
  it('still reads the calendar and a published form without signing in', async () => {
    // The regression that would matter most: `hasScreen()` is now in the read
    // rule for `content`, and the static export reads these anonymously at
    // build time. A rule that denied an anonymous read would empty the site.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'content/published-page'), {
        title: 'Who we are',
        published: true,
      });
      await setDoc(doc(context.firestore(), 'forms/open-form'), {
        slug: 'open-form',
        title: 'Open',
        published: true,
        fields: [],
      });
    });

    const db = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, 'content/published-page')));
    await assertSucceeds(getDoc(doc(db, 'forms/open-form')));
    await assertSucceeds(getDoc(doc(db, 'events/liturgy-1')));
    expect(true).toBe(true);
  });
});
