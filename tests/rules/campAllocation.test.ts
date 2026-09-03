import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
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
import { ADMIN_SCREENS } from '@spsm/shared';
import { asAnon, asSuper, createTestEnv } from './helpers.js';

/**
 * Who may arrange the camp.
 *
 * ---------------------------------------------------------------------------
 * Four claims, and none of them can be checked any other way.
 *
 *  1. **The same door as the registrations, not a wider one.** The allocation
 *     holds no names — a group is a list of `registrationId/childId` keys — so
 *     the temptation to open it at `hasRole('staff')` is real and would be
 *     wrong: the document is only useful to somebody who can already read the
 *     registrations, and a second, wider door onto the same work is a door
 *     nobody remembers exists.
 *
 *  2. **A `get` of a document that does not exist must be allowed.** The screen
 *     opens on a season nobody has allocated, and the save path reads the
 *     document back before overwriting it. Both hit a null `resource`, where
 *     `resource.data.programId` is an evaluation error that denies the read —
 *     which is the whole screen refusing on its first paint. The registrations
 *     suite next door has the same test because a browser found it there first.
 *
 *  3. **`programId` is pinned across an update.** Otherwise re-filing an
 *     allocation under a ministry you administer is a way to pull one out of a
 *     ministry you do not.
 *
 *  4. **`updatedBy` must be the caller.** A write on this document is somebody
 *     rearranging four hundred children; it has to be attributable.
 * ---------------------------------------------------------------------------
 */

let env: RulesTestEnvironment;

const CAMP = 'summercamp';
const OTHER = 'st-simon';
const SEASON = '2027';
const DOC = `${CAMP}__${SEASON}`;

/** Runs Summercamp. `role: servant` — the grant is the whole permission. */
const asCampLead = (e: RulesTestEnvironment) => e.authenticatedContext('lead-1', {});
/** Runs a different ministry entirely. */
const asOtherLead = (e: RulesTestEnvironment) => e.authenticatedContext('other-1', {});
/** Holds one *event* under Summercamp — a week's photograph volunteer. */
const asWeekVolunteer = (e: RulesTestEnvironment) => e.authenticatedContext('vol-1', {});

/**
 * Runs Summercamp **as a ministry** — its page, its gatherings, its gallery —
 * and has not been given the camp's back office.
 *
 * This context is the whole point of the change made on 2 Sep 2026. It is the
 * seeding `asCampLead` used to have: `programAdmin.programs` containing the
 * camp's id. That one tick used to open the registrations, the allocation and
 * the register as well as the photographs, so the person posting the week's
 * pictures was necessarily the person holding children's medical notes. It is
 * refused everywhere in this file now.
 */
const asCampMinistry = (e: RulesTestEnvironment) => e.authenticatedContext('min-1', {});

/**
 * Every area on the site, and no program grant.
 *
 * The control this whole file is measured against, and it is deliberately the
 * *widest* allocation /access can hand out rather than an empty one. It was
 * `asStaff` when a role ladder existed and meant the same thing: somebody
 * trusted with the parish's administration who has not been trusted with a
 * child's medical notes. Asserting against a person with nothing would prove
 * only that nothing grants nothing.
 */
const asEveryArea = (e: RulesTestEnvironment) => e.authenticatedContext('every-area-1', {});

/**
 * A complete screen map with everything ticked **except the camp**.
 *
 * `camp` joined `ADMIN_SCREENS` when the camp's back office was separated from
 * the camp's program grant, and `Object.fromEntries(ADMIN_SCREENS…)` therefore
 * started handing this control the very permission it exists to be refused.
 * Derived from the constant rather than listed, so a screen added tomorrow is
 * still in it, and the one exclusion is named.
 */
const everyScreenButCamp = Object.fromEntries(
  ADMIN_SCREENS.filter((s) => s !== 'camp').map((s) => [s, true]),
);


/** One week's board. The camp is arranged per week, so this is what the top
    level of the document is a list of. */
function weekBoard(week = 1, over: Record<string, unknown> = {}) {
  return {
    week,
    bands: [
      {
        id: `band-${week}`,
        name: '3rd & 4th grade',
        grades: ['3', '4'],
        colour: 'green',
        groups: [
          {
            id: `group-${week}`,
            name: 'Blue 1',
            colour: 'blue',
            childKeys: ['reg-1/child-1'],
            servantKeys: ['reg-s1'],
            leaderKey: 'reg-s1',
            note: '',
          },
        ],
        note: '',
      },
    ],
    stations: [
      {
        id: `station-${week}`,
        name: 'Sports',
        section: 'elementary',
        colour: 'teal',
        location: 'Field',
        servantKeys: [],
        leaderKey: '',
        note: '',
      },
    ],
    ...over,
  };
}

function allocation(over: Record<string, unknown> = {}) {
  return {
    programId: CAMP,
    season: SEASON,
    weeks: [weekBoard(1)],
    archivedAt: null,
    archivedBy: null,
    note: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedBy: 'lead-1',
    ...over,
  };
}

beforeAll(async () => {
  env = await createTestEnv('campAllocation');
  await env.clearFirestore();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, 'campAllocations', DOC), allocation());
    await setDoc(
      doc(db, 'campAllocations', `${OTHER}__${SEASON}`),
      allocation({ programId: OTHER, updatedBy: 'other-1' }),
    );

    // The grants. Written through the bypass because in production only a
    // superadmin can set them — which the members suite already asserts.
    // The camp lead holds the `camp` screen flag and **no program grant** —
    // that separation is what this seeding is asserting. Whoever posts the
    // camp's photographs is `min-1` below and gets nothing here.
    await setDoc(doc(db, 'members', 'lead-1'), {
      screenAdmin: { camp: true },
      programAdmin: { programs: [], events: [] },
    });
    await setDoc(doc(db, 'members', 'min-1'), {
      programAdmin: { programs: [CAMP], events: [] },
    });
    await setDoc(doc(db, 'members', 'other-1'), {
      programAdmin: { programs: [OTHER], events: [] },
    });
    await setDoc(doc(db, 'members', 'vol-1'), {
      programAdmin: { programs: [], events: ['week-1-2027'] },
    });
    await setDoc(doc(db, 'members', 'every-area-1'), {
      screenAdmin: everyScreenButCamp,
      programAdmin: { programs: [], events: [] },
    });
  });
});

describe('reading an allocation', () => {
  it('lets the camp lead read it', async () => {
    await assertSucceeds(getDoc(doc(asCampLead(env).firestore(), 'campAllocations', DOC)));
  });

  it('lets a superadmin read it', async () => {
    await assertSucceeds(getDoc(doc(asSuper(env).firestore(), 'campAllocations', DOC)));
  });

  /**
   * Claim 1. The allocation has no names in it, which is exactly why a wider
   * door would look defensible. It is not: the document is a key into the
   * registrations, and the same grant guards both.
   */
  it('denies somebody holding every area but not the camp', async () => {
    await assertFails(getDoc(doc(asEveryArea(env).firestore(), 'campAllocations', DOC)));
  });

  it('denies the lead of a different ministry', async () => {
    await assertFails(getDoc(doc(asOtherLead(env).firestore(), 'campAllocations', DOC)));
  });

  /** An *event* grant administers a gallery, not the camp. */
  it('denies an event-scoped volunteer', async () => {
    await assertFails(getDoc(doc(asWeekVolunteer(env).firestore(), 'campAllocations', DOC)));
  });

  it('denies an anonymous visitor', async () => {
    await assertFails(getDoc(doc(asAnon(env).firestore(), 'campAllocations', DOC)));
  });

  /**
   * The camp's own ministry is not the camp's back office, as of 2 Sep 2026.
   *
   * This is the grant that used to open the allocation — `programAdmin.programs`
   * with the camp's id in it — and it now buys the camp's page, its gatherings
   * and its photographs and nothing else.
   */
  it('denies the camp’s own ministry', async () => {
    await assertFails(getDoc(doc(asCampMinistry(env).firestore(), 'campAllocations', DOC)));
  });

  /**
   * The cost of a flag over a program grant, asserted rather than implied: it
   * is not scoped by ministry. There is one camp and only a superadmin may
   * re-point `config/camp.programId`, which is what keeps a second one from
   * existing. `camp.test.ts` has the long version.
   */
  it('lets the camp grant read an allocation filed under another ministry', async () => {
    await assertSucceeds(
      getDoc(doc(asCampLead(env).firestore(), 'campAllocations', `${OTHER}__${SEASON}`)),
    );
  });

  /**
   * Claim 2, in the order the client actually performs it: a `get` first, then
   * the `setDoc` that carries `createdAt` across. If the `get` were denied for
   * a document that does not exist, the very first save of every season would
   * fail as a rules error naming a document nobody could have been refused.
   */
  it('allows a get on a season nobody has allocated yet, then the create', async () => {
    const db = asCampLead(env).firestore();
    const ref = doc(db, 'campAllocations', `${CAMP}__2099`);

    await assertSucceeds(getDoc(ref));
    await assertSucceeds(setDoc(ref, allocation({ season: '2099' })));
  });
});

describe('writing an allocation', () => {
  it('lets the camp lead save one', async () => {
    const db = asCampLead(env).firestore();
    await assertSucceeds(setDoc(doc(db, 'campAllocations', DOC), allocation()));
  });

  it('denies somebody holding every area but not the camp', async () => {
    const db = asEveryArea(env).firestore();
    await assertFails(setDoc(doc(db, 'campAllocations', DOC), allocation({ updatedBy: 'staff-1' })));
  });

  /** Claim 4. A write here is somebody rearranging the whole camp. */
  it('denies a write stamped with somebody else’s uid', async () => {
    const db = asCampLead(env).firestore();
    await assertFails(
      setDoc(doc(db, 'campAllocations', DOC), allocation({ updatedBy: 'other-1' })),
    );
  });

  /** Claim 3. */
  it('denies moving an allocation to another ministry', async () => {
    const db = asCampLead(env).firestore();
    await assertFails(updateDoc(doc(db, 'campAllocations', DOC), { programId: OTHER }));
  });

  /**
   * Creating one under another ministry is allowed, and pinning is what still
   * matters.
   *
   * A program grant refused this; the flag does not look at `programId` at all.
   * What it cannot do is *move* an existing allocation — the test above this one
   * — so the season somebody arranged cannot be pulled out from under the
   * screens. Writing a new document under a ministry nobody uses achieves
   * nothing but a document nothing reads.
   */
  it('allows creating one under another ministry, which nothing reads', async () => {
    const db = asCampLead(env).firestore();
    await assertSucceeds(
      setDoc(
        doc(db, 'campAllocations', `${OTHER}__2099`),
        allocation({ programId: OTHER, season: '2099' }),
      ),
    );
  });

  /*
   * The flat shape check. Rules cannot walk into an array's members, so what is
   * enforced is the top-level count — enough to stop a write that would make
   * the document unopenable, and not a claim that the contents are sensible.
   * `parseCampAllocation` is what handles the rest, and the rule's own comment
   * says so.
   */
  it('denies an allocation with no season', async () => {
    const db = asCampLead(env).firestore();
    await assertFails(setDoc(doc(db, 'campAllocations', DOC), allocation({ season: '' })));
  });

  it('denies more weeks than a camp can have', async () => {
    const db = asCampLead(env).firestore();
    const weeks = Array.from({ length: 10 }, (_unused, index) => weekBoard(index + 1));
    await assertFails(setDoc(doc(db, 'campAllocations', DOC), allocation({ weeks })));
  });

  it('denies weeks that are not a list at all', async () => {
    const db = asCampLead(env).firestore();
    await assertFails(setDoc(doc(db, 'campAllocations', DOC), allocation({ weeks: 'lots' })));
  });

  /*
   * The flat shape, refused on the way in.
   *
   * A document written while the camp had one arrangement for the whole summer
   * has `bands` and `stations` at the top and no `weeks`, and it stays
   * *readable* — `parseCampAllocation` lifts it into week one. Writing it back
   * that way is what must not happen, because every write comes from the screen
   * and the screen has already converted it; a top-level `bands` arriving now
   * is a client that is out of date.
   */
  it('denies the old flat shape, whatever else is on it', async () => {
    const db = asCampLead(env).firestore();
    const old = allocation();
    delete (old as Record<string, unknown>)['weeks'];
    const board = weekBoard(1);
    await assertFails(
      setDoc(doc(db, 'campAllocations', DOC), {
        ...old,
        bands: board.bands,
        stations: board.stations,
      }),
    );
  });

  /*
   * A week's board is not itself bounded here, and that is the same gap the
   * bands had: `MAX_BANDS`, `MAX_STATIONS` and every count inside them are
   * enforced by `parseCampAllocation` alone. Pinned so nobody reads the rule and
   * assumes otherwise.
   */
  it('allows a week carrying more bands than the parser will keep', async () => {
    const db = asCampLead(env).firestore();
    const fat = weekBoard(1, {
      bands: Array.from({ length: 20 }, (_unused, index) => weekBoard(index + 1).bands[0]),
    });
    await assertSucceeds(setDoc(doc(db, 'campAllocations', DOC), allocation({ weeks: [fat] })));
  });
});

/*
 * Listing the seasons, for the year list on the camp's front door.
 *
 * The behavioural half of the `allow list` rule, and the half that a compile
 * check cannot reach: a `list` rule reading `resource.data.programId` does not
 * *filter* a query, it refuses any query that could return a document the
 * caller may not have. So the constrained query has to succeed and the
 * unconstrained one has to fail, and if the second of those ever starts passing
 * it means the rule has been loosened rather than that the client got better.
 */
describe('listing the seasons', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'campAllocations', DOC), allocation());
    });
  });

  it('lets the camp lead list their own ministry', async () => {
    const db = asCampLead(env).firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'campAllocations'), where('programId', '==', CAMP))),
    );
  });

  /**
   * Inverted on 2 Sep 2026, and worth keeping for that.
   *
   * Under a program grant an unconstrained list was refused outright rather
   * than filtered — decision #10, the failure that looks like a broken screen
   * and is a missing `where`. A flag is proven against the caller, so the trap
   * does not exist here any more. The screen still sends the constraint.
   */
  it('allows a list that is not constrained to a ministry', async () => {
    const db = asCampLead(env).firestore();
    await assertSucceeds(getDocs(collection(db, 'campAllocations')));
  });

  it('denies a lead of another ministry listing this one', async () => {
    const db = asOtherLead(env).firestore();
    await assertFails(
      getDocs(query(collection(db, 'campAllocations'), where('programId', '==', CAMP))),
    );
  });

  it('denies the camp’s own ministry listing the seasons', async () => {
    const db = asCampMinistry(env).firestore();
    await assertFails(
      getDocs(query(collection(db, 'campAllocations'), where('programId', '==', CAMP))),
    );
  });
});

describe('deleting an allocation', () => {
  it('lets the camp lead delete their own season', async () => {
    await assertSucceeds(deleteDoc(doc(asCampLead(env).firestore(), 'campAllocations', DOC)));
  });

  it('denies everybody else', async () => {
    await assertFails(deleteDoc(doc(asEveryArea(env).firestore(), 'campAllocations', DOC)));
    await assertFails(deleteDoc(doc(asOtherLead(env).firestore(), 'campAllocations', DOC)));
    await assertFails(deleteDoc(doc(asAnon(env).firestore(), 'campAllocations', DOC)));
  });
});
