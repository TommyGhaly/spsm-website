import { beforeAll, afterAll, describe, it } from 'vitest';
import { assertSucceeds, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';
import { createTestEnv, asAnon, asServant, asStaff } from './helpers.js';

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
  env = await createTestEnv(true);
  await env.clearStorage();
});

afterAll(async () => {
  await env.cleanup();
});

describe('submissions/ — the quarantine prefix', () => {
  it('accepts a photograph from somebody with no account', async () => {
    const storage = asAnon(env).storage();
    await assertSucceeds(uploadBytes(ref(storage, `submissions/week-1-2027/a-${RUN}.png`), png, meta));
  });

  it('accepts a video, which the parish asked for', async () => {
    const storage = asAnon(env).storage();
    await assertSucceeds(
      uploadBytes(ref(storage, `submissions/week-1-2027/clip-${RUN}.mp4`), png, { contentType: 'video/mp4' }),
    );
  });

  /**
   * The line the whole moderation model rests on — and the exact boundary it
   * draws, which is *not* "nobody".
   *
   * This read was `if false` until the approval queue was built, at which point
   * it turned out to lock out the one person who has to see the file. An
   * administrator approving a photograph without looking at it is not
   * moderation. So the rule is staff-and-above, and these two assertions are
   * what keep that from drifting into "anyone signed in": a servant has an
   * account and is still on the public side of this line.
   */
  it('refuses to let the public or a servant read back a submission', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'submissions/week-1-2027/secret.png'), png, meta);
    });

    await assertFails(getBytes(ref(asAnon(env).storage(), 'submissions/week-1-2027/secret.png')));
    await assertFails(getBytes(ref(asServant(env).storage(), 'submissions/week-1-2027/secret.png')));
  });

  /** The other half of the same line: review has to be possible. */
  it('lets staff read a submission, so the approval queue can show it', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'submissions/week-1-2027/review-me.png'), png, meta);
    });
    await assertSucceeds(getBytes(ref(asStaff(env).storage(), 'submissions/week-1-2027/review-me.png')));
  });

  it('refuses to let a submitter read back the file they just uploaded', async () => {
    const storage = asAnon(env).storage();
    await assertSucceeds(uploadBytes(ref(storage, `submissions/week-1-2027/mine-${RUN}.png`), png, meta));
    await assertFails(getBytes(ref(storage, `submissions/week-1-2027/mine-${RUN}.png`)));
  });

  /**
   * The consequence of the `exists()` bug. An uploader who can overwrite can
   * swap an approved file for something else after an administrator has looked
   * at it — the review would have been of a file that is no longer there.
   */
  it('refuses to overwrite a file that is already there', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'submissions/week-1-2027/taken.png'), png, meta);
    });
    await assertFails(uploadBytes(ref(asAnon(env).storage(), 'submissions/week-1-2027/taken.png'), png, meta));
  });

  it('refuses a file that is neither image nor video', async () => {
    const storage = asAnon(env).storage();
    await assertFails(
      uploadBytes(ref(storage, 'submissions/week-1-2027/payload.html'), png, { contentType: 'text/html' }),
    );
    await assertFails(
      uploadBytes(ref(storage, 'submissions/week-1-2027/run.sh'), png, { contentType: 'application/x-sh' }),
    );
  });

  it('refuses an anonymous delete, so submissions cannot be withdrawn from under a reviewer', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'submissions/week-1-2027/pending.png'), png, meta);
    });
    await assertFails(deleteObject(ref(asAnon(env).storage(), 'submissions/week-1-2027/pending.png')));
    await assertSucceeds(deleteObject(ref(asStaff(env).storage(), 'submissions/week-1-2027/pending.png')));
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
    await assertFails(uploadBytes(ref(asStaff(env).storage(), 'galleries/x/a.png'), png, meta));
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

  it('accepts an upload from staff and refuses one from everybody below', async () => {
    await assertSucceeds(
      uploadBytes(ref(asStaff(env).storage(), 'events/festival/hero-2.png'), png, meta),
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
      uploadBytes(ref(asStaff(env).storage(), 'events/festival/notes.pdf'), png, {
        contentType: 'application/pdf',
      }),
    );
  });

  /**
   * The regression test. This is the one that failed before the rule was split
   * into `create, update` and `delete`.
   */
  it('lets staff delete a hero image, so "Remove photograph" actually removes it', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'events/festival/hero-old.png'), png, meta);
    });
    await assertSucceeds(deleteObject(ref(asStaff(env).storage(), 'events/festival/hero-old.png')));
  });

  it('still refuses a delete from anybody below staff', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'events/festival/hero-keep.png'), png, meta);
    });
    await assertFails(deleteObject(ref(asAnon(env).storage(), 'events/festival/hero-keep.png')));
    await assertFails(deleteObject(ref(asServant(env).storage(), 'events/festival/hero-keep.png')));
  });
});
