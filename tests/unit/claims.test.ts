import { describe, it, expect } from 'vitest';
import {
  ADMIN_SCREENS,
  DEFAULT_CLAIMS,
  claimsMirrorGrants,
  defaultScreenAdmin,
  isSuperadmin,
  parseClaims,
  screensFromGrants,
} from '@spsm/shared';

/**
 * The two claims, and the mirror one of them carries.
 *
 * ---------------------------------------------------------------------------
 * These functions are small and one of them is load-bearing in a way its size
 * hides: `screensFromGrants` is what `mirrorGrantsToClaims` writes into the ID
 * token, and `storage.rules` decides from that token whether somebody may
 * upload an event photograph. Storage rules cannot read Firestore, so there is
 * no second opinion in front of it — a bug here is a bucket rule that admits or
 * refuses the wrong people, and the rules tests cannot catch it because they
 * hand the claim in by hand.
 *
 * `parseClaims` is tested for tolerance rather than correctness on the happy
 * path. Every account signed in before this model existed is carrying a token
 * with `role` and `groups` in it and no `superadmin` at all, and those tokens
 * have to resolve to "signed in, nothing granted" rather than to `undefined`
 * leaking into a check.
 * ---------------------------------------------------------------------------
 */
describe('parseClaims', () => {
  it('reads the two claims it knows about', () => {
    expect(parseClaims({ superadmin: true, screens: ['events', 'forms'] })).toEqual({
      superadmin: true,
      screens: ['events', 'forms'],
    });
  });

  it('reads a token from the old model as signed in and holding nothing', () => {
    // The state every existing account is in until its token next refreshes.
    expect(parseClaims({ role: 'admin', groups: ['clergy'] })).toEqual(DEFAULT_CLAIMS);
    expect(parseClaims({ role: 'staff' })).toEqual(DEFAULT_CLAIMS);
  });

  it('treats a missing or empty token as nothing granted', () => {
    expect(parseClaims(null)).toEqual(DEFAULT_CLAIMS);
    expect(parseClaims(undefined)).toEqual(DEFAULT_CLAIMS);
    expect(parseClaims({})).toEqual(DEFAULT_CLAIMS);
  });

  it('accepts only an exact `true` for superadmin', () => {
    for (const value of ['true', 1, 'yes', {}, [], 'superadmin']) {
      expect(parseClaims({ superadmin: value }).superadmin).toBe(false);
    }
  });

  it('drops screen keys it does not recognise', () => {
    // A stale mirror written by an older deploy, or a hand-edited claim. Either
    // way, a key the code cannot check must not survive into the answer.
    expect(parseClaims({ screens: ['events', 'nonsense', 'MEMBERS', ''] }).screens).toEqual([
      'events',
    ]);
  });

  it('survives a screens claim that is not an array', () => {
    for (const value of ['events', 42, {}, null]) {
      expect(parseClaims({ screens: value }).screens).toEqual([]);
    }
  });
});

describe('isSuperadmin', () => {
  it('is the claim and nothing else', () => {
    expect(isSuperadmin({ superadmin: true })).toBe(true);
    expect(isSuperadmin({ superadmin: false })).toBe(false);
    expect(isSuperadmin({})).toBe(false);
    expect(isSuperadmin(null)).toBe(false);
    expect(isSuperadmin(undefined)).toBe(false);
  });
});

describe('screensFromGrants', () => {
  it('lists exactly the granted screens', () => {
    const map = { ...defaultScreenAdmin(), forms: true, events: true };
    expect(screensFromGrants(map)).toEqual(['events', 'forms']);
  });

  it('lists nothing for a fresh map', () => {
    expect(screensFromGrants(defaultScreenAdmin())).toEqual([]);
    expect(screensFromGrants(null)).toEqual([]);
    expect(screensFromGrants(undefined)).toEqual([]);
  });

  /**
   * Sorted, and it is not cosmetic. `setCustomUserClaims` replaces the whole
   * block, and `mirrorGrantsToClaims` compares the joined lists to decide
   * whether a member write changed anything at all. An unstable order would make
   * every profile edit look like a permission change and cost a `getUser` and a
   * claims write each time.
   */
  it('is sorted, so the mirror is stable across writes', () => {
    const a = { ...defaultScreenAdmin(), theme: true, bookstore: true, events: true };
    const b = { ...defaultScreenAdmin(), events: true, theme: true, bookstore: true };
    expect(screensFromGrants(a)).toEqual(screensFromGrants(b));
    expect(screensFromGrants(a)).toEqual(['bookstore', 'events', 'theme']);
  });

  it('carries no key that is not a screen', () => {
    const smuggled = { ...defaultScreenAdmin(), notAScreen: true } as never;
    expect(screensFromGrants(smuggled)).toEqual([]);
  });

  it('round-trips through parseClaims for every screen at once', () => {
    const everything = Object.fromEntries(ADMIN_SCREENS.map((s) => [s, true])) as Record<
      string,
      boolean
    >;
    const mirrored = screensFromGrants(everything as never);
    expect(parseClaims({ screens: mirrored }).screens).toEqual(mirrored);
  });
});

/**
 * The comparison that closes the Storage lag.
 *
 * `useScreenGrants` calls this against the document it has just read and forces
 * a token refresh when it answers false. If it ever answered true wrongly, a
 * newly granted person would be refused every upload until their token happened
 * to refresh — up to an hour, with everything else about the grant working.
 */
describe('claimsMirrorGrants', () => {
  it('agrees when the token holds exactly the granted screens', () => {
    const map = { ...defaultScreenAdmin(), forms: true, events: true };
    expect(claimsMirrorGrants({ superadmin: false, screens: ['events', 'forms'] }, map)).toBe(true);
  });

  it('ignores the order, since an older deploy need not have sorted', () => {
    const map = { ...defaultScreenAdmin(), forms: true, events: true };
    expect(claimsMirrorGrants({ superadmin: false, screens: ['forms', 'events'] }, map)).toBe(true);
  });

  it('disagrees when the token is missing a grant', () => {
    const map = { ...defaultScreenAdmin(), forms: true, events: true };
    expect(claimsMirrorGrants({ superadmin: false, screens: ['forms'] }, map)).toBe(false);
    expect(claimsMirrorGrants({ superadmin: false, screens: [] }, map)).toBe(false);
  });

  /** A revocation has to force a refresh too, or the bucket stays open. */
  it('disagrees when the token holds a grant that was taken away', () => {
    expect(
      claimsMirrorGrants({ superadmin: false, screens: ['forms'] }, defaultScreenAdmin()),
    ).toBe(false);
  });

  it('agrees when both are empty, so a plain account refreshes nothing', () => {
    expect(claimsMirrorGrants(DEFAULT_CLAIMS, defaultScreenAdmin())).toBe(true);
    expect(claimsMirrorGrants(null, null)).toBe(true);
  });
});
