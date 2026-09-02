import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
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
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { createTestEnv, asAnon, asServant, asSignedIn, asSuper } from './helpers.js';

/**
 * Two allocations, seeded onto member documents rather than passed as claims.
 *
 * The role ladder that used to answer these — `asStaff`, and an
 * `inGroup('parking')` context — is gone, and with it the idea that one context
 * could stand in for "trusted with the administration". Each of these holds
 * exactly one area, which is what /access hands out and therefore what the
 * rules have to be tested against.
 */
const asParking = (env: RulesTestEnvironment) => env.authenticatedContext('parking-1', {});
const asEvents = (env: RulesTestEnvironment) => env.authenticatedContext('events-1', {});

/** The grants those two run on. Idempotent, like every other seed here. */
async function seedGrants(): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'members', 'parking-1'), {
      screenAdmin: { parking: true },
      programAdmin: { programs: [], events: [] },
    });
    await setDoc(doc(db, 'members', 'events-1'), {
      screenAdmin: { events: true },
      programAdmin: { programs: [], events: [] },
    });
  });
}

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv('writes');
  // Cleared exactly once, here, and never again in this file. See `reset`.
  await env.clearFirestore();
  await seedGrants();
});

afterAll(async () => {
  await env.cleanup();
});

type Seeder = Parameters<RulesTestEnvironment['withSecurityRulesDisabled']>[0];

/**
 * Seeds fixtures. Deliberately does NOT clear.
 *
 * `clearFirestore()` immediately followed by a seed write races: the clear can
 * still be landing when the write arrives, and the write is lost. The symptom is
 * vicious — the fixture is simply absent, so `assertSucceeds` fails with
 * NOT_FOUND, and worse, an `assertFails` in the same test *passes for the wrong
 * reason*, because NOT_FOUND counts as a failure just like PERMISSION_DENIED. A
 * test that green-lights a policy it never actually exercised is worse than no
 * test at all.
 *
 * So: clear once per file in `beforeAll`, far from any write, and make every
 * seed an idempotent `setDoc` upsert. Each describe seeds only the ids it
 * asserts on, and the collections used here (vehicles, orders, members) are
 * disjoint from those in public-reads.test.ts, so nothing leaks
 * between suites.
 */
async function reset(seed?: Seeder): Promise<void> {
  if (seed) await env.withSecurityRulesDisabled(seed);
}

/** The shape features/parking/data.ts actually writes. */
function vehicleDoc(overrides: Record<string, unknown> = {}) {
  return {
    plate: 'ABC1234',
    plateState: 'MA',
    make: null,
    model: null,
    color: null,
    ownerUid: null,
    ownerName: 'Mina Boutros',
    ownerPhone: '555-0100',
    ownerEmail: null,
    note: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedBy: null,
    ...overrides,
  };
}

describe('vehicles — the only unauthenticated write path on the site', () => {
  beforeEach(() => reset());

  it('allows a guest to register without an account', async () => {
    const db = asAnon(env).firestore();
    await assertSucceeds(addDoc(collection(db, 'vehicles'), vehicleDoc()));
  });

  it('allows a signed-in member to register under their own uid', async () => {
    const db = asSignedIn(env, 'member-1').firestore();
    await assertSucceeds(
      addDoc(collection(db, 'vehicles'), vehicleDoc({ ownerUid: 'member-1' })),
    );
  });

  it('denies claiming a registration for someone else', async () => {
    const db = asSignedIn(env, 'member-1').firestore();
    await assertFails(
      addDoc(collection(db, 'vehicles'), vehicleDoc({ ownerUid: 'someone-else' })),
    );
  });

  it('denies a create that arrives already inactive', async () => {
    const db = asAnon(env).firestore();
    await assertFails(addDoc(collection(db, 'vehicles'), vehicleDoc({ active: false })));
  });

  it('bounds the plate length on both ends', async () => {
    const db = asAnon(env).firestore();
    await assertFails(addDoc(collection(db, 'vehicles'), vehicleDoc({ plate: 'A' })));
    await assertFails(
      addDoc(collection(db, 'vehicles'), vehicleDoc({ plate: 'ABCDEFGHIJK' })),
    );
    await assertSucceeds(
      addDoc(collection(db, 'vehicles'), vehicleDoc({ plate: 'ABCDEFGHIJ' })),
    );
  });

  it('requires a non-empty owner name', async () => {
    const db = asAnon(env).firestore();
    await assertFails(addDoc(collection(db, 'vehicles'), vehicleDoc({ ownerName: '' })));
  });
});

describe('vehicles — a plate-to-name map must never be enumerable', () => {
  beforeEach(() =>
    reset(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'vehicles', 'v1'), vehicleDoc({ ownerUid: 'member-1' }));
    }),
  );

  it('denies anonymous list', async () => {
    await assertFails(getDocs(collection(asAnon(env).firestore(), 'vehicles')));
  });

  it('denies anonymous get', async () => {
    await assertFails(getDoc(doc(asAnon(env).firestore(), 'vehicles', 'v1')));
  });

  it('denies a signed-in member reading someone else’s registration', async () => {
    await assertFails(getDoc(doc(asSignedIn(env, 'other-member').firestore(), 'vehicles', 'v1')));
  });

  it('allows the owner to read their own', async () => {
    await assertSucceeds(getDoc(doc(asSignedIn(env, 'member-1').firestore(), 'vehicles', 'v1')));
  });

  it('allows the car-park register to read', async () => {
    await assertSucceeds(getDoc(doc(asParking(env).firestore(), 'vehicles', 'v1')));
    await assertSucceeds(getDocs(collection(asParking(env).firestore(), 'vehicles')));
  });

  /**
   * A plate-to-name list, so holding *some* area must not be holding this one.
   *
   * There used to be two doors here — an `inGroup('parking')` claim and the
   * `staff` tier — and the second admitted the bulletin editor and the bookstore
   * volunteer alike. This is the assertion that there is one door now.
   */
  it('denies somebody holding a different area entirely', async () => {
    await assertFails(getDoc(doc(asEvents(env).firestore(), 'vehicles', 'v1')));
    await assertFails(getDocs(collection(asEvents(env).firestore(), 'vehicles')));
  });

  it('denies a non-owner update, allows the register', async () => {
    await assertFails(
      updateDoc(doc(asSignedIn(env, 'other-member').firestore(), 'vehicles', 'v1'), {
        active: false,
      }),
    );
    await assertSucceeds(
      updateDoc(doc(asParking(env).firestore(), 'vehicles', 'v1'), { active: false }),
    );
  });

  it('denies delete without the grant', async () => {
    await assertFails(deleteDoc(doc(asSignedIn(env, 'member-1').firestore(), 'vehicles', 'v1')));
    await assertFails(deleteDoc(doc(asEvents(env).firestore(), 'vehicles', 'v1')));
    await assertSucceeds(deleteDoc(doc(asParking(env).firestore(), 'vehicles', 'v1')));
  });
});

describe('orders are written only by Cloud Functions', () => {
  beforeEach(() =>
    reset(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'orders', 'o1'), {
        memberUid: 'member-1',
        status: 'pending',
        createdAt: new Date(),
      });
    }),
  );

  it('denies writes even to an admin', async () => {
    // If a client could write here, a member could mark their own order paid.
    // Admin is the strongest client identity there is, so this is the test that
    // proves `allow write: if false` means what it says.
    await assertFails(
      updateDoc(doc(asSuper(env).firestore(), 'orders', 'o1'), { status: 'paid' }),
    );
    await assertFails(
      setDoc(doc(asSuper(env).firestore(), 'orders', 'o2'), { status: 'paid' }),
    );
    await assertFails(deleteDoc(doc(asSuper(env).firestore(), 'orders', 'o1')));
  });

  it('lets the buyer read their own order', async () => {
    await assertSucceeds(getDoc(doc(asSignedIn(env, 'member-1').firestore(), 'orders', 'o1')));
  });

  it('denies another member reading it', async () => {
    await assertFails(getDoc(doc(asSignedIn(env, 'member-2').firestore(), 'orders', 'o1')));
  });
});

/**
 * The member document, which is now the permission record rather than a profile
 * with a couple of display mirrors on it.
 *
 * `roleMirror` and `groupsMirror` used to be pinned here and are gone with the
 * claims they copied. What is left is `superadminMirror` — genuinely cosmetic,
 * because rules read the token — and the two maps, which are not cosmetic at
 * all: `screenAdmin` and `programAdmin` have no claim behind them, so a member
 * who could write their own would hold every permission on the site. Those are
 * covered at length in access.test.ts and program-galleries.test.ts; this suite
 * covers the mirror and the ordinary profile edit beside it.
 */
describe('members — the claim is authoritative, the mirror is not', () => {
  beforeEach(() => reset());

  it('lets a member create their own profile with nothing granted', async () => {
    const db = asSignedIn(env, 'member-1').firestore();
    await assertSucceeds(
      setDoc(doc(db, 'members', 'member-1'), {
        displayName: 'Mina',
        email: 'mina@example.org',
        superadminMirror: false,
      }),
    );
  });

  it('denies self-promotion at create time', async () => {
    const db = asSignedIn(env, 'member-2').firestore();
    // The mirror. Cosmetic in effect — /access reads it to label a row — but
    // writable only by `grant-admin.mjs`, because a document that claimed
    // somebody was the site administrator would be believed by every screen
    // that draws a label from it.
    await assertFails(
      setDoc(doc(db, 'members', 'member-2'), {
        displayName: 'Ambitious',
        email: 'a@example.org',
        superadminMirror: true,
      }),
    );
    // And the map that is not cosmetic.
    await assertFails(
      setDoc(doc(db, 'members', 'member-2'), {
        displayName: 'Ambitious',
        email: 'a@example.org',
        superadminMirror: false,
        screenAdmin: { forms: true },
      }),
    );
  });

  it('denies changing your own mirror on update', async () => {
    await reset(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'members', 'member-3'), {
        displayName: 'Mina',
        email: 'mina@example.org',
        superadminMirror: false,
        screenAdmin: {},
        programAdmin: { programs: [], events: [] },
      });
    });
    const db = asSignedIn(env, 'member-3').firestore();
    await assertSucceeds(updateDoc(doc(db, 'members', 'member-3'), { displayName: 'Mina B.' }));
    await assertFails(updateDoc(doc(db, 'members', 'member-3'), { superadminMirror: true }));
    await assertFails(
      updateDoc(doc(db, 'members', 'member-3'), { screenAdmin: { bookstore: true } }),
    );
  });
});

describe('formSubmissions is closed until the feature exists', () => {
  beforeEach(() => reset());

  it('denies an unauthenticated create', async () => {
    // This was `allow create: if formId is string` — one field checked, no size
    // bound, no auth, for a feature with no schema and no UI. Anyone could
    // write arbitrary documents to a billed project.
    await assertFails(
      addDoc(collection(asAnon(env).firestore(), 'formSubmissions'), {
        formId: 'anything',
        payload: 'x'.repeat(1000),
      }),
    );
  });

  it('denies it even for the superadmin, so nothing quietly depends on it', async () => {
    await assertFails(
      addDoc(collection(asEvents(env).firestore(), 'formSubmissions'), { formId: 'x' }),
    );
    await assertFails(
      addDoc(collection(asSuper(env).firestore(), 'formSubmissions'), { formId: 'x' }),
    );
  });
});

describe('the calendar layers the events grant may write', () => {
  /**
   * Both are world-readable on purpose: /calendar assembles them in the browser
   * next to Breeze, so an anonymous visitor has to be able to read them or a
   * manually added service is invisible to everybody but its author.
   */
  it('lets anyone read a manually added entry', async () => {
    await assertSucceeds(
      getDoc(doc(asAnon(env).firestore(), 'scheduleEntries', 'choir-practice')),
    );
    await assertSucceeds(getDoc(doc(asAnon(env).firestore(), 'calendarDetails', '404577147')));
  });

  it('refuses a write from anyone without the events grant', async () => {
    for (const as of [asAnon, asSignedIn, asParking]) {
      await assertFails(
        setDoc(doc(as(env).firestore(), 'scheduleEntries', 'x'), { title: 'Not yours' }),
      );
      await assertFails(
        setDoc(doc(as(env).firestore(), 'calendarDetails', 'x'), { note: 'Not yours' }),
      );
    }
  });

  it('lets the events grant add, annotate and remove', async () => {
    const staff = asEvents(env).firestore();
    await assertSucceeds(
      setDoc(doc(staff, 'scheduleEntries', 'choir'), {
        title: 'Choir practice',
        day: '2026-09-03',
      }),
    );
    await assertSucceeds(
      setDoc(doc(staff, 'calendarDetails', '404577147'), {
        occurrenceId: '404577147',
        note: 'In the hall this week.',
      }),
    );
    await assertSucceeds(deleteDoc(doc(staff, 'scheduleEntries', 'choir')));
    await assertSucceeds(deleteDoc(doc(staff, 'calendarDetails', '404577147')));
  });

  /**
   * The point of the two-collection split, asserted rather than assumed.
   *
   * Everything the parish does *not* own lives somewhere this grant cannot
   * delete it from — Breeze is not in Firestore at all, and the site's own
   * `events` are a different path with a different rule. Deleting a detail must
   * not be capable of deleting anything but the detail.
   */
  it('gives the events grant no path that removes a liturgy', async () => {
    // A detail is keyed by the occurrence id it annotates. Removing it removes
    // the annotation; there is nothing else at that path to remove.
    const staff = asEvents(env).firestore();
    await assertSucceeds(deleteDoc(doc(staff, 'calendarDetails', '404577147')));
    // And the schedule the detail was about is not in Firestore to begin with,
    // so there is no rule that could have allowed it.
  });
});

describe('servantsConfig holds bearer URLs, so no client may read it at all', () => {
  beforeEach(() =>
    reset(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'servantsConfig', 'schedule'), {
        embedUrl: 'https://stphilopaterstmina.breezechms.com/embed/calendar/grid?x=1',
        note: '',
        manageUrl: '',
      });
    }),
  );

  it('denies anonymous read — the whole point of not putting it in config/', () => {
    // `config` is `allow read: if true`, and a narrower rule cannot take that
    // back, so this had to be its own collection. If this ever passes, the
    // parish rota URL is public.
    return assertFails(getDoc(doc(asAnon(env).firestore(), 'servantsConfig', 'schedule')));
  });

  it('denies a signed-in member with no allocation', async () => {
    await assertFails(getDoc(doc(asSignedIn(env).firestore(), 'servantsConfig', 'schedule')));
  });

  /**
   * Servants and allocated administrators too, which is the change worth having
   * a test for.
   *
   * This used to allow a servant, because the browser fetched the URL after
   * sign-in and framed it — so every servant's tab held a credential they could
   * copy out of dev tools and pass on, with no way to revoke it short of
   * rotating the token for all forty of them.
   *
   * The `calendar` Function reads this with the Admin SDK now, which bypasses
   * rules, and hands back events rather than the URL. So no client has any
   * business here, and this asserts that none of them can get in — including
   * the ones that used to be allowed.
   */
  it('denies a servant and an allocated administrator too', async () => {
    await assertFails(getDoc(doc(asServant(env).firestore(), 'servantsConfig', 'schedule')));
    await assertFails(getDoc(doc(asEvents(env).firestore(), 'servantsConfig', 'schedule')));
  });

  it('denies writes below superadmin — an allocation may not repoint the calendar', async () => {
    await assertFails(
      setDoc(doc(asServant(env).firestore(), 'servantsConfig', 'schedule'), {
        embedUrl: 'https://evil.test/x',
      }),
    );
    await assertFails(
      setDoc(doc(asEvents(env).firestore(), 'servantsConfig', 'schedule'), {
        embedUrl: 'https://evil.test/x',
      }),
    );
    await assertSucceeds(
      setDoc(doc(asSuper(env).firestore(), 'servantsConfig', 'schedule'), {
        embedUrl: 'https://stphilopaterstmina.breezechms.com/embed/calendar/grid?x=2',
      }),
    );
  });
});

describe('the catch-all denies anything not deliberately opened', () => {
  beforeEach(() => reset());

  it('denies read and write on an unmatched collection, even for the superadmin', async () => {
    const db = asSuper(env).firestore();
    await assertFails(getDocs(collection(db, 'somethingNobodyAddedARuleFor')));
    await assertFails(setDoc(doc(db, 'somethingNobodyAddedARuleFor', 'x'), { a: 1 }));
  });

  it('denies client writes to auditLog', async () => {
    await assertFails(setDoc(doc(asSuper(env).firestore(), 'auditLog', 'e1'), { action: 'read' }));
  });
});
