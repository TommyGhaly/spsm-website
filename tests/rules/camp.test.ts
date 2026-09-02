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
 * Camp registrations: who can see a child's medical notes.
 *
 * ---------------------------------------------------------------------------
 * Three claims here cannot be checked any other way.
 *
 *  1. **No screen flag is enough.** Every other administrative collection on
 *     this site opens on a flag from /access. This one does not, deliberately:
 *     a registration holds a child's allergies and medical notes, and rules
 *     grant documents rather than fields, so a `finance` flag that reached the
 *     fee ledger would reach those too. `asEveryArea` below holds every area
 *     the allocation screen can hand out and is refused throughout.
 *
 *  2. **The list-query trap.** The rule allows a read when the reader
 *     administers the document's program, and Firestore judges a list by what
 *     it *could* return. Without `where('programId','==',…)` the camp
 *     administrator the screen was built for is denied the whole query with a
 *     flat `permission-denied` — decision #10, in the collection where it would
 *     look most like a broken screen.
 *
 *  3. **Grants live in a Firestore document, not the token.** So "somebody
 *     cannot grant themselves the camp" has to be an assertion, and since the
 *     role ladder went it is the *only* thing standing between a signed-in
 *     account and every permission on the site.
 * ---------------------------------------------------------------------------
 */

let env: RulesTestEnvironment;

const CAMP = 'summercamp';
const OTHER = 'st-simon';
const SEASON = '2027';

/** Runs Summercamp. `role: servant` — the grant is the whole permission. */
const asCampLead = (e: RulesTestEnvironment) => e.authenticatedContext('lead-1', {});
/** Runs a different ministry entirely. Must not reach the camp. */
const asOtherLead = (e: RulesTestEnvironment) => e.authenticatedContext('other-1', {});
/** Holds one *event* under Summercamp — a week's photograph volunteer. A grant
    at that level administers a gallery, and must not open the registrations. */
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


function registration(over: Record<string, unknown> = {}) {
  return {
    programId: CAMP,
    season: SEASON,
    kind: 'family',
    status: 'draft',
    contact: { name: 'Mina Guirguis', email: '', phone: '555-0100', altName: '', altPhone: '', address: '' },
    emergency: { name: 'Sara', phone: '555-0101', relationship: 'Aunt' },
    children: [
      {
        id: 'child-1', firstName: 'Mariam', lastName: 'Guirguis', dateOfBirth: '2016-04-02',
        grade: '4', shirtSize: 'YM', allergies: 'Peanuts', medicalNotes: '',
        groupName: '', photoConsent: false, note: '',
      },
    ],
    servant: null,
    waiver: { version: '', agreed: false, signedName: '', signedRelationship: '', signedAt: null, signedByUid: null },
    billing: { baseCents: 15000, discounts: [], payments: [] },
    note: '',
    takenByUid: 'lead-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedBy: 'lead-1',
    ...over,
  };
}

beforeAll(async () => {
  env = await createTestEnv('camp');
  await env.clearFirestore();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, 'campRegistrations', 'reg-1'), registration());
    await setDoc(doc(db, 'campRegistrations', 'reg-other'), registration({ programId: OTHER }));

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

describe('reading registrations', () => {
  it('allows the query the screen actually issues', async () => {
    const db = asCampLead(env).firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(db, 'campRegistrations'),
          where('programId', '==', CAMP),
          where('season', '==', SEASON),
        ),
      ),
    );
  });

  /**
   * The one that matters. Not "returns fewer rows" — denied outright, which on
   * a live page is a drawer that opens onto an error.
   */
  it('denies the same query without the programId filter', async () => {
    const db = asCampLead(env).firestore();
    await assertFails(
      getDocs(query(collection(db, 'campRegistrations'), where('season', '==', SEASON))),
    );
  });

  it('lets a superadmin read one directly', async () => {
    await assertSucceeds(getDoc(doc(asSuper(env).firestore(), 'campRegistrations', 'reg-1')));
  });

  it('lets the camp lead read one directly', async () => {
    await assertSucceeds(getDoc(doc(asCampLead(env).firestore(), 'campRegistrations', 'reg-1')));
  });

  /**
   * The claim this collection exists to make. Holding every area opens the
   * forms drawer, the bookstore queue, the bulletin and the parish calendar —
   * and none of that is a reason to read a child's allergies.
   */
  it('denies somebody holding every area but not the camp', async () => {
    await assertFails(getDoc(doc(asEveryArea(env).firestore(), 'campRegistrations', 'reg-1')));
  });

  it('denies the lead of a different ministry', async () => {
    await assertFails(getDoc(doc(asOtherLead(env).firestore(), 'campRegistrations', 'reg-1')));
  });

  /**
   * An *event* grant administers a gallery, not the camp. Somebody trusted with
   * one week's photographs has not been trusted with every family's contact
   * details, and `adminsProgram` — rather than `adminsProgramEvent` — is what
   * keeps those apart.
   */
  it('denies an event-scoped volunteer', async () => {
    await assertFails(getDoc(doc(asWeekVolunteer(env).firestore(), 'campRegistrations', 'reg-1')));
  });

  it('denies an anonymous visitor', async () => {
    await assertFails(getDoc(doc(asAnon(env).firestore(), 'campRegistrations', 'reg-1')));
  });

  it('denies a camp lead reading another ministry through the same collection', async () => {
    await assertFails(getDoc(doc(asCampLead(env).firestore(), 'campRegistrations', 'reg-other')));
  });

  /**
   * The one the first version of this suite missed, and a browser found.
   *
   * `writeRegistration` reads a registration back before writing it, so a
   * replacing `setDoc` carries `createdAt` across instead of destroying it. On
   * the first save the document does not exist yet — `resource` is null, and a
   * rule that dereferences it errors and denies. The save then fails with a
   * rules error naming a document nobody could have been refused.
   *
   * These tests passed anyway, because they wrote without reading first. That
   * is exactly the gap behavioural rules tests exist to close, so the read is
   * asserted here in the order the client actually performs it.
   */
  it('allows a get on an id that does not exist yet, which every create does first', async () => {
    const db = asCampLead(env).firestore();
    await assertSucceeds(getDoc(doc(db, 'campRegistrations', 'not-created-yet')));
    await assertSucceeds(
      setDoc(doc(db, 'campRegistrations', 'not-created-yet'), registration({ updatedBy: 'lead-1' })),
    );
  });
});

describe('writing registrations', () => {
  it('lets the camp lead create one', async () => {
    const db = asCampLead(env).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'campRegistrations', 'new-1'), registration({ updatedBy: 'lead-1' })),
    );
  });

  it('refuses a create that does not name its writer', async () => {
    const db = asCampLead(env).firestore();
    // `updatedBy` must equal the caller's uid, so every write is attributable.
    await assertFails(
      setDoc(doc(db, 'campRegistrations', 'new-2'), registration({ updatedBy: null })),
    );
    await assertFails(
      setDoc(doc(db, 'campRegistrations', 'new-3'), registration({ updatedBy: 'somebody-else' })),
    );
  });

  it('refuses an anonymous create — there is no public registration path', async () => {
    await assertFails(
      setDoc(doc(asAnon(env).firestore(), 'campRegistrations', 'new-4'), registration()),
    );
  });

  it('refuses a create by somebody holding every area but not the camp', async () => {
    await assertFails(
      setDoc(
        doc(asEveryArea(env).firestore(), 'campRegistrations', 'new-5'),
        registration({ updatedBy: 'every-area-1' }),
      ),
    );
  });

  it('lets the camp lead record a payment', async () => {
    const db = asCampLead(env).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'campRegistrations', 'reg-1'), {
        billing: {
          baseCents: 15000,
          discounts: [],
          payments: [{ id: 'p1', amountCents: 15000, method: 'check', reference: '1041', receivedOn: '2027-05-01', note: '', recordedByUid: 'lead-1', recordedAt: new Date() }],
        },
        updatedBy: 'lead-1',
      }),
    );
  });

  /**
   * Re-filing a registration under a ministry you administer would otherwise be
   * a way to pull one out of a ministry you do not. `programEvents` pins its
   * own `programId` for the same reason; here it is a flat refusal, because
   * there is no legitimate reason to move a camp registration at all.
   */
  it('refuses to move a registration into another ministry', async () => {
    const db = asCampLead(env).firestore();
    await assertFails(
      updateDoc(doc(db, 'campRegistrations', 'reg-1'), { programId: OTHER, updatedBy: 'lead-1' }),
    );
  });

  it('refuses a registration with more children than the schema allows', async () => {
    const db = asCampLead(env).firestore();
    const children = Array.from({ length: 21 }, (_, index) => ({ id: `c${index}` }));
    await assertFails(
      setDoc(doc(db, 'campRegistrations', 'new-6'), registration({ children, updatedBy: 'lead-1' })),
    );
  });

  it('refuses a fee outside the bound, which would make a balance meaningless', async () => {
    const db = asCampLead(env).firestore();
    await assertFails(
      setDoc(doc(db, 'campRegistrations', 'new-7'), registration({
        billing: { baseCents: 9_999_999, discounts: [], payments: [] },
        updatedBy: 'lead-1',
      })),
    );
  });

  it('refuses an unknown status', async () => {
    const db = asCampLead(env).firestore();
    await assertFails(
      setDoc(doc(db, 'campRegistrations', 'new-8'), registration({ status: 'paid', updatedBy: 'lead-1' })),
    );
  });

  it('refuses a registration with no season, which nothing could ever query', async () => {
    const db = asCampLead(env).firestore();
    await assertFails(
      setDoc(doc(db, 'campRegistrations', 'new-9'), registration({ season: '', updatedBy: 'lead-1' })),
    );
  });

  it('lets the camp lead delete a duplicate, and refuses everybody else', async () => {
    await assertFails(deleteDoc(doc(asEveryArea(env).firestore(), 'campRegistrations', 'reg-1')));
    await assertFails(deleteDoc(doc(asOtherLead(env).firestore(), 'campRegistrations', 'reg-1')));
    await assertSucceeds(deleteDoc(doc(asCampLead(env).firestore(), 'campRegistrations', 'reg-1')));
  });
});

describe('the grant itself', () => {
  /**
   * The escalation the whole model rests on: grants are read from the member
   * document, so if a member could write their own, every check above would be
   * decoration.
   */
  it('refuses granting yourself the camp, whatever else you hold', async () => {
    const db = asCampLead(env).firestore();
    await assertFails(
      updateDoc(doc(db, 'members', 'vol-1'), { programAdmin: { programs: [CAMP], events: [] } }),
    );
    /*
     * The second half, and it is the one that matters now. This person holds
     * every screen /access can hand out — the widest allocation on the site —
     * and still cannot write a program grant onto their own document. There is
     * no tier that includes it; there is only `superadmin`, which is a claim
     * they do not have and cannot give themselves.
     */
    await assertFails(
      setDoc(
        doc(asEveryArea(env).firestore(), 'members', 'every-area-1'),
        { screenAdmin: everyScreen, programAdmin: { programs: [CAMP], events: [] } },
      ),
    );
  });
});

/**
 * Sign-ups servants sent themselves.
 *
 * ---------------------------------------------------------------------------
 * The collection that exists so `campRegistrations` above can stay shut.
 *
 * `/forms/summer-camp` now shows a public form to anybody who opens it, and
 * that form must not be able to write into the register beside these tests —
 * the one holding a ten-year-old's allergies. It posts to a Cloud Function
 * instead, which writes here with the Admin SDK, and the Admin SDK does not go
 * through this file at all.
 *
 * So the assertions below are about the two halves of that: **nothing in a
 * browser may create one**, signed in or not and however many grants it holds,
 * and reading or dismissing one takes the camp's program grant like everything
 * else in this feature.
 * ---------------------------------------------------------------------------
 */
function signUp(over: Record<string, unknown> = {}) {
  return {
    programId: CAMP,
    season: SEASON,
    registration: registration({
      kind: 'servant',
      children: [],
      servant: {
        uid: null, dateOfBirth: '2009-06-01', sections: ['elementary'],
        desiredRoles: ['Sports'], assignedRoles: [], shirtSize: 'AM',
        days: ['w1-mon'], availability: '', cleared: false, clearedNote: '',
      },
    }),
    message: '',
    submittedAt: new Date(),
    ...over,
  };
}

describe('servant sign-ups', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'campServantRequests', 'req-1'), signUp());
      await setDoc(doc(db, 'campServantRequests', 'req-other'), signUp({ programId: OTHER }));
    });
  });

  it('refuses a create from a browser, however privileged', async () => {
    /*
     * The point of the whole design. If any of these three could write here,
     * the Function's guarantees — the season and the ministry are read from
     * config rather than taken from the sender, the safeguarding flag is
     * cleared, the endpoint is rate-limited — would all be optional.
     */
    await assertFails(
      setDoc(doc(asAnon(env).firestore(), 'campServantRequests', 'req-new'), signUp()),
    );
    await assertFails(
      setDoc(doc(asCampLead(env).firestore(), 'campServantRequests', 'req-new'), signUp()),
    );
    await assertFails(
      setDoc(doc(asSuper(env).firestore(), 'campServantRequests', 'req-new'), signUp()),
    );
  });

  it('refuses an update, so an accepted sign-up cannot be edited in place', async () => {
    await assertFails(
      updateDoc(doc(asCampLead(env).firestore(), 'campServantRequests', 'req-1'), {
        message: 'edited',
      }),
    );
  });

  it('lets the camp read the queue, and only its own', async () => {
    const db = asCampLead(env).firestore();
    await assertSucceeds(getDoc(doc(db, 'campServantRequests', 'req-1')));
    await assertSucceeds(
      getDocs(
        query(
          collection(db, 'campServantRequests'),
          where('programId', '==', CAMP),
          where('season', '==', SEASON),
        ),
      ),
    );
    // Another ministry's sign-up, and the unconstrained query that would
    // return it. Both refused — the second is decision #10 again.
    await assertFails(getDoc(doc(db, 'campServantRequests', 'req-other')));
    await assertFails(getDocs(collection(db, 'campServantRequests')));
  });

  it('refuses the queue to everybody without the camp', async () => {
    for (const who of [asAnon, asEveryArea, asOtherLead, asWeekVolunteer]) {
      await assertFails(getDoc(doc(who(env).firestore(), 'campServantRequests', 'req-1')));
    }
  });

  it('lets the camp dismiss a sign-up, and nobody else', async () => {
    await assertFails(
      deleteDoc(doc(asEveryArea(env).firestore(), 'campServantRequests', 'req-1')),
    );
    await assertFails(deleteDoc(doc(asAnon(env).firestore(), 'campServantRequests', 'req-1')));
    await assertSucceeds(
      deleteDoc(doc(asCampLead(env).firestore(), 'campServantRequests', 'req-1')),
    );
  });
});

/**
 * The one key on `config/camp` a camp administrator may write.
 *
 * `config` is superadmin-only and deliberately not delegable through /access —
 * it is where the site is pointed at its backends. The camp\u2019s own settings are
 * not that: the season, the week dates, the fee, the waiver and the two form
 * switches are decisions about running this camp, made by whoever runs it,
 * several times a season.
 *
 * The widening was one boolean wide until 2 Sep 2026 and is now the whole
 * document **except `programId`** — which names the ministry whose grant opens
 * the camp, and is therefore the one key a camp administrator writing it would
 * be using to give themselves somebody else's. These are the assertions that
 * keep that line where it is.
 */
describe('the camp’s own settings', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'config', 'camp'), {
        programId: CAMP,
        season: SEASON,
        baseCents: 15000,
        weeks: 2,
        waiverVersion: '',
        waiverText: '',
        note: '',
        servantSignUp: true,
        familyRegistration: true,
      });
    });
  });

  it('lets the camp close and reopen sign-ups', async () => {
    const db = asCampLead(env).firestore();
    await assertSucceeds(updateDoc(doc(db, 'config', 'camp'), { servantSignUp: false }));
    await assertSucceeds(updateDoc(doc(db, 'config', 'camp'), { servantSignUp: true }));
  });

  it('lets the camp set its season, its dates, its fee and its other form', async () => {
    const db = asCampLead(env).firestore();
    await assertSucceeds(updateDoc(doc(db, 'config', 'camp'), { season: '2028' }));
    await assertSucceeds(
      updateDoc(doc(db, 'config', 'camp'), { weeks: 2, weekStarts: ['2028-06-19', '2028-06-26'] }),
    );
    await assertSucceeds(updateDoc(doc(db, 'config', 'camp'), { baseCents: 12500 }));
    await assertSucceeds(updateDoc(doc(db, 'config', 'camp'), { familyRegistration: false }));
    await assertSucceeds(
      updateDoc(doc(db, 'config', 'camp'), { waiverText: 'Please sign.', waiverVersion: 'v2' }),
    );
  });

  it('refuses the one key that would hand the camp to somebody else', async () => {
    const db = asCampLead(env).firestore();
    // Re-filing the camp under a ministry this person administers is how a
    // grant for one program becomes a grant for the camp.
    await assertFails(updateDoc(doc(db, 'config', 'camp'), { programId: 'youth' }));
    await assertFails(
      updateDoc(doc(db, 'config', 'camp'), { servantSignUp: false, programId: 'youth' }),
    );
  });

  it('refuses a value no screen could have produced', async () => {
    const db = asCampLead(env).firestore();
    // Not a boolean: a truthy string would read as `true` in a template and as
    // `false` through `parseCampConfig`, which is the worst possible split.
    await assertFails(updateDoc(doc(db, 'config', 'camp'), { servantSignUp: 'yes' }));
    await assertFails(updateDoc(doc(db, 'config', 'camp'), { familyRegistration: 'yes' }));
    // A fee nobody would set, and more weeks than a camp can run.
    await assertFails(updateDoc(doc(db, 'config', 'camp'), { baseCents: 500000 }));
    await assertFails(updateDoc(doc(db, 'config', 'camp'), { baseCents: -1 }));
    await assertFails(updateDoc(doc(db, 'config', 'camp'), { weeks: 7 }));
    // A key nothing on the camp's settings has ever had.
    await assertFails(updateDoc(doc(db, 'config', 'camp'), { squareToken: 'x' }));
  });

  it('refuses somebody who runs a different ministry', async () => {
    await assertFails(
      updateDoc(doc(asOtherLead(env).firestore(), 'config', 'camp'), { servantSignUp: false }),
    );
    await assertFails(
      updateDoc(doc(asEveryArea(env).firestore(), 'config', 'camp'), { servantSignUp: false }),
    );
    await assertFails(
      updateDoc(doc(asAnon(env).firestore(), 'config', 'camp'), { servantSignUp: false }),
    );
  });
});
