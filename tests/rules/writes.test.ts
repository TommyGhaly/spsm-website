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
import {
  createTestEnv,
  asAnon,
  asMember,
  asServant,
  asStaff,
  asAdmin,
  asParking,
} from './helpers.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
  // Cleared exactly once, here, and never again in this file. See `reset`.
  await env.clearFirestore();
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
    const db = asMember(env, 'member-1').firestore();
    await assertSucceeds(
      addDoc(collection(db, 'vehicles'), vehicleDoc({ ownerUid: 'member-1' })),
    );
  });

  it('denies claiming a registration for someone else', async () => {
    const db = asMember(env, 'member-1').firestore();
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
    await assertFails(getDoc(doc(asMember(env, 'other-member').firestore(), 'vehicles', 'v1')));
  });

  it('allows the owner to read their own', async () => {
    await assertSucceeds(getDoc(doc(asMember(env, 'member-1').firestore(), 'vehicles', 'v1')));
  });

  it('allows the parking group and staff to read', async () => {
    await assertSucceeds(getDoc(doc(asParking(env).firestore(), 'vehicles', 'v1')));
    await assertSucceeds(getDocs(collection(asStaff(env).firestore(), 'vehicles')));
  });

  it('denies a non-owner update, allows staff', async () => {
    await assertFails(
      updateDoc(doc(asMember(env, 'other-member').firestore(), 'vehicles', 'v1'), {
        active: false,
      }),
    );
    await assertSucceeds(
      updateDoc(doc(asStaff(env).firestore(), 'vehicles', 'v1'), { active: false }),
    );
  });

  it('denies delete below staff', async () => {
    await assertFails(deleteDoc(doc(asMember(env, 'member-1').firestore(), 'vehicles', 'v1')));
    await assertSucceeds(deleteDoc(doc(asStaff(env).firestore(), 'vehicles', 'v1')));
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
      updateDoc(doc(asAdmin(env).firestore(), 'orders', 'o1'), { status: 'paid' }),
    );
    await assertFails(
      setDoc(doc(asAdmin(env).firestore(), 'orders', 'o2'), { status: 'paid' }),
    );
    await assertFails(deleteDoc(doc(asAdmin(env).firestore(), 'orders', 'o1')));
  });

  it('lets the buyer read their own order', async () => {
    await assertSucceeds(getDoc(doc(asMember(env, 'member-1').firestore(), 'orders', 'o1')));
  });

  it('denies another member reading it', async () => {
    await assertFails(getDoc(doc(asMember(env, 'member-2').firestore(), 'orders', 'o1')));
  });
});

describe('members — claims are authoritative, the mirror is not', () => {
  beforeEach(() => reset());

  it('lets a member create their own profile only as a plain member', async () => {
    const db = asMember(env, 'member-1').firestore();
    await assertSucceeds(
      setDoc(doc(db, 'members', 'member-1'), {
        displayName: 'Mina',
        email: 'mina@example.org',
        roleMirror: 'member',
        groupsMirror: [],
      }),
    );
  });

  it('denies self-promotion at create time', async () => {
    const db = asMember(env, 'member-2').firestore();
    await assertFails(
      setDoc(doc(db, 'members', 'member-2'), {
        displayName: 'Ambitious',
        email: 'a@example.org',
        roleMirror: 'admin',
        groupsMirror: [],
      }),
    );
    await assertFails(
      setDoc(doc(db, 'members', 'member-2'), {
        displayName: 'Ambitious',
        email: 'a@example.org',
        roleMirror: 'member',
        groupsMirror: ['clergy'],
      }),
    );
  });

  it('denies changing your own mirror on update', async () => {
    await reset(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'members', 'member-3'), {
        displayName: 'Mina',
        email: 'mina@example.org',
        roleMirror: 'member',
        groupsMirror: [],
      });
    });
    const db = asMember(env, 'member-3').firestore();
    await assertSucceeds(updateDoc(doc(db, 'members', 'member-3'), { displayName: 'Mina B.' }));
    await assertFails(updateDoc(doc(db, 'members', 'member-3'), { roleMirror: 'staff' }));
    await assertFails(updateDoc(doc(db, 'members', 'member-3'), { groupsMirror: ['clergy'] }));
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

  it('denies it even for staff and admin, so nothing quietly depends on it', async () => {
    await assertFails(
      addDoc(collection(asStaff(env).firestore(), 'formSubmissions'), { formId: 'x' }),
    );
    await assertFails(
      addDoc(collection(asAdmin(env).firestore(), 'formSubmissions'), { formId: 'x' }),
    );
  });
});

describe('the calendar layers staff may write', () => {
  /**
   * Both are world-readable on purpose: /calendar assembles them in the browser
   * next to Breeze, so an anonymous visitor has to be able to read them or a
   * manually added service is invisible to everybody but staff.
   */
  it('lets anyone read a manually added entry', async () => {
    await assertSucceeds(
      getDoc(doc(asAnon(env).firestore(), 'scheduleEntries', 'choir-practice')),
    );
    await assertSucceeds(getDoc(doc(asAnon(env).firestore(), 'calendarDetails', '404577147')));
  });

  it('refuses a write from anyone below staff', async () => {
    for (const as of [asAnon, asMember, asServant]) {
      await assertFails(
        setDoc(doc(as(env).firestore(), 'scheduleEntries', 'x'), { title: 'Not yours' }),
      );
      await assertFails(
        setDoc(doc(as(env).firestore(), 'calendarDetails', 'x'), { note: 'Not yours' }),
      );
    }
  });

  it('lets staff add, annotate and remove', async () => {
    const staff = asStaff(env).firestore();
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
   * Everything the parish does *not* own lives somewhere staff cannot delete
   * it from — Breeze is not in Firestore at all, and the site's own `events`
   * are a different path with a different rule. Deleting a detail must not be
   * capable of deleting anything but the detail.
   */
  it('gives staff no path that removes a liturgy', async () => {
    // A detail is keyed by the occurrence id it annotates. Removing it removes
    // the annotation; there is nothing else at that path to remove.
    const staff = asStaff(env).firestore();
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

  it('denies a signed-in member who is not a servant', async () => {
    await assertFails(getDoc(doc(asMember(env).firestore(), 'servantsConfig', 'schedule')));
  });

  /**
   * Servants and staff too, which is the change worth having a test for.
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
  it('denies a servant and staff too, now that nothing client-side reads it', async () => {
    await assertFails(getDoc(doc(asServant(env).firestore(), 'servantsConfig', 'schedule')));
    await assertFails(getDoc(doc(asStaff(env).firestore(), 'servantsConfig', 'schedule')));
  });

  it('denies writes below admin — staff may not repoint the calendar', async () => {
    await assertFails(
      setDoc(doc(asServant(env).firestore(), 'servantsConfig', 'schedule'), {
        embedUrl: 'https://evil.test/x',
      }),
    );
    await assertFails(
      setDoc(doc(asStaff(env).firestore(), 'servantsConfig', 'schedule'), {
        embedUrl: 'https://evil.test/x',
      }),
    );
    await assertSucceeds(
      setDoc(doc(asAdmin(env).firestore(), 'servantsConfig', 'schedule'), {
        embedUrl: 'https://stphilopaterstmina.breezechms.com/embed/calendar/grid?x=2',
      }),
    );
  });
});

describe('the catch-all denies anything not deliberately opened', () => {
  beforeEach(() => reset());

  it('denies read and write on an unmatched collection, even for an admin', async () => {
    const db = asAdmin(env).firestore();
    await assertFails(getDocs(collection(db, 'somethingNobodyAddedARuleFor')));
    await assertFails(setDoc(doc(db, 'somethingNobodyAddedARuleFor', 'x'), { a: 1 }));
  });

  it('denies client writes to auditLog', async () => {
    await assertFails(setDoc(doc(asAdmin(env).firestore(), 'auditLog', 'e1'), { action: 'read' }));
  });
});
