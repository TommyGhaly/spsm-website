import { beforeAll, afterAll, describe, it } from 'vitest';
import { assertSucceeds, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';
import {
  createTestEnv,
  asAnon,
  asAnonymousSession,
  asScreens,
  asServant,
} from './helpers.js';

/**
 * Storage reads the grants from a **claim**, not from a member document.
 *
 * The one asymmetry in the whole permission model, and it is forced: Storage
 * rules cannot read Firestore. `mirrorGrantsToClaims` copies the `screenAdmin`
 * map into a `screens` claim for exactly this file to read — see the long note
 * in packages/shared/src/claims.ts — so a fixture here passes the claim
 * directly rather than seeding a document, and a Firestore test that did the
 * same would be testing nothing.
 */
const asEvents = (env: RulesTestEnvironment) => asScreens(env, ['events'], 'events-1');
const asForms = (env: RulesTestEnvironment) => asScreens(env, ['forms'], 'forms-1');
const asContent = (env: RulesTestEnvironment) => asScreens(env, ['content'], 'content-1');
const asBookstore = (env: RulesTestEnvironment) => asScreens(env, ['bookstore'], 'bookstore-1');

/**
 * The anonymous upload path.
 *
 * Program galleries opened the first place on this site where somebody with no
 * account can put a file on the parish's infrastructure. The rules that make
 * that acceptable are three sentences long and every one of them is load
 * bearing, so they are asserted rather than described:
 *
 *   1. anyone may write to `submissions/`
 *   2. NOBODY may read from `submissions/` — not even the person who wrote it
 *   3. nobody may write to `galleries/` at all; only the Function puts files
 *      there, and it uses the Admin SDK, which ignores this file
 *
 * Sentence 2 is the one that matters most. Without it this is an anonymous
 * public file host wearing the parish's domain name, and the approval queue is
 * decorative — upload anything, share the URL, never be reviewed.
 *
 * The first draft of storage.rules wrote the overwrite guard as `!exists(...)`,
 * a Firestore function with no Storage equivalent. It compiled, `rules:check`
 * said PASS, and measured against the emulator it denied *every* upload — not
 * just overwrites. The parish's submission form would have been inert with
 * nothing anywhere reporting why. The first test below is what catches that.
 */

let env: RulesTestEnvironment;

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * A suffix nothing else has used, for the paths an anonymous CREATE writes to.
 *
 * `submissions/` allows `create` only when `resource == null` — a submitter may
 * not overwrite — so a test that uploads to a fixed path passes once and fails
 * every time afterwards against the same emulator. `npm run test:rules` hides
 * that by starting a fresh emulator per run; running the suite against an
 * already-running one (which is what you do when the emulators are up for
 * `dev:emulated`) fails on three tests that have nothing wrong with them.
 *
 * `beforeAll` calls `clearStorage()`, which ought to make this unnecessary and
 * measurably does not. Unique paths are the fix that does not depend on why.
 */
const RUN = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const meta = { contentType: 'image/png' };

beforeAll(async () => {
  env = await createTestEnv('storage', true);
  await env.clearStorage();
});

afterAll(async () => {
  await env.cleanup();
});

describe('submissions/ — the quarantine prefix', () => {
  /*
   * -------------------------------------------------------------------------
   * No client writes here. This prefix is now read-only to browsers, and the
   * upload path reaches it another way entirely.
   *
   * POST /api/gallery/upload-url hands back a v4 signed URL, which addresses
   * the GCS API directly and is never evaluated against storage.rules. That is
   * what makes shutting the door here possible without shutting the feature:
   * the signed URL is pinned to one object name, one content type and one exact
   * byte length, so the checks this prefix used to make are made before the URL
   * exists rather than after the bytes arrive.
   *
   * The tests that used to live here — accepts a photograph from nobody at all,
   * accepts a video, refuses `text/html`, refuses an overwrite — were all
   * assertions about `isSubmittable()` and `resource == null`, and both are
   * gone with the write rule. What replaced them is
   * `tests/unit/galleryUploadUrl.test.ts`.
   *
   * Note what did *not* change: the read rule. It is still `signedIn()`, still
   * deliberately wider than the ministry's own administrators, and still the
   * line the whole moderation model rests on.
   * -------------------------------------------------------------------------
   */
  it('refuses an upload from somebody with no account', async () => {
    const storage = asAnon(env).storage();
    await assertFails(uploadBytes(ref(storage, `submissions/week-1-2027/a-${RUN}.png`), png, meta));
  });

  /*
   * The one that would otherwise be missed, and the reason this test is not
   * simply the old one with `assertSucceeds` swapped out.
   *
   * Every submitter now has a uid — the upload path signs them in anonymously —
   * so a rule that asked for `signedIn()` here would be no defence whatsoever.
   * A servant is refused, and so is the ministry's own lead: nobody writes
   * these bytes from a browser, whoever they are.
   */
  it('refuses an upload from a signed-in account too', async () => {
    await assertFails(
      uploadBytes(ref(asServant(env).storage(), `submissions/week-1-2027/b-${RUN}.png`), png, meta),
    );
  });

  /**
   * The line the whole moderation model rests on — and the exact boundary it
   * draws, which is *not* "nobody".
   *
   * A submitter is anonymous in the sense that matters: they hold no grant and
   * no account anybody granted anything to. So the line is between the public
   * and the parish, and review has to be possible on the parish side or an
   * administrator is approving photographs without looking at them.
   *
   * Who may review *which* submission is a program grant, checked on the
   * `galleryMedia` document in firestore.rules. It cannot be checked here: this
   * file cannot read Firestore, and the path is keyed by `programEventId`,
   * which would need a lookup to map to a program.
   */
  it('refuses to let the public read back a submission', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'submissions/week-1-2027/secret.png'), png, meta);
    });

    await assertFails(getBytes(ref(asAnon(env).storage(), 'submissions/week-1-2027/secret.png')));
  });

  /** The other half of the same line: review has to be possible. */
  it('lets a signed-in reviewer read a submission, so the queue can show it', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'submissions/week-1-2027/review-me.png'), png, meta);
    });
    await assertSucceeds(getBytes(ref(asServant(env).storage(), 'submissions/week-1-2027/review-me.png')));
  });

  /*
   * An anonymous session can no longer read *or* write here, so the old test
   * asserting that a submitter could not read back their own upload has nothing
   * left to upload. The property it protected is covered by the public-read
   * test above; this one keeps the delete half.
   */
  it('refuses an anonymous delete, so submissions cannot be withdrawn from under a reviewer', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'submissions/week-1-2027/pending.png'), png, meta);
    });
    await assertFails(deleteObject(ref(asAnon(env).storage(), 'submissions/week-1-2027/pending.png')));
    await assertSucceeds(deleteObject(ref(asServant(env).storage(), 'submissions/week-1-2027/pending.png')));
  });
});

describe('galleries/ — the public prefix', () => {
  it('is readable by the world, which is the point of a parish gallery', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'galleries/summercamp/published.png'), png, meta);
    });
    await assertSucceeds(getBytes(ref(asAnon(env).storage(), 'galleries/summercamp/published.png')));
  });

  /**
   * No client write path, deliberately — not even staff. A client that could
   * write here could publish an image no administrator ever saw, which is the
   * approval gate removed by a different door.
   */
  it('is writable by no client at all, including staff', async () => {
    await assertFails(uploadBytes(ref(asAnon(env).storage(), 'galleries/x/a.png'), png, meta));
    await assertFails(uploadBytes(ref(asServant(env).storage(), 'galleries/x/a.png'), png, meta));
  });
});

/**
 * Event hero images.
 *
 * A staff-write, world-read prefix, and the tests below exist because the
 * obvious way to write that rule is wrong in a way nothing reports.
 *
 * It was `allow write: if hasRole('staff') && isImage()`. `write` includes
 * delete, and on a delete there is no incoming object — `request.resource` is
 * null, so `isImage()` is false and every delete is refused. Uploading worked,
 * so the admin looked finished; what actually happened was that a photograph
 * removed from an event stayed in a public bucket and stayed served at its URL.
 *
 * `npm run rules:check` passed on the broken version. Only exercising a delete
 * against the emulator tells the two apart, which is the same lesson as the
 * `!exists(...)` note at the top of this file.
 */
describe('events/ — hero images for the parish calendar', () => {
  it('is readable by the world, being an image on a public church website', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'events/festival/hero-1.png'), png, meta);
    });
    await assertSucceeds(getBytes(ref(asAnon(env).storage(), 'events/festival/hero-1.png')));
  });

  it('accepts an upload from the events grant and refuses one from everybody else', async () => {
    await assertSucceeds(
      uploadBytes(ref(asEvents(env).storage(), 'events/festival/hero-2.png'), png, meta),
    );
    await assertFails(
      uploadBytes(ref(asAnon(env).storage(), 'events/festival/anon.png'), png, meta),
    );
    await assertFails(
      uploadBytes(ref(asServant(env).storage(), 'events/festival/servant.png'), png, meta),
    );
  });

  it('refuses a non-image, so the prefix cannot become general file hosting', async () => {
    await assertFails(
      uploadBytes(ref(asEvents(env).storage(), 'events/festival/notes.pdf'), png, {
        contentType: 'application/pdf',
      }),
    );
  });

  it('takes a photograph straight off a phone, with no size ceiling', async () => {
    /*
     * The 8MB cap in `isImage()` was removed on 2026-09-01, and this is the
     * guard on that decision for the prefix it matters most on. It was written
     * as "generous", but a 12-megapixel photograph clears it routinely and a PNG
     * out of a screenshot always does — so it refused the very people who had
     * already been trusted with the area, while protecting nothing, since the
     * same person can upload eight files of 7.9MB.
     *
     * 9MB rather than something enormous: the point is that the old boundary has
     * gone, and a 250MB buffer in a test costs more than it proves.
     */
    const big = new Uint8Array(9 * 1024 * 1024);
    big.set(png);
    await assertSucceeds(
      uploadBytes(ref(asEvents(env).storage(), `events/${RUN}-big/phone.png`), big, meta),
    );
  });

  it('takes a whole batch of them, with no ceiling on the batch either', async () => {
    /*
     * The other half, and the one a throttle is most likely to break by
     * accident. Adding rate limiting to this site in September 2026 raised the
     * obvious question of whether uploads should be bounded too; the answer for
     * the events pages is that they are bounded by *count* and never by size,
     * neither per file nor totalled across a batch.
     *
     * Four files of 6MB is 24MB in one sitting — comfortably past any aggregate
     * cap somebody might be tempted to add, and well short of what a parish
     * volunteer with an afternoon of festival photographs actually sends.
     */
    const one = new Uint8Array(6 * 1024 * 1024);
    one.set(png);

    for (let i = 0; i < 4; i += 1) {
      await assertSucceeds(
        uploadBytes(ref(asEvents(env).storage(), `events/${RUN}-batch/photo-${i}.png`), one, meta),
      );
    }
  });

  /**
   * The regression test. This is the one that failed before the rule was split
   * into `create, update` and `delete`.
   */
  it('lets the events grant delete a hero image, so "Remove photograph" removes it', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'events/festival/hero-old.png'), png, meta);
    });
    await assertSucceeds(deleteObject(ref(asEvents(env).storage(), 'events/festival/hero-old.png')));
  });

  it('still refuses a delete from anybody without the grant', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'events/festival/hero-keep.png'), png, meta);
    });
    await assertFails(deleteObject(ref(asAnon(env).storage(), 'events/festival/hero-keep.png')));
    await assertFails(deleteObject(ref(asServant(env).storage(), 'events/festival/hero-keep.png')));
  });
});

/**
 * `forms/` — a form's own picture, set by staff in the builder.
 *
 * World-readable, because it is the photograph on a public card. The reason it
 * gets a test rather than a line of prose is the create/update/delete split: the
 * `events/` rule above carries a long comment about a real bug where one
 * `allow write ... && isImage()` made uploaded photographs impossible to
 * *remove*, because a delete carries no `request.resource` and so fails
 * `isImage()`. `rules:check` passed throughout. The last test here is the one
 * that tells those two policies apart.
 */
describe('forms/ — a form’s picture', () => {
  it('is readable by the world, being a picture on a public page', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), `forms/${RUN}-read/pic.png`), png, meta);
    });
    await assertSucceeds(getBytes(ref(asAnon(env).storage(), `forms/${RUN}-read/pic.png`)));
  });

  it('is writable by the forms grant and by nobody else', async () => {
    await assertSucceeds(
      uploadBytes(ref(asForms(env).storage(), `forms/${RUN}-a/pic.png`), png, meta),
    );
    await assertFails(
      uploadBytes(ref(asServant(env).storage(), `forms/${RUN}-b/pic.png`), png, meta),
    );
    await assertFails(
      uploadBytes(ref(asAnon(env).storage(), `forms/${RUN}-c/pic.png`), png, meta),
    );
  });

  it('accepts a photograph straight off a phone, with no size ceiling', async () => {
    /*
     * The 8MB cap in `isImage()` was removed on 2026-09-01. It was written as
     * "generous" and a 12-megapixel HEIC clears it routinely, so the people it
     * refused were the staff who had already been trusted with the area — while
     * protecting nothing, since the same person can upload eight files of
     * 7.9MB.
     *
     * 9MB here rather than something enormous: the point is that the old
     * boundary has gone, and a 250MB buffer in a unit test costs more than it
     * proves.
     */
    const big = new Uint8Array(9 * 1024 * 1024);
    big.set(png);
    await assertSucceeds(
      uploadBytes(ref(asForms(env).storage(), `forms/${RUN}-big/phone.png`), big, meta),
    );
  });

  it('still refuses a non-image, whatever its size', async () => {
    // What `isImage()` is actually for. A bucket that accepts `text/html` from
    // a browser will serve it back on our own domain to whoever follows a link.
    await assertFails(
      uploadBytes(ref(asForms(env).storage(), `forms/${RUN}-html/payload.html`), png, {
        contentType: 'text/html',
      }),
    );
  });

  it('lets the forms grant DELETE a picture it uploaded', async () => {
    // The regression guard. Under a single `allow write: if hasScreen('forms')
    // && isImage()` this fails, because a delete has no incoming object — and
    // the symptom in the product is a picture that can be replaced in the
    // document but never removed from a world-readable bucket.
    const path = `forms/${RUN}-del/pic.png`;
    await assertSucceeds(uploadBytes(ref(asForms(env).storage(), path), png, meta));
    await assertSucceeds(deleteObject(ref(asForms(env).storage(), path)));
  });
});

/**
 * The four prefixes that got the create/update/delete split last, on
 * 2026-09-01.
 *
 * Grouped rather than given a describe each, because there is one question to
 * ask of all four and it is the question the `events/` and `forms/` blocks
 * above already ask: can the person who put a photograph here take it away
 * again? Under a single `allow write: ... && isImage()` the answer was no, on
 * all four, silently — a delete carries no `request.resource`, so `isImage()`
 * evaluated against null and refused.
 *
 * That earns a test rather than a comment because of what the failure looked
 * like from outside. Nothing errored anywhere anybody was watching: the upload
 * worked, the admin screen said the picture was gone, the document stopped
 * pointing at it — and the file stayed in a bucket that is `allow read: if
 * true`, still served at its URL, to anyone who had ever seen it. A clergy
 * portrait of somebody who has left the parish, or a member's own avatar they
 * asked to have removed.
 */
/**
 * `content/about/{slug}/` — a photograph on one of the five About pages.
 *
 * Not a new prefix and not a new rule: it lands under the existing
 * `match /content/{allPaths=**}`, which is the whole reason the About editor
 * needed no `storage.rules` change. Asserted anyway, because "no change needed"
 * is a claim about the deployed policy and this is the only thing that can
 * check it — and because the Firestore document and the photograph beside it
 * must take the *same* grant. Somebody who can write the words and not the
 * picture has an editor that half works.
 */
describe('content/about/ — a photograph on an About page', () => {
  it('is readable by the world, being a picture on a public page', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), `content/about/who-we-are/${RUN}/pic.png`), png, meta);
    });
    await assertSucceeds(
      getBytes(ref(asAnon(env).storage(), `content/about/who-we-are/${RUN}/pic.png`)),
    );
  });

  it('is writable by the content grant and by nobody else', async () => {
    await assertSucceeds(
      uploadBytes(
        ref(asContent(env).storage(), `content/about/who-we-are/${RUN}-a/pic.png`),
        png,
        meta,
      ),
    );
    await assertFails(
      uploadBytes(
        ref(asBookstore(env).storage(), `content/about/who-we-are/${RUN}-b/pic.png`),
        png,
        meta,
      ),
    );
    await assertFails(
      uploadBytes(
        ref(asServant(env).storage(), `content/about/who-we-are/${RUN}-c/pic.png`),
        png,
        meta,
      ),
    );
    await assertFails(
      uploadBytes(
        ref(asAnon(env).storage(), `content/about/who-we-are/${RUN}-d/pic.png`),
        png,
        meta,
      ),
    );
  });

  it('refuses a file that is not an image, whoever sends it', async () => {
    // A bucket that accepts `text/html` from a browser is one that will serve
    // it back on our own domain to whoever follows a link.
    await assertFails(
      uploadBytes(
        ref(asContent(env).storage(), `content/about/who-we-are/${RUN}-e/page.html`),
        png,
        { contentType: 'text/html' },
      ),
    );
  });
});

describe('clergy/, products/, content/ and members/ — taking a photograph down', () => {
  const cases = [
    { name: 'clergy', prefix: 'clergy', granted: asContent, refused: asBookstore },
    { name: 'products', prefix: 'products', granted: asBookstore, refused: asContent },
    { name: 'content', prefix: 'content', granted: asContent, refused: asBookstore },
  ] as const;

  for (const { name, prefix, granted, refused } of cases) {
    it(`lets the ${name} grant delete a picture it uploaded`, async () => {
      const path = `${prefix}/${RUN}-del/photo.png`;
      await env.withSecurityRulesDisabled(async (ctx) => {
        await uploadBytes(ref(ctx.storage(), path), png, meta);
      });
      // The regression guard. This is the assertion that failed before the split.
      await assertSucceeds(deleteObject(ref(granted(env).storage(), path)));
    });

    it(`refuses a ${name} delete from another grant, and from a stranger`, async () => {
      const path = `${prefix}/${RUN}-keep/photo.png`;
      await env.withSecurityRulesDisabled(async (ctx) => {
        await uploadBytes(ref(ctx.storage(), path), png, meta);
      });
      // Dropping `isImage()` from the delete rule must not have taken the grant
      // check with it.
      await assertFails(deleteObject(ref(refused(env).storage(), path)));
      await assertFails(deleteObject(ref(asAnon(env).storage(), path)));
      await assertFails(deleteObject(ref(asServant(env).storage(), path)));
    });

    it(`still refuses a non-image upload to ${name}`, async () => {
      await assertFails(
        uploadBytes(ref(granted(env).storage(), `${prefix}/${RUN}-html/payload.html`), png, {
          contentType: 'text/html',
        }),
      );
    });
  }

  it('lets a member delete their own avatar', async () => {
    const path = `members/servant-1/${RUN}-avatar.png`;
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), path), png, meta);
    });
    await assertSucceeds(deleteObject(ref(asServant(env).storage(), path)));
  });

  it('does not let one member delete another member\u2019s avatar', async () => {
    /*
     * The half of the split that is easy to get wrong in the other direction.
     * The delete rule drops `isImage()` because a delete has no incoming object
     * — but it has to keep the whole ownership test, or removing one null check
     * turns "you may take down your own photograph" into "any signed-in account
     * may take down anybody's". `{uid}` comes from the path, so it is available
     * on a delete even though `request.resource` is not.
     */
    const path = `members/somebody-else/${RUN}-avatar.png`;
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), path), png, meta);
    });
    await assertFails(deleteObject(ref(asServant(env).storage(), path)));
    await assertFails(deleteObject(ref(asAnon(env).storage(), path)));
  });
});

/**
 * `formUploads/` — photographs attached by whoever fills in a form.
 *
 * -------------------------------------------------------------------------
 * No client writes here either, as of 2026-09-03. This was the last anonymous
 * write path on the site and it closed for the same reason `submissions/` did,
 * with one extra push: the rule was only ever survivable because App Check
 * enforcement on the Cloud Storage service stood in front of it, and that
 * enforcement had to come off — it was refusing every `<img>` on the public
 * site, since an image tag cannot present an App Check token.
 *
 * `POST /api/forms/upload-url` hands back a v4 signed URL, which addresses the
 * GCS API directly and is never evaluated against storage.rules.
 *
 * The tests that used to live here — accepts a photograph from somebody with no
 * account, refuses an overwrite, refuses anything that is not an image — were
 * assertions about `isImage()` and `resource == null`, and both are gone with
 * the write rule. The endpoint makes those checks *before* the URL exists, and
 * pins the content type and the exact byte length into the signature, so a
 * caller cannot declare one thing and upload another.
 *
 * Note what did not change: the read rule, and the delete rule. Both still
 * belong to the `forms` grant, and the read one is the load-bearing test in
 * this file — these are photographs members of the public send the parish, and
 * if they were world-readable this would be an anonymous file host on the
 * parish's domain with the submissions queue as decoration.
 * -------------------------------------------------------------------------
 */
describe('formUploads/ — photographs attached to a submission', () => {
  it('refuses an upload from somebody with no account', async () => {
    await assertFails(
      uploadBytes(ref(asAnon(env).storage(), `formUploads/van-request/${RUN}-a.png`), png, meta),
    );
  });

  /*
   * The one that would otherwise be missed, and the reason this is not the old
   * test with `assertSucceeds` swapped out.
   *
   * Everybody attaching a photograph now has a uid — the upload path signs them
   * in anonymously to get a key to count the day against — so a rule that asked
   * for `signedIn()` here would be no defence whatsoever. A servant is refused,
   * and so is somebody holding the `forms` grant itself: nobody writes these
   * bytes from a browser, whoever they are.
   */
  it('refuses an upload from a signed-in account, and from the forms grant', async () => {
    await assertFails(
      uploadBytes(ref(asServant(env).storage(), `formUploads/van-request/${RUN}-b.png`), png, meta),
    );
    await assertFails(
      uploadBytes(ref(asForms(env).storage(), `formUploads/van-request/${RUN}-c.png`), png, meta),
    );
  });

  it('does not let the public read one back', async () => {
    const path = `formUploads/van-request/${RUN}-d.png`;
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), path), png, meta);
    });
    await assertFails(getBytes(ref(asAnon(env).storage(), path)));
  });

  /*
   * Unlike `submissions/` above, this one *is* pinned to a grant. There is no
   * program axis here for a path to defeat: an attachment belongs to a form,
   * and the `forms` flag is what opens the replies it is attached to.
   */
  it('lets the forms grant read one, which is what the review panel does', async () => {
    const path = `formUploads/van-request/${RUN}-e.png`;
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), path), png, meta);
    });
    await assertSucceeds(getBytes(ref(asForms(env).storage(), path)));
  });

  it('refuses a signed-in member with no forms grant', async () => {
    const path = `formUploads/van-request/${RUN}-f.png`;
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), path), png, meta);
    });
    await assertFails(getBytes(ref(asServant(env).storage(), path)));
  });

  /*
   * `create, update: if false` and `delete: if hasScreen('forms')` are two
   * lines rather than one `write` for exactly the reason `submissions/` learned
   * the hard way: `write` covers delete, so a blanket refusal here would take
   * the staff panel's own tidying away with it and nothing would compile any
   * differently.
   */
  it('still lets the forms grant delete one', async () => {
    const path = `formUploads/van-request/${RUN}-g.png`;
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), path), png, meta);
    });
    await assertFails(deleteObject(ref(asAnon(env).storage(), path)));
    await assertSucceeds(deleteObject(ref(asForms(env).storage(), path)));
  });
});

/**
 * The uploader's own token, turned on this file.
 *
 * ---------------------------------------------------------------------------
 * Enabling the Anonymous provider (2026-09-04, docs/gallery-console-setup.md
 * §6) gave every gallery uploader something they had never had here: a request
 * where `request.auth != null` is true. Three rules in this file were written
 * on the assumption that could not happen, and each of them meant "somebody
 * from the church" when it said "authenticated".
 *
 * The delete is the sharp one. `submissions/` allowed a delete by anyone
 * authenticated, because rejecting a submission runs in a reviewer's browser
 * and the prefix cannot be narrowed to a program without reading Firestore —
 * which this file cannot do. Left as it was, the people *filling* the
 * quarantine folder could also empty it, and a submission could be withdrawn
 * from under a reviewer mid-decision by whoever sent it.
 *
 * The avatar path is the quiet one, and it matters because of what it undoes:
 * `members/{uid}/**` is world-readable and was writable by its own uid, and an
 * anonymous session owns its uid. That is a free, unmetered, publicly readable
 * upload target on the parish's bucket — exactly the thing the upload
 * chokepoint was built to remove, arriving back through a door nobody was
 * watching.
 * ---------------------------------------------------------------------------
 */
describe('an anonymous upload session, against the bucket', () => {
  it('cannot read back out of the quarantine prefix it writes into', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'submissions/week-1-2027/anon-read.png'), png, meta);
    });
    await assertFails(
      getBytes(ref(asAnonymousSession(env).storage(), 'submissions/week-1-2027/anon-read.png')),
    );
  });

  it('cannot delete a submission awaiting review', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'submissions/week-1-2027/anon-delete.png'), png, meta);
    });
    await assertFails(
      deleteObject(
        ref(asAnonymousSession(env).storage(), 'submissions/week-1-2027/anon-delete.png'),
      ),
    );
    // And the reviewer still can, which is the half that must not break.
    await assertSucceeds(
      deleteObject(ref(asServant(env).storage(), 'submissions/week-1-2027/anon-delete.png')),
    );
  });

  it('cannot write an avatar under its own uid, which would be a free file host', async () => {
    const anon = asAnonymousSession(env, 'anon-session-2');
    await assertFails(
      uploadBytes(
        ref(anon.storage(), `members/anon-session-2/${RUN}-avatar.png`),
        png,
        meta,
      ),
    );
  });

  it('still writes a gallery submission, because that is what the session is for', async () => {
    // The counterweight. Everything above is a denial, and a ruleset that
    // denied an anonymous session outright would pass all three and delete the
    // feature — the bytes go to a signed URL that never consults this file, so
    // what is asserted here is only that nothing in it started refusing the
    // reads the upload page itself performs.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(
        ref(ctx.storage(), `galleries/week-1-2027/${RUN}-public.png`),
        png,
        meta,
      );
    });
    await assertSucceeds(
      getBytes(ref(asAnonymousSession(env).storage(), `galleries/week-1-2027/${RUN}-public.png`)),
    );
  });
});
