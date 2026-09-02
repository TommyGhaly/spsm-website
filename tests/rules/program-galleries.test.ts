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
  orderBy,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { createTestEnv, asAnon, asServant, asSuper } from './helpers.js';

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
/** `UNFILED_PROGRAM_ID`, spelled out: the rules see a string, not an import. */
const UNFILED = '__unfiled';
const WEEK_1 = 'week-1-2027';
const WEEK_2 = 'week-2-2027';

/** Holds Summercamp outright: every event under it, this year and every year. */
const asProgramLead = (e: RulesTestEnvironment) => e.authenticatedContext('lead-1', {});
/** Helps with one week only. Must not inherit Week 2. */
const asWeekVolunteer = (e: RulesTestEnvironment) => e.authenticatedContext('vol-1', {});
/** Signed in, trusted with nothing. */
const asOutsider = (e: RulesTestEnvironment) => e.authenticatedContext('nobody-1', {});

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
  env = await createTestEnv('program-galleries');
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
        // `parentId: null` — a level directly under the program. Every level of
        // the tree is one of these documents; see schema/programs.ts.
        programId: SUMMERCAMP, parentId: null, slug: id, title: id, description: '',
        startAt: null, endAt: null, timeZone: 'America/New_York',
        order: 0, featuredMediaIds: [], coverMediaId: null, calendarEventId: null,
        submissionsOpen: open, published: true, publishAt: null,
        createdAt: new Date(), updatedAt: new Date(), updatedBy: null,
      });
    }

    await setDoc(doc(db, 'galleryMedia', 'approved-1'), media({ status: 'approved' }));
    await setDoc(doc(db, 'galleryMedia', 'pending-1'), media());
    await setDoc(doc(db, 'galleryMedia', 'week2-approved'), media({
      status: 'approved', programEventId: WEEK_2,
    }));

    /*
     * A photograph whose ministry was deleted. `deleteProgram` writes exactly
     * this shape — see UNFILED_PROGRAM_ID — and the whole recovery story rests
     * on what the rules then permit, which is why it is a fixture and not a
     * comment.
     */
    await setDoc(doc(db, 'galleryMedia', 'rogue-1'), media({
      status: 'approved', programId: UNFILED, programEventId: UNFILED,
    }));

    // The grants themselves. Written here through the bypass because in
    // production only a superadmin can set them — which is the next suite down.
    await setDoc(doc(db, 'members', 'lead-1'), {
      programAdmin: { programs: [SUMMERCAMP], events: [] },
    });
    await setDoc(doc(db, 'members', 'vol-1'), {
      programAdmin: { programs: [], events: [WEEK_1] },
    });
    await setDoc(doc(db, 'members', 'nobody-1'), {
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

  /*
   * The reads the gallery pages actually perform, as an anonymous visitor.
   *
   * Absent from the first version of this suite, which tested only that an
   * *unpublished* program was hidden — so a rule that denied the published ones
   * too passed everything. The pages still rendered in the browser, because the
   * client swallows a failed read and falls back to empty, and the only sign
   * was a permission-denied line in a console nobody was reading.
   */
  it('lets a stranger read a published program by id', async () => {
    await assertSucceeds(getDoc(doc(asAnon(env).firestore(), 'programs', SUMMERCAMP)));
  });

  it('lets a stranger list the published programs', async () => {
    const db = asAnon(env).firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'programs'), where('published', '==', true), orderBy('order'))),
    );
  });

  it('lets a stranger read a published program event by id', async () => {
    await assertSucceeds(getDoc(doc(asAnon(env).firestore(), 'programEvents', WEEK_1)));
  });

  it('lets a stranger list a program\'s published events', async () => {
    const db = asAnon(env).firestore();
    await assertSucceeds(
      getDocs(query(
        collection(db, 'programEvents'),
        where('programId', '==', SUMMERCAMP),
        where('published', '==', true),
      )),
    );
  });

  it('lets a stranger find one event by slug', async () => {
    const db = asAnon(env).firestore();
    await assertSucceeds(
      getDocs(query(
        collection(db, 'programEvents'),
        where('programId', '==', SUMMERCAMP),
        where('published', '==', true),
        where('slug', '==', WEEK_1),
      )),
    );
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

  /*
   * Whether the parish is collecting is one flag on the *ministry* now, and
   * these four are the whole of that change at the rules layer.
   *
   * It used to be a flag per level, and there was a test here asserting that a
   * submission to Week 2 — which the fixture closes — was refused. The opposite
   * is now correct, and it is a deliberate loss rather than a regression: the
   * upload form offers a visitor every level in the ministry, and a flag per
   * level made that picker a list with holes in it that nobody on the public side
   * could see the reason for. See `Program.submissionsOpen`.
   */
  it('accepts a submission to a level whose own submissionsOpen is false', async () => {
    await assertSucceeds(
      addDoc(collection(asAnon(env).firestore(), 'galleryMedia'), media({
        programEventId: WEEK_2,
        sourcePath: `submissions/${WEEK_2}/abc.heic`,
      })),
    );
  });

  it('refuses every submission while the ministry is not collecting', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'programs', SUMMERCAMP), { submissionsOpen: false });
    });

    const db = asAnon(env).firestore();
    // Both levels, to make it unambiguous that the ministry's flag is what
    // decided it rather than anything on the level.
    await assertFails(addDoc(collection(db, 'galleryMedia'), media()));
    await assertFails(
      addDoc(collection(db, 'galleryMedia'), media({
        programEventId: WEEK_2,
        sourcePath: `submissions/${WEEK_2}/abc.heic`,
      })),
    );
  });

  /*
   * The default, asserted rather than assumed.
   *
   * Neither program fixture carries `submissionsOpen`, which is exactly the
   * state of every program document the parish wrote before the field existed.
   * The rule reads absence as open, and `Program.submissionsOpen` says the same
   * in prose — if either changes, this test is what notices. A default of
   * `false` would deny every real upload while passing `rules:check` clean.
   */
  it('accepts a submission when the ministry has no submissionsOpen field at all', async () => {
    await assertSucceeds(addDoc(collection(asAnon(env).firestore(), 'galleryMedia'), media()));
  });

  /*
   * A level whose ministry is gone.
   *
   * Not a hypothetical: deleting a program is refused while any level remains
   * (`deleteProgram`), but that check is client-side and the rules allow the
   * delete, so an orphaned level is one console click away. Both `get()`s in the
   * rule are guarded by an `exists()` for this case — an unguarded `get()` on a
   * missing document fails the whole evaluation, which denies, but denies for a
   * reason that takes an afternoon to find.
   */
  it('refuses a submission to a level whose program no longer exists', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'programEvents', 'orphan-level'), {
        programId: 'ghost-program', parentId: null, slug: 'orphan', title: 'Orphan',
        description: '', startAt: null, endAt: null, timeZone: 'America/New_York',
        order: 0, featuredMediaIds: [], coverMediaId: null, calendarEventId: null,
        published: true, publishAt: null,
        createdAt: new Date(), updatedAt: new Date(), updatedBy: null,
      });
    });

    await assertFails(
      addDoc(collection(asAnon(env).firestore(), 'galleryMedia'), media({
        programId: 'ghost-program',
        programEventId: 'orphan-level',
        sourcePath: 'submissions/orphan-level/abc.heic',
      })),
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

/**
 * Photographs that outlived their ministry.
 *
 * Deleting a ministry re-files everything it held to `UNFILED_PROGRAM_ID` rather
 * than destroying it or leaving a dangling id. Two properties follow from the
 * rules alone, and the picture manager's whole "Not in any ministry" section
 * assumes both:
 *
 *  1. Anybody may *list* them, because they are approved and the public read is
 *     `status == 'approved'`. So the section works for whoever opens the manager
 *     rather than only for the one account that can act on it.
 *  2. Only a full `admin` may *move* one. `adminsProgramEvent` is evaluated
 *     against the stored `programId`, which is the sentinel — and a program
 *     grant names a real program, so it cannot match. A ministry lead therefore
 *     cannot quietly claim the parish's loose photographs, which is the reason
 *     `adoptUnfiledMedia` is a separate function from `setMediaNode`.
 */
describe('photographs whose ministry was deleted', () => {
  it('lets anybody list them, which is what the recovery section reads', async () => {
    for (const ctx of [asAnon(env), asProgramLead(env)]) {
      await assertSucceeds(
        getDocs(query(
          collection(ctx.firestore(), 'galleryMedia'),
          where('programId', '==', UNFILED),
          where('status', '==', 'approved'),
          orderBy('order', 'asc'),
        )),
      );
    }
  });

  it('lets a parish administrator give one a ministry', async () => {
    await assertSucceeds(
      updateDoc(doc(asSuper(env).firestore(), 'galleryMedia', 'rogue-1'), {
        programId: SUMMERCAMP, programEventId: WEEK_1, groupId: null,
      }),
    );
  });

  it('denies a program lead taking one into their own ministry', async () => {
    await assertFails(
      updateDoc(doc(asProgramLead(env).firestore(), 'galleryMedia', 'rogue-1'), {
        programId: SUMMERCAMP, programEventId: WEEK_1, groupId: null,
      }),
    );
  });

  it('denies a stranger claiming one', async () => {
    await assertFails(
      updateDoc(doc(asOutsider(env).firestore(), 'galleryMedia', 'rogue-1'), {
        programId: SUMMERCAMP, programEventId: WEEK_1, groupId: null,
      }),
    );
    await assertFails(
      updateDoc(doc(asAnon(env).firestore(), 'galleryMedia', 'rogue-1'), {
        programId: SUMMERCAMP, programEventId: WEEK_1, groupId: null,
      }),
    );
  });

  it('denies a program lead deleting one for good', async () => {
    await assertFails(deleteDoc(doc(asProgramLead(env).firestore(), 'galleryMedia', 'rogue-1')));
    await assertSucceeds(deleteDoc(doc(asSuper(env).firestore(), 'galleryMedia', 'rogue-1')));
  });
});

/**
 * Emptying a level before deleting it, which is what `deleteProgramEvent` does
 * now. The write is a `programEventId` change on every picture filed there,
 * pointed at the ministry's own id.
 */
describe('re-filing a level onto the ministry', () => {
  it('lets a program lead move a photograph onto the ministry itself', async () => {
    await assertSucceeds(
      updateDoc(doc(asProgramLead(env).firestore(), 'galleryMedia', 'approved-1'), {
        programEventId: SUMMERCAMP, groupId: null,
      }),
    );
  });

  /**
   * The pending ones move too — a submission left on a deleted level has a file
   * in quarantine and a queue that is about to vanish.
   */
  it('lets a program lead move a pending submission with them', async () => {
    await assertSucceeds(
      updateDoc(doc(asProgramLead(env).firestore(), 'galleryMedia', 'pending-1'), {
        programEventId: SUMMERCAMP,
      }),
    );
  });

  /**
   * The unfiltered read the sweep issues. It cannot carry `status == 'approved'`
   * — pending ones are exactly what it must not leave behind — so it relies on
   * `adminsProgramEvent` matching per document, which is a different clause of
   * the same rule and worth its own assertion.
   */
  it('lets a program lead list a level regardless of status', async () => {
    const db = asProgramLead(env).firestore();

    /*
     * **`programId` has to be in the query, and that is not belt and braces.**
     *
     * `where('programEventId','==',…)` alone is denied outright, with "Property
     * status is undefined on object" — the read rule opens with
     * `resource.data.status == 'approved'`, and for a list Firestore will only
     * evaluate a field the query has constrained. Adding `programId` lets
     * `adminsProgramEvent` resolve, and the whole `||` then comes out true
     * without ever needing `status`.
     *
     * Which is decision #10 wearing a different hat: the fix is not a status
     * filter (a sweep must see the pending ones) but proving the *other*
     * disjunct. `mediaFiledOn` issues exactly this pair.
     */
    await assertSucceeds(
      getDocs(query(
        collection(db, 'galleryMedia'),
        where('programId', '==', SUMMERCAMP),
        where('programEventId', '==', WEEK_1),
      )),
    );

    /** The ministry-wide version, which `deleteProgram` sweeps with. */
    await assertSucceeds(
      getDocs(query(collection(db, 'galleryMedia'), where('programId', '==', SUMMERCAMP))),
    );

    await assertFails(
      getDocs(query(
        collection(asAnon(env).firestore(), 'galleryMedia'),
        where('programId', '==', SUMMERCAMP),
        where('programEventId', '==', WEEK_1),
      )),
    );
  });

  /**
   * The volunteer case, stated because it is the one that reads as a bug. A
   * grant on Week 1 lets them empty Week 1 — the check is against the level the
   * photograph is *on* — and does not let them put it back afterwards, because
   * by then it is on the ministry. See the note in firestore.rules.
   */
  it('lets a week volunteer empty their own week but not undo it', async () => {
    const db = asWeekVolunteer(env).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'galleryMedia', 'approved-1'), { programEventId: SUMMERCAMP }),
    );
    await assertFails(
      updateDoc(doc(db, 'galleryMedia', 'approved-1'), { programEventId: WEEK_1 }),
    );
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
        parentId: null, order: 0, featuredMediaIds: [],
        startAt: null, endAt: null, timeZone: 'America/New_York',
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
        parentId: null, order: 0, featuredMediaIds: [],
        startAt: null, endAt: null, timeZone: 'America/New_York',
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
        parentId: null, order: 0, featuredMediaIds: [],
        startAt: null, endAt: null, timeZone: 'America/New_York',
        coverMediaId: null, calendarEventId: null, submissionsOpen: true,
        published: false, publishAt: null,
        createdAt: new Date(), updatedAt: new Date(), updatedBy: 'vol-1',
      }),
    );
  });

  /*
   * The tree, at the rules layer.
   *
   * A level five deep is the same document as a level one deep, so nothing in
   * `firestore.rules` counts depth — and these are here to pin that down rather
   * than to test a new branch. The one thing worth asserting is that `parentId`
   * buys nobody anything: a grant is a grant on a program or on a document, and
   * naming a parent inside somebody else's ministry does not reach it.
   */
  it('lets a program lead create a level nested inside another', async () => {
    await assertSucceeds(
      addDoc(collection(asProgramLead(env).firestore(), 'programEvents'), {
        programId: SUMMERCAMP, parentId: WEEK_1, slug: 'day-1', title: 'Day 1',
        description: '',
        startAt: null, endAt: null, timeZone: 'America/New_York',
        order: 10, featuredMediaIds: [],
        coverMediaId: null, calendarEventId: null, submissionsOpen: true,
        published: false, publishAt: null,
        createdAt: new Date(), updatedAt: new Date(), updatedBy: 'lead-1',
      }),
    );
  });

  /*
   * `programId` is the containment that matters, not `parentId`. Pointing a new
   * level at a parent in a ministry you hold does not let you file it under a
   * ministry you do not — the create is judged on `programId` alone, which is
   * what the reads filter on and therefore what decides where the level appears.
   */
  it('denies a program lead a level whose programId is not theirs, whatever its parent', async () => {
    await assertFails(
      addDoc(collection(asProgramLead(env).firestore(), 'programEvents'), {
        programId: SENIORS, parentId: WEEK_1, slug: 'day-1', title: 'Day 1',
        description: '',
        startAt: null, endAt: null, timeZone: 'America/New_York',
        order: 10, featuredMediaIds: [],
        coverMediaId: null, calendarEventId: null, submissionsOpen: true,
        published: false, publishAt: null,
        createdAt: new Date(), updatedAt: new Date(), updatedBy: 'lead-1',
      }),
    );
  });

  /** Moving a level within one's own program is an ordinary edit of it. */
  it('lets an event volunteer move the level they hold', async () => {
    await assertSucceeds(
      updateDoc(doc(asWeekVolunteer(env).firestore(), 'programEvents', WEEK_1), {
        parentId: WEEK_2,
        order: 20,
      }),
    );
  });

  /** And the pictures a level shows are part of editing it. */
  it('lets an event volunteer choose the pictures their level shows', async () => {
    await assertSucceeds(
      updateDoc(doc(asWeekVolunteer(env).firestore(), 'programEvents', WEEK_1), {
        featuredMediaIds: ['approved-1'],
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
    const db = asSuper(env).firestore();
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
        programAdmin: { programs: [SUMMERCAMP], events: [] },
      }),
    );
  });

  it('allows a self-written member document with empty grants', async () => {
    const db = asServant(env, 'fresh-2').firestore();
    await assertSucceeds(
      setDoc(doc(db, 'members', 'fresh-2'), {
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
