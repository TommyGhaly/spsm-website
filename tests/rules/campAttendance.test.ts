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
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { ADMIN_SCREENS } from '@spsm/shared';
import { asAnon, asSuper, createTestEnv } from './helpers.js';

/**
 * Who may take the camp's register, and what a tick is allowed to do.
 *
 * ---------------------------------------------------------------------------
 * The register is the most exposed thing the camp screens produce: it says
 * which named children are on a site right now, and it is read from a phone at
 * a gate. Five claims, and every one of them fails silently in a way a green
 * `rules:check` would not notice.
 *
 *  1. **The camp's program grant, and nothing else.** Not `staff`, not an
 *     event grant. Same door as the registrations and the allocation.
 *  2. **A `get` of a day nobody has opened must succeed.** Every morning
 *     starts on a document that does not exist, `resource.data.programId` on a
 *     null resource is an evaluation error, and an evaluation error denies the
 *     read — which is the whole screen refusing on its first paint. Found by a
 *     browser on the registrations, and it is the third collection where the
 *     same shape had to be written out.
 *  3. **A merging tick must survive the shape check.** Every write from the
 *     screen is `setDoc(…, { merge: true })` of one nested field. Rules see the
 *     *merged* document, so a register that already holds a hundred children
 *     has to still pass `isCampAttendance` when the hundred-and-first is
 *     ticked. This is the test that would catch a bound written against what
 *     the client sends rather than against what the document becomes.
 *  4. **`programId` and `day` are pinned.** The id encodes the day; a write
 *     that changed it would leave `…__w1-tue` claiming to be Wednesday.
 *  5. **No delete, at all.** The one camp collection with none. A register is
 *     the record of which children were in somebody's care, and the moment it
 *     is worth anything is the moment somebody wishes it were gone.
 * ---------------------------------------------------------------------------
 */

let env: RulesTestEnvironment;

const CAMP = 'summercamp';
const OTHER = 'st-simon';
const SEASON = '2027';
const DAY = 'w1-tue';
const DOC = `${CAMP}__${SEASON}__${DAY}`;

const asCampLead = (e: RulesTestEnvironment) => e.authenticatedContext('lead-1', {});
const asOtherLead = (e: RulesTestEnvironment) => e.authenticatedContext('other-1', {});
/** Holds one *event* under Summercamp, not the ministry. */
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


function mark(by = 'lead-1') {
  return { at: new Date(), by };
}

function register(over: Record<string, unknown> = {}) {
  return {
    programId: CAMP,
    season: SEASON,
    day: DAY,
    entries: {
      'reg-1/child-1': { arrived: mark(), collected: null },
      'reg-1/child-2': { arrived: mark(), collected: mark() },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedBy: 'lead-1',
    ...over,
  };
}

/** One tick, written exactly as `markAttendance` writes it. */
function tick(key: string, which: 'arrived' | 'collected', uid = 'lead-1') {
  return {
    programId: CAMP,
    season: SEASON,
    day: DAY,
    entries: { [key]: { [which]: { at: serverTimestamp(), by: uid } } },
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  };
}

beforeAll(async () => {
  env = await createTestEnv('campAttendance');
  await env.clearFirestore();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, 'campAttendance', DOC), register());
    await setDoc(
      doc(db, 'campAttendance', `${OTHER}__${SEASON}__${DAY}`),
      register({ programId: OTHER, updatedBy: 'other-1' }),
    );

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

describe('reading a register', () => {
  it('lets the camp lead read it', async () => {
    await assertSucceeds(getDoc(doc(asCampLead(env).firestore(), 'campAttendance', DOC)));
  });

  it('lets a superadmin read it', async () => {
    await assertSucceeds(getDoc(doc(asSuper(env).firestore(), 'campAttendance', DOC)));
  });

  /** Claim 1. A register names children; `staff` is the bulletin editor. */
  it('denies somebody holding every area but not the camp', async () => {
    await assertFails(getDoc(doc(asEveryArea(env).firestore(), 'campAttendance', DOC)));
  });

  it('denies the lead of a different ministry', async () => {
    await assertFails(getDoc(doc(asOtherLead(env).firestore(), 'campAttendance', DOC)));
  });

  it('denies an event-scoped volunteer', async () => {
    await assertFails(getDoc(doc(asWeekVolunteer(env).firestore(), 'campAttendance', DOC)));
  });

  it('denies an anonymous visitor', async () => {
    await assertFails(getDoc(doc(asAnon(env).firestore(), 'campAttendance', DOC)));
  });

  /**
   * The camp's ministry is the photographs, not the register — the separation
   * made on 2 Sep 2026, and this is the grant that used to open this document.
   */
  it('denies the camp’s own ministry', async () => {
    await assertFails(getDoc(doc(asCampMinistry(env).firestore(), 'campAttendance', DOC)));
  });

  /**
   * The flag is not scoped by ministry. One camp, one `config/camp.programId`,
   * and only a superadmin may move it — `camp.test.ts` has the long version of
   * what that buys and what it costs.
   */
  it('lets the camp grant read a register filed under another ministry', async () => {
    await assertSucceeds(
      getDoc(doc(asCampLead(env).firestore(), 'campAttendance', `${OTHER}__${SEASON}__${DAY}`)),
    );
  });

  /**
   * Claim 2, in the order a morning actually happens: the screen listens to a
   * day nobody has opened, and the first tick creates it.
   */
  it('allows a get on a day nobody has ticked yet, then the first tick', async () => {
    const db = asCampLead(env).firestore();
    const ref = doc(db, 'campAttendance', `${CAMP}__${SEASON}__w2-thu`);

    await assertSucceeds(getDoc(ref));
    await assertSucceeds(
      setDoc(
        ref,
        {
          programId: CAMP,
          season: SEASON,
          day: 'w2-thu',
          entries: { 'reg-1/child-1': { arrived: { at: serverTimestamp(), by: 'lead-1' } } },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: 'lead-1',
        },
        { merge: true },
      ),
    );
  });

  /**
   * Both shapes of query are allowed now, and the pair is kept for the history.
   *
   * A rule reading `resource.data.programId` refuses an unconstrained list
   * rather than filtering it, so the first screen to query this collection
   * would have met a permission error that looks like a grant problem. The flag
   * is proven against the caller, so neither form is a trap.
   */
  it('allows a listing, constrained to the ministry or not', async () => {
    const db = asCampLead(env).firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'campAttendance'), where('programId', '==', CAMP))),
    );
    await assertSucceeds(getDocs(collection(db, 'campAttendance')));
  });

  it('denies a listing to the camp’s own ministry', async () => {
    const db = asCampMinistry(env).firestore();
    await assertFails(
      getDocs(query(collection(db, 'campAttendance'), where('programId', '==', CAMP))),
    );
  });
});

describe('ticking a child', () => {
  it('lets the camp lead mark somebody in', async () => {
    const db = asCampLead(env).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'campAttendance', DOC), tick('reg-2/child-7', 'arrived'), { merge: true }),
    );
  });

  it('lets the camp lead mark somebody collected', async () => {
    const db = asCampLead(env).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'campAttendance', DOC), tick('reg-1/child-1', 'collected'), { merge: true }),
    );
  });

  /**
   * Undo. It writes null rather than deleting the field, and a rule that
   * required a mark to be a map would refuse the correction — which is a
   * screen where a mistap is permanent.
   */
  it('lets a tick be taken back', async () => {
    const db = asCampLead(env).firestore();
    await assertSucceeds(
      setDoc(
        doc(db, 'campAttendance', DOC),
        {
          programId: CAMP,
          season: SEASON,
          day: DAY,
          entries: { 'reg-1/child-1': { arrived: null } },
          updatedAt: serverTimestamp(),
          updatedBy: 'lead-1',
        },
        { merge: true },
      ),
    );
  });

  /**
   * Claim 3. The bound is on the merged document, not on what was sent. A
   * single tick against a register that is already at the ceiling has to be
   * refused, and one against a register below it has to pass — otherwise the
   * check is measuring the wrong thing and would let a document grow without
   * limit one field at a time.
   */
  it('refuses a tick that would push the register past the ceiling', async () => {
    const entries: Record<string, unknown> = {};
    for (let index = 0; index < 800; index += 1) {
      entries[`reg-full/child-${index}`] = { arrived: mark(), collected: null };
    }

    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'campAttendance', `${CAMP}__${SEASON}__w2-mon`),
        register({ day: 'w2-mon', entries }),
      );
    });

    const db = asCampLead(env).firestore();
    const ref = doc(db, 'campAttendance', `${CAMP}__${SEASON}__w2-mon`);

    // The 801st child.
    await assertFails(
      setDoc(
        ref,
        { ...tick('reg-extra/child-1', 'arrived'), day: 'w2-mon' },
        { merge: true },
      ),
    );

    // One already in it. A merge that changes no key count is not a growth.
    await assertSucceeds(
      setDoc(
        ref,
        { ...tick('reg-full/child-0', 'collected'), day: 'w2-mon' },
        { merge: true },
      ),
    );
  });

  it('denies somebody holding every area but not the camp', async () => {
    const db = asEveryArea(env).firestore();
    await assertFails(
      setDoc(doc(db, 'campAttendance', DOC), tick('reg-2/child-7', 'arrived', 'staff-1'), {
        merge: true,
      }),
    );
  });

  it('denies the lead of a different ministry', async () => {
    const db = asOtherLead(env).firestore();
    await assertFails(
      setDoc(doc(db, 'campAttendance', DOC), tick('reg-2/child-7', 'arrived', 'other-1'), {
        merge: true,
      }),
    );
  });

  it('denies an anonymous visitor', async () => {
    const db = asAnon(env).firestore();
    await assertFails(
      setDoc(doc(db, 'campAttendance', DOC), tick('reg-2/child-7', 'arrived', 'nobody'), {
        merge: true,
      }),
    );
  });

  /** Claim 4, first half: re-filing the register under a ministry you do run. */
  it('denies moving a register to another ministry', async () => {
    const db = asCampLead(env).firestore();
    await assertFails(
      setDoc(doc(db, 'campAttendance', DOC), register({ programId: OTHER })),
    );
  });

  /** Claim 4, second half: the id says Tuesday, so the document must too. */
  it('denies changing which day the register is of', async () => {
    const db = asCampLead(env).firestore();
    await assertFails(setDoc(doc(db, 'campAttendance', DOC), register({ day: 'w1-wed' })));
  });

  /** Every tick is attributable, including the ones that take a tick back. */
  it('denies a tick attributed to somebody else', async () => {
    const db = asCampLead(env).firestore();
    await assertFails(
      setDoc(doc(db, 'campAttendance', DOC), tick('reg-2/child-7', 'arrived', 'other-1'), {
        merge: true,
      }),
    );
  });

  it('denies a register with no season on it', async () => {
    const db = asCampLead(env).firestore();
    await assertFails(setDoc(doc(db, 'campAttendance', DOC), register({ season: '' })));
  });

  it('denies entries that are not a map', async () => {
    const db = asCampLead(env).firestore();
    await assertFails(setDoc(doc(db, 'campAttendance', DOC), register({ entries: [] })));
  });
});

describe('deleting a register', () => {
  /**
   * Claim 5. Every other camp collection allows a delete for the row typed
   * twice at a desk. This one does not, for anybody — a day ticked in error is
   * corrected by taking the ticks back, which leaves the correction in
   * `updatedBy` rather than leaving nothing at all.
   */
  it('denies the camp lead', async () => {
    await assertFails(deleteDoc(doc(asCampLead(env).firestore(), 'campAttendance', DOC)));
  });

  it('denies a superadmin', async () => {
    await assertFails(deleteDoc(doc(asSuper(env).firestore(), 'campAttendance', DOC)));
  });
});
