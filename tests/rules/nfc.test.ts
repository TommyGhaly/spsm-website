import { beforeAll, afterAll, describe, it } from 'vitest';
import { assertSucceeds, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { createTestEnv, asAnon, asSignedIn, asSuper } from './helpers.js';

/**
 * NFC tag statistics, against a real emulator.
 *
 * ---------------------------------------------------------------------------
 * The assertion that matters most is the money one. `nfcRevenue` is its own
 * collection so that the `nfc` grant alone shows which tags are used and not
 * what they took. A rule that let `nfc` read revenue would compile, would make
 * every screen look right to whoever built it, and would quietly hand the
 * parish's takings to a volunteer. So it is tested in both directions: `nfc`
 * without `finance` is refused, `finance` without `nfc` is refused, both are
 * served.
 * ---------------------------------------------------------------------------
 */

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv('nfc');
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [uid, screenAdmin] of [
      ['tags-servant', { nfc: true }],
      ['tags-treasurer', { nfc: true, finance: true }],
      ['treasurer', { finance: true }],
      ['plain-servant', {}],
    ] as const) {
      await setDoc(doc(db, `members/${uid}`), {
        displayName: uid,
        email: `${uid}@spsmwayland.org`,
        screenAdmin,
        programAdmin: { programs: [], events: [] },
      });
    }
    const counts = { period: 'day', key: '2026-11-22', slugs: { give: { scans: 3 } } };
    await setDoc(doc(db, 'nfcStats/day-2026-11-22'), counts);
    await setDoc(doc(db, 'nfcRevenue/day-2026-11-22'), {
      period: 'day',
      key: '2026-11-22',
      slugs: { bookstore: { cents: 2500, count: 1 } },
    });
    await setDoc(doc(db, 'nfcEvents/0123456789abcdef-scan'), { action: 'scan' });
  });
});

afterAll(async () => {
  await env.cleanup();
});

describe('nfcStats', () => {
  it('is read with the nfc grant, and by the superadmin', async () => {
    await assertSucceeds(getDoc(doc(asSignedIn(env, 'tags-servant').firestore(), 'nfcStats/day-2026-11-22')));
    await assertSucceeds(getDocs(collection(asSignedIn(env, 'tags-servant').firestore(), 'nfcStats')));
    await assertSucceeds(getDoc(doc(asSuper(env).firestore(), 'nfcStats/day-2026-11-22')));
  });

  it('is refused to everybody else, the treasurer included', async () => {
    await assertFails(getDoc(doc(asSignedIn(env, 'treasurer').firestore(), 'nfcStats/day-2026-11-22')));
    await assertFails(getDoc(doc(asSignedIn(env, 'plain-servant').firestore(), 'nfcStats/day-2026-11-22')));
    await assertFails(getDoc(doc(asAnon(env).firestore(), 'nfcStats/day-2026-11-22')));
  });

  it('cannot be written by any client', async () => {
    const write = { period: 'day', key: '2026-11-22', slugs: {} };
    await assertFails(setDoc(doc(asSignedIn(env, 'tags-servant').firestore(), 'nfcStats/day-2026-11-22'), write));
    await assertFails(setDoc(doc(asSuper(env).firestore(), 'nfcStats/day-2026-11-23'), write));
  });
});

describe('nfcRevenue', () => {
  it('needs nfc and finance together', async () => {
    await assertSucceeds(
      getDoc(doc(asSignedIn(env, 'tags-treasurer').firestore(), 'nfcRevenue/day-2026-11-22')),
    );
    await assertSucceeds(getDocs(collection(asSignedIn(env, 'tags-treasurer').firestore(), 'nfcRevenue')));
    await assertSucceeds(getDoc(doc(asSuper(env).firestore(), 'nfcRevenue/day-2026-11-22')));
  });

  it('is refused to the nfc grant alone — the reason it is its own collection', async () => {
    await assertFails(getDoc(doc(asSignedIn(env, 'tags-servant').firestore(), 'nfcRevenue/day-2026-11-22')));
    await assertFails(getDocs(collection(asSignedIn(env, 'tags-servant').firestore(), 'nfcRevenue')));
  });

  it('is refused to finance alone, and to everybody else', async () => {
    await assertFails(getDoc(doc(asSignedIn(env, 'treasurer').firestore(), 'nfcRevenue/day-2026-11-22')));
    await assertFails(getDoc(doc(asSignedIn(env, 'plain-servant').firestore(), 'nfcRevenue/day-2026-11-22')));
    await assertFails(getDoc(doc(asAnon(env).firestore(), 'nfcRevenue/day-2026-11-22')));
  });

  it('cannot be written by any client', async () => {
    await assertFails(
      setDoc(doc(asSignedIn(env, 'tags-treasurer').firestore(), 'nfcRevenue/day-2026-11-22'), { slugs: {} }),
    );
  });
});

describe('nfcEvents', () => {
  it('is closed to every client, the superadmin included', async () => {
    await assertFails(getDoc(doc(asSuper(env).firestore(), 'nfcEvents/0123456789abcdef-scan')));
    await assertFails(getDoc(doc(asSignedIn(env, 'tags-treasurer').firestore(), 'nfcEvents/0123456789abcdef-scan')));
    await assertFails(
      setDoc(doc(asAnon(env).firestore(), 'nfcEvents/fedcba9876543210-scan'), { action: 'scan' }),
    );
  });
});
