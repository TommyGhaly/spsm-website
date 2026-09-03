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
 *  1. **One flag, and it is `camp` and nothing else.** A registration holds a
 *     child's allergies and medical notes, so every *other* grant on the site
 *     is refused throughout this file — including `finance`, which is why
 *     `financeRollups` exists, and including the camp's own **program grant**.
 *     `asEveryArea` holds every area /access can hand out bar the camp;
 *     `asCampMinistry` holds the camp's ministry, which is its page, its
 *     gatherings and its photographs. Both are denied everywhere below.
 *
 *     `asCampMinistry` is the new one, and the reason for the change on
 *     2 Sep 2026: it is the exact grant that used to open this collection, so
 *     these assertions are what separates "runs the camp's paperwork" from
 *     "posts the camp's pictures".
 *
 *  2. **The flag is not scoped to a ministry, and that is a real tradeoff.**
 *     A program grant could only be proven against a document, which scoped
 *     every read to the camp's own `programId` for free and cost a
 *     `where('programId','==',…)` on every query to be provable at all
 *     (decision #10). A flag is proven against the caller: an unconstrained
 *     list is now allowed, and so is a document filed under another ministry.
 *     There is one camp — one `config/camp`, one `programId` on it, which only
 *     a superadmin may write — so what this buys is a screen that cannot
 *     mistake a missing `where` for a permission failure. The assertions below
 *     say so out loud rather than leaving it to be discovered.
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
        groupName: '', note: '',
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
   * Claim 2, and this assertion changed direction on 2 Sep 2026.
   *
   * It used to be the one that mattered most: under a program grant this query
   * was denied outright rather than filtered, which on a live page is a drawer
   * that opens onto an error, and it is decision #10 in the collection where it
   * looks most like a broken screen. `runsCamp()` is proven against the caller,
   * so the constraint is no longer load-bearing and the trap is gone.
   *
   * Kept, inverted, because the screens still send the `where` and somebody
   * will eventually wonder whether they have to.
   */
  it('allows the same query without the programId filter', async () => {
    const db = asCampLead(env).firestore();
    await assertSucceeds(
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
   * Claim 1, and the assertion the whole change rests on.
   *
   * `programAdmin.programs` containing the camp's id opened this collection
   * until 2 Sep 2026. Somebody who posts the week's photographs is not somebody
   * who has been trusted with a ten-year-old's medical notes, and the two are
   * now separate grants rather than one tick with a caveat on it.
   */
  it('denies the camp’s own ministry, which is the pictures and not the paperwork', async () => {
    await assertFails(
      getDoc(doc(asCampMinistry(env).firestore(), 'campRegistrations', 'reg-1')),
    );
    await assertFails(
      getDocs(
        query(collection(asCampMinistry(env).firestore(), 'campRegistrations'), where('programId', '==', CAMP)),
      ),
    );
  });

  /**
   * An *event* grant administers a gallery, not the camp. Somebody trusted with
   * one week's photographs has not been trusted with every family's contact
   * details.
   */
  it('denies an event-scoped volunteer', async () => {
    await assertFails(getDoc(doc(asWeekVolunteer(env).firestore(), 'campRegistrations', 'reg-1')));
  });

  it('denies an anonymous visitor', async () => {
    await assertFails(getDoc(doc(asAnon(env).firestore(), 'campRegistrations', 'reg-1')));
  });

  /**
   * Claim 2's cost, asserted rather than left implicit.
   *
   * A registration filed under another ministry was refused while the grant was
   * per-program. The flag is not, so it is readable — and the only way one
   * exists at all is a superadmin re-pointing `config/camp.programId`, which is
   * the key `match /config/camp` refuses to everybody else for exactly this
   * reason. If the parish ever runs two camps under two ministries, this is the
   * test that has to fail first.
   */
  it('lets the camp grant read a registration filed under another ministry', async () => {
    await assertSucceeds(
      getDoc(doc(asCampLead(env).firestore(), 'campRegistrations', 'reg-other')),
    );
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
        { screenAdmin: everyScreenButCamp, programAdmin: { programs: [CAMP], events: [] } },
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
        desiredRolesByWeek: { w1: ['Sports'] }, assignedRoles: [], shirtSize: 'AM',
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

  it('lets the camp read the queue', async () => {
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
    // The unconstrained query, which a program grant refused outright. Claim 2:
    // the flag is proven against the caller, so this is allowed now.
    await assertSucceeds(getDocs(collection(db, 'campServantRequests')));
  });

  it('refuses the queue to the camp’s ministry and to every other area', async () => {
    for (const who of [asCampMinistry, asEveryArea, asOtherLead, asWeekVolunteer, asAnon]) {
      await assertFails(getDoc(doc(who(env).firestore(), 'campServantRequests', 'req-1')));
    }
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

  it('lets the camp set what servants may sign up for, one week and half at a time', async () => {
    const db = asCampLead(env).firestore();
    // Written by field path, which is how the settings panel saves one week's
    // half of the camp without blanking another — see `CampSettingsPatch`. The
    // underscore is why the section is spelled `middle` and not
    // `middle-school`: a hyphen makes this path unparseable.
    await assertSucceeds(
      updateDoc(doc(db, 'config', 'camp'), {
        'weekRoles.w1_elementary': ['Arts and crafts', 'Kitchen'],
      }),
    );
    await assertSucceeds(
      updateDoc(doc(db, 'config', 'camp'), { 'weekRoles.w2_middle': ['Trip'] }),
    );
    // And as a whole map, which is what a script writing the defaults sends.
    await assertSucceeds(
      updateDoc(doc(db, 'config', 'camp'), {
        weekRoles: { w1_elementary: ['Sports'], w2_middle: ['Trip'] },
      }),
    );
    // Six weeks times two halves, plus the six bare `w1` keys written before
    // the halves were told apart — a camp carrying both must still be saveable.
    await assertSucceeds(
      updateDoc(doc(db, 'config', 'camp'), {
        weekRoles: Object.fromEntries(
          Array.from({ length: 6 }, (_unused, index) => index + 1).flatMap((week) => [
            [`w${week}`, ['Old']],
            [`w${week}_elementary`, ['Sports']],
            [`w${week}_middle`, ['Sports']],
          ]),
        ),
      }),
    );
    // Not a list of lists: Firestore has no array inside an array, and the
    // rule's `is map` is what stops a client that tried.
    await assertFails(updateDoc(doc(db, 'config', 'camp'), { weekRoles: ['Sports'] }));
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
