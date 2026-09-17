import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { assertSucceeds, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  Timestamp,
} from 'firebase/firestore';
import { createTestEnv, asAnon, asSignedIn, asSuper } from './helpers.js';

/**
 * `faults` — the app's own crash reporter, against a real emulator.
 *
 * ---------------------------------------------------------------------------
 * The shape under test is deliberately unusual and both halves have to hold:
 * **anyone may create, nobody may ever read.**
 *
 * The open create is not an oversight. The failure being reported may be the
 * one that stopped sign-in from finishing, so a reporter that needs a working
 * app to report a broken one reports nothing. App Check gates it in production,
 * which rules cannot express and this cannot test.
 *
 * The closed read is the privacy half. A stack trace names the screen somebody
 * was on, and a collection of them is a record of who used what and when — the
 * app's privacy notice says plainly that no such record is kept, and the only
 * thing making that true is this rule.
 *
 * `rules:check` compiles the ruleset and proves neither. These are the
 * assertions that would catch a `faults` block that compiled and denied every
 * write — which is the failure mode that matters here, because the reporter
 * swallows its own errors by design and a refused write is *completely
 * silent*. Nothing in any log would say the crash reporting had stopped.
 * ---------------------------------------------------------------------------
 */

/** A document the rule should accept, which each test then varies one field of. */
function goodFault(overrides: Record<string, unknown> = {}) {
  return {
    message: 'Cannot read properties of undefined',
    stack: 'at CalendarScreen (src/calendar/CalendarScreen.tsx:120:9)',
    source: 'render',
    route: '/calendar',
    platform: 'ios',
    version: '1.0.0',
    dev: false,
    at: serverTimestamp(),
    // FAULT_TTL_DAYS is 30; the rule allows up to 31 so an ordinary
    // few-minutes-wrong phone clock is not a rejection.
    expiresAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

describe('faults', () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await createTestEnv('faults');
  });

  afterAll(async () => {
    await env.cleanup();
  });

  describe('creating', () => {
    it('accepts a well-formed fault from somebody signed out', async () => {
      // The whole point: the crash may have been sign-in failing.
      const db = asAnon(env).firestore();
      await assertSucceeds(addDoc(collection(db, 'faults'), goodFault()));
    });

    it('accepts one from somebody signed in', async () => {
      const db = asSignedIn(env).firestore();
      await assertSucceeds(addDoc(collection(db, 'faults'), goodFault()));
    });

    it('accepts the handler source as well as render', async () => {
      const db = asAnon(env).firestore();
      await assertSucceeds(addDoc(collection(db, 'faults'), goodFault({ source: 'handler' })));
    });

    it('accepts android, and a dev build', async () => {
      const db = asAnon(env).firestore();
      await assertSucceeds(
        addDoc(collection(db, 'faults'), goodFault({ platform: 'android', dev: true })),
      );
    });

    it('accepts an empty stack, because plenty of thrown values carry none', async () => {
      const db = asAnon(env).firestore();
      await assertSucceeds(addDoc(collection(db, 'faults'), goodFault({ stack: '' })));
    });
  });

  describe('refusing a malformed fault', () => {
    it('refuses an empty message, which would be a document saying nothing', async () => {
      const db = asAnon(env).firestore();
      await assertFails(addDoc(collection(db, 'faults'), goodFault({ message: '' })));
    });

    it('refuses a missing field', async () => {
      const db = asAnon(env).firestore();
      const { dev, ...withoutDev } = goodFault();
      await assertFails(addDoc(collection(db, 'faults'), withoutDev));
    });

    it('refuses an extra field, which is how a uid would arrive', async () => {
      /*
       * The one that guards the privacy claim from the inside. A future edit
       * that starts attaching `uid` to make triage easier has to come here and
       * change this test, which is the moment somebody has to notice that the
       * notice promises otherwise.
       */
      const db = asAnon(env).firestore();
      await assertFails(addDoc(collection(db, 'faults'), goodFault({ uid: 'servant-1' })));
    });

    it('refuses an unknown source', async () => {
      const db = asAnon(env).firestore();
      await assertFails(addDoc(collection(db, 'faults'), goodFault({ source: 'native' })));
    });

    it('refuses a platform that is not ios or android', async () => {
      const db = asAnon(env).firestore();
      await assertFails(addDoc(collection(db, 'faults'), goodFault({ platform: 'web' })));
    });

    it('refuses a message or stack past the cap', async () => {
      // FAULT_MESSAGE_MAX 500, FAULT_STACK_MAX 4000. Without these the
      // collection is an open store for arbitrary text nobody can read.
      const db = asAnon(env).firestore();
      await assertFails(addDoc(collection(db, 'faults'), goodFault({ message: 'x'.repeat(501) })));
      await assertFails(addDoc(collection(db, 'faults'), goodFault({ stack: 'x'.repeat(4001) })));
    });

    it('refuses a route long enough to be a payload', async () => {
      const db = asAnon(env).firestore();
      await assertFails(addDoc(collection(db, 'faults'), goodFault({ route: '/'.repeat(201) })));
    });

    it('refuses a client-chosen timestamp for `at`', async () => {
      const db = asAnon(env).firestore();
      await assertFails(
        addDoc(collection(db, 'faults'), goodFault({ at: Timestamp.fromMillis(0) })),
      );
    });

    it('refuses an expiry already past, or parked years out', async () => {
      /*
       * The TTL sweep reads `expiresAt` and nothing else, so a document with a
       * distant one never leaves. Pinned against the server's clock rather than
       * the phone's for that reason.
       */
      const db = asAnon(env).firestore();
      await assertFails(
        addDoc(collection(db, 'faults'), goodFault({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) })),
      );
      await assertFails(
        addDoc(
          collection(db, 'faults'),
          goodFault({ expiresAt: Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000) }),
        ),
      );
    });
  });

  describe('reading, updating and deleting', () => {
    beforeAll(async () => {
      // Seeded past the rules, because no client may create one to read back.
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'faults', 'seeded'), {
          ...goodFault(),
          at: Timestamp.now(),
        });
      });
    });

    it('is unreadable by everyone, including a super admin', async () => {
      /*
       * Including the super admin, deliberately. Staff read these in the
       * Firebase console, where the access is the console's own and is logged;
       * a client path to them would make a phone able to enumerate the
       * collection and there is no reason for one to.
       */
      await assertFails(getDoc(doc(asAnon(env).firestore(), 'faults', 'seeded')));
      await assertFails(getDoc(doc(asSignedIn(env).firestore(), 'faults', 'seeded')));
      await assertFails(getDoc(doc(asSuper(env).firestore(), 'faults', 'seeded')));
      await assertFails(getDocs(collection(asSuper(env).firestore(), 'faults')));
    });

    it('cannot be edited or deleted by anybody', async () => {
      // Append-only: a fault that can be edited is not evidence of anything.
      await assertFails(
        updateDoc(doc(asSuper(env).firestore(), 'faults', 'seeded'), { message: 'nothing to see' }),
      );
      await assertFails(deleteDoc(doc(asSuper(env).firestore(), 'faults', 'seeded')));
    });
  });
});
