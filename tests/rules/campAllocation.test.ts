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

/** A complete screen map with everything ticked. */
const everyScreen = Object.fromEntries(ADMIN_SCREENS.map((s) => [s, true]));


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
    ...weekBoard(1),
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
    await setDoc(doc(db, 'members', 'lead-1'), {
      programAdmin: { programs: [CAMP], events: [] },
    });
    await setDoc(doc(db, 'members', 'other-1'), {
      programAdmin: { programs: [OTHER], events: [] },
    });
    await setDoc(doc(db, 'members', 'vol-1'), {
      programAdmin: { programs: [], events: ['week-1-2027'] },
    });
    await setDoc(doc(db, 'members', 'every-area-1'), {
      screenAdmin: everyScreen,
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
  it('denies a staff member with no camp grant', async () => {
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

  it('denies a camp lead reading another ministry’s allocation', async () => {
    await assertFails(
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

  it('denies a staff member with no camp grant', async () => {
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

  it('denies creating one under a ministry the writer does not administer', async () => {
    const db = asCampLead(env).firestore();
    await assertFails(
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

  it('denies more bands than a camp can have', async () => {
    const db = asCampLead(env).firestore();
    const bands = Array.from({ length: 17 }, (_unused, index) => weekBoard(index + 1).bands[0]);
    await assertFails(setDoc(doc(db, 'campAllocations', DOC), allocation({ bands })));
  });

  it('denies bands that are not a list at all', async () => {
    const db = asCampLead(env).firestore();
    await assertFails(setDoc(doc(db, 'campAllocations', DOC), allocation({ bands: 'lots' })));
  });

  /*
   * The per-week shape, refused on the way in.
   *
   * A document written while the camp was arranged per week has `weeks` at the
   * top level and no `bands`, and it stays *readable* — `parseCampAllocation`
   * lifts week one out of it. Writing it back that way is what must not happen,
   * because every write comes from the screen and the screen has already
   * converted it; a top-level `weeks` arriving now is a client that is out of
   * date.
   */
  it('denies the per-week shape, whatever else is on it', async () => {
    const db = asCampLead(env).firestore();
    const old = allocation();
    delete (old as Record<string, unknown>)['bands'];
    delete (old as Record<string, unknown>)['stations'];
    await assertFails(
      setDoc(doc(db, 'campAllocations', DOC), { ...old, weeks: [weekBoard(1)] }),
    );
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

  it('denies a list that is not constrained to a ministry', async () => {
    const db = asCampLead(env).firestore();
    await assertFails(getDocs(collection(db, 'campAllocations')));
  });

  it('denies a lead of another ministry listing this one', async () => {
    const db = asOtherLead(env).firestore();
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
