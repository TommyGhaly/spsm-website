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
    await assertSucceeds(uploadBytes(ref(storage, 'submissions/week-1-2027/a.png'), png, meta));
  });

  it('accepts a video, which the parish asked for', async () => {
    const storage = asAnon(env).storage();
    await assertSucceeds(
      uploadBytes(ref(storage, 'submissions/week-1-2027/clip.mp4'), png, { contentType: 'video/mp4' }),
    );
  });

  /** The line the whole moderation model rests on. */
  it('refuses to let anyone read back a submission', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'submissions/week-1-2027/secret.png'), png, meta);
    });

    await assertFails(getBytes(ref(asAnon(env).storage(), 'submissions/week-1-2027/secret.png')));
    await assertFails(getBytes(ref(asServant(env).storage(), 'submissions/week-1-2027/secret.png')));
  });

  it('refuses to let a submitter read back the file they just uploaded', async () => {
    const storage = asAnon(env).storage();
    await assertSucceeds(uploadBytes(ref(storage, 'submissions/week-1-2027/mine.png'), png, meta));
    await assertFails(getBytes(ref(storage, 'submissions/week-1-2027/mine.png')));
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
