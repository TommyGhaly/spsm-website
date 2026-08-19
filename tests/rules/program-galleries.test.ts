import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
  type RulesTestContext,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { createTestEnv, asAnon, asServant, asAdmin } from './helpers.js';

/**
 * Program galleries: the queries the site issues, and the ones an attacker
 * would.
 *
 * Two things here cannot be checked any other way:
 *
 *  1. **The list-query trap.** Public gallery reads are `status == 'approved'`,
 *     and Firestore evaluates a list against what it *could* return. If the
 *     client forgets `where('status','==','approved')`, the whole query is
 *     denied — not filtered. That is decision #10 in a new collection, and it
 *     fails at build time in a way a compile check cannot see.
 *
 *  2. **Program grants are read from a Firestore document**, not the token.
 *     That is the only permission on this site with that property, so "a member
 *     cannot grant themselves one" has to be an assertion rather than a comment.
 */

let env: RulesTestEnvironment;

const SUMMERCAMP = 'summercamp';
const SENIORS = 'st-simon';
const WEEK_1 = 'week-1-2027';
const WEEK_2 = 'week-2-2027';

/** Holds Summercamp outright: every event under it, this year and every year. */
const asProgramLead = (e: RulesTestEnvironment) => e.authenticatedContext('lead-1', { role: 'servant' });
/** Helps with one week only. Must not inherit Week 2. */
const asWeekVolunteer = (e: RulesTestEnvironment) => e.authenticatedContext('vol-1', { role: 'servant' });
/** Signed in, trusted with nothing. */
const asOutsider = (e: RulesTestEnvironment) => e.authenticatedContext('nobody-1', { role: 'servant' });

function media(over: Record<string, unknown> = {}) {
  return {
    programId: SUMMERCAMP,
    programEventId: WEEK_1,
    groupId: null,
    kind: 'photo',
    status: 'pending',
    sourcePath: `submissions/${WEEK_1}/abc.heic`,
    renditionPath: null,
    posterPath: null,
    width: null,
    height: null,
    durationSeconds: null,
    caption: '',
    focal: { x: 0.5, y: 0.5 },
    placement: { onPage: false, slideshow: false, homepage: false },
    layout: null,
    order: 0,
    submittedAt: new Date(),
    reviewedAt: null,
    reviewedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedBy: null,
    ...over,
  };
}

beforeAll(async () => {
  env = await createTestEnv();
  await env.clearFirestore();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, 'programs', SUMMERCAMP), {
      slug: SUMMERCAMP, name: 'Summercamp', description: '', coverMediaId: null,
      order: 10, published: true, publishAt: null,
      createdAt: new Date(), updatedAt: new Date(), updatedBy: null,
    });
    await setDoc(doc(db, 'programs', SENIORS), {
      slug: SENIORS, name: 'St. Simon for Seniors', description: '', coverMediaId: null,
      order: 20, published: false, publishAt: null,
      createdAt: new Date(), updatedAt: new Date(), updatedBy: null,
    });

    for (const [id, open] of [[WEEK_1, true], [WEEK_2, false]] as const) {
      await setDoc(doc(db, 'programEvents', id), {
        programId: SUMMERCAMP, slug: id, title: id, description: '',
        startAt: null, endAt: null, timeZone: 'America/New_York',
        groups: [], coverMediaId: null, calendarEventId: null,
        submissionsOpen: open, published: true, publishAt: null,
        createdAt: new Date(), updatedAt: new Date(), updatedBy: null,
      });
    }

    await setDoc(doc(db, 'galleryMedia', 'approved-1'), media({ status: 'approved' }));
    await setDoc(doc(db, 'galleryMedia', 'pending-1'), media());
    await setDoc(doc(db, 'galleryMedia', 'week2-approved'), media({
      status: 'approved', programEventId: WEEK_2,
    }));

    // The grants themselves. Written here through the bypass because in
    // production only a superadmin can set them — which is the next suite down.
    await setDoc(doc(db, 'members', 'lead-1'), {
      roleMirror: 'servant', groupsMirror: [],
      programAdmin: { programs: [SUMMERCAMP], events: [] },
    });
    await setDoc(doc(db, 'members', 'vol-1'), {
      roleMirror: 'servant', groupsMirror: [],
      programAdmin: { programs: [], events: [WEEK_1] },
    });
    await setDoc(doc(db, 'members', 'nobody-1'), {
      roleMirror: 'servant', groupsMirror: [],
      programAdmin: { programs: [], events: [] },
    });
  });
});

describe('public gallery reads', () => {
  it('allows the query the site actually issues', async () => {
    const db = asAnon(env).firestore();
    await assertSucceeds(
      getDocs(query(
        collection(db, 'galleryMedia'),
        where('programEventId', '==', WEEK_1),
        where('status', '==', 'approved'),
      )),
    );
  });

  /**
   * The one that matters. Not "returns fewer rows" — *denied outright*. A
   * client that forgets the status filter gets an empty gallery and an error in
   * the console, and the page looks like it failed to load.
   */
  it('denies the same query without the status filter', async () => {
    const db = asAnon(env).firestore();
    await assertFails(
      getDocs(query(collection(db, 'galleryMedia'), where('programEventId', '==', WEEK_1))),
    );
  });

  it('denies a direct read of a pending photograph', async () => {
    await assertFails(getDoc(doc(asAnon(env).firestore(), 'galleryMedia', 'pending-1')));
  });

  it('allows a direct read of an approved one', async () => {
    await assertSucceeds(getDoc(doc(asAnon(env).firestore(), 'galleryMedia', 'approved-1')));
  });

  it('denies listing pending media, which is the queue an outsider would want', async () => {
    const db = asAnon(env).firestore();
    await assertFails(
      getDocs(query(collection(db, 'galleryMedia'), where('status', '==', 'pending'))),
    );
  });

  it('hides an unpublished program', async () => {
    await assertFails(getDoc(doc(asAnon(env).firestore(), 'programs', SENIORS)));
  });
});

describe('anonymous submission', () => {
  it('accepts a well-formed pending upload from nobody at all', async () => {
    await assertSucceeds(addDoc(collection(asAnon(env).firestore(), 'galleryMedia'), media()));
  });

  it('refuses one that arrives already approved', async () => {
    await assertFails(
      addDoc(collection(asAnon(env).firestore(), 'galleryMedia'), media({ status: 'approved' })),
    );
  });

  it('refuses one that places itself on the page', async () => {
    await assertFails(
      addDoc(collection(asAnon(env).firestore(), 'galleryMedia'), media({
        placement: { onPage: true, slideshow: false, homepage: false },
      })),
    );
  });

  it('refuses one that places itself on the homepage', async () => {
    await assertFails(
      addDoc(collection(asAnon(env).firestore(), 'galleryMedia'), media({
        placement: { onPage: false, slideshow: false, homepage: true },
      })),
    );
  });

  it('refuses one that arrives pre-reviewed', async () => {
    await assertFails(
      addDoc(collection(asAnon(env).firestore(), 'galleryMedia'), media({
        reviewedBy: 'lead-1', reviewedAt: new Date(),
      })),
    );
  });

  it('refuses a submission to an event that has closed submissions', async () => {
    await assertFails(
      addDoc(collection(asAnon(env).firestore(), 'galleryMedia'), media({ programEventId: WEEK_2 })),
    );
  });

  it('refuses a submission to an event that does not exist', async () => {
    await assertFails(
      addDoc(collection(asAnon(env).firestore(), 'galleryMedia'), media({ programEventId: 'invented' })),
    );
  });

  /**
   * `sourcePath` is what the transcode Function copies into the public bucket,
   * using the Admin SDK, which ignores storage.rules. Left unconstrained, an
   * anonymous stranger names the file that gets published — and `submissions/`
   * is the one prefix nobody can otherwise read.
   */
  it('refuses a submission pointing at another event\'s quarantine folder', async () => {
    await assertFails(
      addDoc(collection(asAnon(env).firestore(), 'galleryMedia'), media({
        sourcePath: `submissions/${WEEK_2}/somebody-elses.heic`,
      })),
    );
  });

  it('refuses a submission pointing outside the quarantine folder entirely', async () => {
    const db = asAnon(env).firestore();
    for (const sourcePath of [
      'galleries/summercamp/already-public.webp',
      'members/lead-1/avatar.jpg',
      'clergy/portrait.jpg',
      `submissions/${WEEK_1}/nested/deeper.heic`,
    ]) {
      await assertFails(addDoc(collection(db, 'galleryMedia'), media({ sourcePath })));
    }
  });

  /**
   * `programId` is denormalised so the approval queue can filter without a
   * join, which also makes it forgeable. Unchecked, a submitter chooses whose
   * queue their upload appears in.
   */
  it('refuses a submission whose programId disagrees with its event', async () => {
    await assertFails(
      addDoc(collection(asAnon(env).firestore(), 'galleryMedia'), media({ programId: SENIORS })),
    );
  });

  it('refuses a submission of an invented kind', async () => {
    await assertFails(
      addDoc(collection(asAnon(env).firestore(), 'galleryMedia'), media({ kind: 'executable' })),
    );
  });

  it('accepts a video, which is a kind the parish does want', async () => {
    await assertSucceeds(
      addDoc(collection(asAnon(env).firestore(), 'galleryMedia'), media({
        kind: 'video', sourcePath: `submissions/${WEEK_1}/clip.mov`,
      })),
    );
  });

  it('does not let a submitter edit or delete their own upload afterwards', async () => {
    const db = asAnon(env).firestore();
    await assertFails(updateDoc(doc(db, 'galleryMedia', 'pending-1'), { caption: 'mine' }));
    await assertFails(deleteDoc(doc(db, 'galleryMedia', 'pending-1')));
  });
});

describe('program grants', () => {
  it('lets a program lead approve a photograph', async () => {
    await assertSucceeds(
      updateDoc(doc(asProgramLead(env).firestore(), 'galleryMedia', 'pending-1'), {
        status: 'approved', reviewedBy: 'lead-1', reviewedAt: new Date(),
      }),
    );
  });

  it('lets a program lead list the pending queue for their program', async () => {
    const db = asProgramLead(env).firestore();
    await assertSucceeds(
      getDocs(query(
        collection(db, 'galleryMedia'),
        where('programId', '==', SUMMERCAMP),
        where('status', '==', 'pending'),
      )),
    );
  });

  it('denies a program lead the pending queue of a program they do not hold', async () => {
    const db = asProgramLead(env).firestore();
    await assertFails(
      getDocs(query(
        collection(db, 'galleryMedia'),
        where('programId', '==', SENIORS),
        where('status', '==', 'pending'),
      )),
    );
  });

  it('lets a program lead create a new event under their program', async () => {
    await assertSucceeds(
      addDoc(collection(asProgramLead(env).firestore(), 'programEvents'), {
        programId: SUMMERCAMP, slug: 'week-3-2027', title: 'Week 3', description: '',
        startAt: null, endAt: null, timeZone: 'America/New_York', groups: [],
        coverMediaId: null, calendarEventId: null, submissionsOpen: true,
        published: false, publishAt: null,
        createdAt: new Date(), updatedAt: new Date(), updatedBy: 'lead-1',
      }),
    );
  });

  it('denies a program lead creating an event under a program they do not hold', async () => {
    await assertFails(
      addDoc(collection(asProgramLead(env).firestore(), 'programEvents'), {
        programId: SENIORS, slug: 'outing', title: 'Outing', description: '',
        startAt: null, endAt: null, timeZone: 'America/New_York', groups: [],
        coverMediaId: null, calendarEventId: null, submissionsOpen: true,
        published: false, publishAt: null,
        createdAt: new Date(), updatedAt: new Date(), updatedBy: 'lead-1',
      }),
    );
  });

  it('lets an event volunteer edit the one event they hold', async () => {
    await assertSucceeds(
      updateDoc(doc(asWeekVolunteer(env).firestore(), 'programEvents', WEEK_1), {
        description: 'A good week.',
      }),
    );
  });

  /** The point of granting an event rather than a program. */
  it('denies an event volunteer the next week of the same program', async () => {
    await assertFails(
      updateDoc(doc(asWeekVolunteer(env).firestore(), 'programEvents', WEEK_2), {
        description: 'Not mine.',
      }),
    );
  });

  it('denies an event volunteer creating a new event', async () => {
    await assertFails(
      addDoc(collection(asWeekVolunteer(env).firestore(), 'programEvents'), {
        programId: SUMMERCAMP, slug: 'week-9', title: 'Week 9', description: '',
        startAt: null, endAt: null, timeZone: 'America/New_York', groups: [],
        coverMediaId: null, calendarEventId: null, submissionsOpen: true,
        published: false, publishAt: null,
        createdAt: new Date(), updatedAt: new Date(), updatedBy: 'vol-1',
      }),
    );
  });

  it('denies an event volunteer renaming the program itself', async () => {
    await assertFails(
      updateDoc(doc(asWeekVolunteer(env).firestore(), 'programs', SUMMERCAMP), { name: 'Mine now' }),
    );
  });

  it('denies a signed-in outsider everything', async () => {
    const db = asOutsider(env).firestore();
    await assertFails(updateDoc(doc(db, 'galleryMedia', 'pending-1'), { status: 'approved' }));
    await assertFails(updateDoc(doc(db, 'programEvents', WEEK_1), { description: 'x' }));
    await assertFails(getDoc(doc(db, 'galleryMedia', 'pending-1')));
  });

  /**
   * Moving an event into a program you do not administer would otherwise be a
   * way to acquire an event under somebody else's program — the write is
   * allowed by the document you hold and lands somewhere you do not.
   */
  it('denies moving an event into a program the writer does not hold', async () => {
    await assertFails(
      updateDoc(doc(asWeekVolunteer(env).firestore(), 'programEvents', WEEK_1), {
        programId: SENIORS,
      }),
    );
  });

  it('lets a superadmin do all of it', async () => {
    const db = asAdmin(env).firestore();
    await assertSucceeds(updateDoc(doc(db, 'programs', SENIORS), { name: 'St. Simon' }));
    await assertSucceeds(updateDoc(doc(db, 'galleryMedia', 'pending-1'), { status: 'rejected' }));
    await assertSucceeds(deleteDoc(doc(db, 'programEvents', WEEK_2)));
  });
});

/**
 * Grants live in a Firestore document rather than a token claim, so the usual
 * argument — "rules read the token, a forged mirror grants nothing" — does not
 * apply to them. These are the assertions that replace it.
 */
describe('a member cannot grant themselves a program', () => {
  it('refuses a self-written member document carrying grants', async () => {
    const db = asServant(env, 'fresh-1').firestore();
    await assertFails(
      setDoc(doc(db, 'members', 'fresh-1'), {
        roleMirror: 'member', groupsMirror: [],
        programAdmin: { programs: [SUMMERCAMP], events: [] },
      }),
    );
  });

  it('allows a self-written member document with empty grants', async () => {
    const db = asServant(env, 'fresh-2').firestore();
    await assertSucceeds(
      setDoc(doc(db, 'members', 'fresh-2'), {
        roleMirror: 'member', groupsMirror: [],
        programAdmin: { programs: [], events: [] },
      }),
    );
  });

  it('refuses adding a grant to an existing member document', async () => {
    await assertFails(
      updateDoc(doc(asOutsider(env).firestore(), 'members', 'nobody-1'), {
        programAdmin: { programs: [SUMMERCAMP], events: [] },
      }),
    );
  });

  /**
   * Revoking your own is refused too, matching how `screenAdmin` is pinned. A
   * support call about access that silently vanished is worse than one about
   * access never given.
   */
  it('refuses removing a grant from your own member document', async () => {
    await assertFails(
      updateDoc(doc(asProgramLead(env).firestore(), 'members', 'lead-1'), {
        programAdmin: { programs: [], events: [] },
      }),
    );
  });
});
