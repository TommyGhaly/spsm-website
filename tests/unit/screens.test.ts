import { describe, it, expect } from 'vitest';
import {
  ADMIN_SCREENS,
  FINANCE_SOURCES,
  allFinanceScopes,
  canAdminScreen,
  canSeeFinanceSource,
  defaultScreenAdmin,
  financeSourcesFor,
  isAdminScreen,
  isFinanceSource,
  noFinanceScopes,
  parseFinanceScopes,
  parseScreenAdmin,
} from '@spsm/shared';

/**
 * `screenAdmin` is the only record of which areas anybody may manage.
 *
 * There is no custom claim behind it — the sole claim on this site is
 * `superadmin` — and since the role ladder was removed there is no tier
 * underneath it either. This map, plus `programAdmin` beside it, is the whole
 * of the site's authorization. So the parsing gets tested like the security
 * control it is: the question throughout is whether anything that is not an
 * explicit, recognised `true` can come back as permission.
 */
describe('defaultScreenAdmin', () => {
  it('closes every screen', () => {
    const fresh = defaultScreenAdmin();
    expect(Object.values(fresh)).toHaveLength(ADMIN_SCREENS.length);
    expect(Object.values(fresh).every((v) => v === false)).toBe(true);
  });

  it('has an entry for every screen, so a document is never partially defined', () => {
    const fresh = defaultScreenAdmin();
    for (const screen of ADMIN_SCREENS) expect(fresh).toHaveProperty(screen, false);
  });

  it('returns a fresh object each time', () => {
    // Shared mutable state here would leak one member's grants to the next.
    const a = defaultScreenAdmin();
    a.events = true;
    expect(defaultScreenAdmin().events).toBe(false);
  });
});

/**
 * The camp is a screen, and specifically not the camp's program grant.
 *
 * ---------------------------------------------------------------------------
 * `camp` was `programAdmin.programs` containing the camp's id until
 * 2 Sep 2026. A program grant is one tick over three things — the program page,
 * its gatherings and every photograph sent in to them — so the person given the
 * camp's registrations was necessarily the person publishing its event pages,
 * and /access carried a caveat saying there was no way to give one without the
 * other.
 *
 * There is nothing left in TypeScript that can be asserted about the *old*
 * arrangement, which is the point: the flag is an ordinary member of
 * `ADMIN_SCREENS` and behaves like one. What these tests hold is that it is
 * present, that it is closed by default like everything else, and that it is
 * not entangled with `finance` — the two grants divide the camp's money between
 * them and a test that let one imply the other would be the way that quietly
 * came undone. `tests/rules/camp.test.ts` and
 * `tests/rules/program-galleries.test.ts` assert the halves this file cannot
 * see.
 * ---------------------------------------------------------------------------
 */
describe('the camp screen', () => {
  it('is a screen flag, closed until granted', () => {
    expect(ADMIN_SCREENS).toContain('camp');
    expect(isAdminScreen('camp')).toBe(true);
    expect(defaultScreenAdmin().camp).toBe(false);
    expect(parseScreenAdmin({}).camp).toBe(false);
  });

  it('does not imply the money, and the money does not imply it', () => {
    const office = parseScreenAdmin({ camp: true });
    const treasurer = parseScreenAdmin({ finance: true });

    expect(canAdminScreen(null, office, 'camp')).toBe(true);
    expect(canAdminScreen(null, office, 'finance')).toBe(false);
    expect(canSeeFinanceSource(null, office, allFinanceScopes(), 'camp')).toBe(false);

    expect(canAdminScreen(null, treasurer, 'camp')).toBe(false);
    expect(canSeeFinanceSource(null, treasurer, allFinanceScopes(), 'camp')).toBe(true);
  });

  it('is not implied by any other area of the site', () => {
    const everythingElse = parseScreenAdmin(
      Object.fromEntries(ADMIN_SCREENS.filter((s) => s !== 'camp').map((s) => [s, true])),
    );
    expect(canAdminScreen(null, everythingElse, 'camp')).toBe(false);
  });

  it('opens for a superadmin, like every other screen', () => {
    expect(canAdminScreen({ superadmin: true }, defaultScreenAdmin(), 'camp')).toBe(true);
  });
});

describe('parseScreenAdmin', () => {
  it('treats a missing document as no permissions', () => {
    for (const value of [undefined, null, {}, 'nonsense', 42, []]) {
      expect(Object.values(parseScreenAdmin(value)).every((v) => v === false)).toBe(true);
    }
  });

  it('keeps only explicit true', () => {
    const parsed = parseScreenAdmin({ events: true, bulletin: false });
    expect(parsed.events).toBe(true);
    expect(parsed.bulletin).toBe(false);
  });

  it('does not accept truthy values that are not true', () => {
    // A hand-edited document, or an older writer that stored strings.
    const parsed = parseScreenAdmin({ events: 'true', bulletin: 1, theme: {}, parking: 'yes' });
    expect(parsed.events).toBe(false);
    expect(parsed.bulletin).toBe(false);
    expect(parsed.theme).toBe(false);
    expect(parsed.parking).toBe(false);
  });

  it('drops keys that are not screens', () => {
    const parsed = parseScreenAdmin({ events: true, everything: true, __proto__: true });
    expect(parsed).not.toHaveProperty('everything');
    expect(Object.keys(parsed).sort()).toEqual([...ADMIN_SCREENS].sort());
  });

  it('defaults a screen added after the document was written to false', () => {
    // The whole reason absent keys are false: a new screen must be closed to
    // everyone until granted, not open to whoever signed in first.
    const parsed = parseScreenAdmin({ events: true });
    for (const screen of ADMIN_SCREENS) {
      if (screen !== 'events') expect(parsed[screen]).toBe(false);
    }
  });
});

describe('canAdminScreen', () => {
  const none = defaultScreenAdmin();

  it('lets a superadmin through every screen without any flag set', () => {
    // grant-admin.mjs sets a claim and touches no grant map; if it did not
    // short-circuit, the parish's administrator could reach nothing — including
    // the screen where the flags are ticked.
    for (const screen of ADMIN_SCREENS) {
      expect(canAdminScreen({ superadmin: true }, none, screen)).toBe(true);
    }
  });

  it('grants everybody else exactly the screens they are given', () => {
    const map = { ...none, bulletin: true };
    expect(canAdminScreen({ superadmin: false }, map, 'bulletin')).toBe(true);
    expect(canAdminScreen({ superadmin: false }, map, 'events')).toBe(false);
  });

  it('refuses when there is no claim or no map', () => {
    expect(canAdminScreen(null, null, 'events')).toBe(false);
    expect(canAdminScreen(undefined, undefined, 'events')).toBe(false);
    expect(canAdminScreen({ superadmin: false }, null, 'events')).toBe(false);
  });

  /**
   * Signing in is worth nothing here, and that is the model.
   *
   * There was a test called "does not let a lesser role inherit admin by name"
   * in this place, walking `member`, `servant`, `staff`, `administrator` and
   * `Admin`. The ladder it guarded is gone: an old token still carries `role`
   * and this function no longer looks at it, so the assertion worth making is
   * that a leftover claim of any shape grants nothing.
   */
  it('ignores a leftover role claim entirely', () => {
    for (const role of ['member', 'servant', 'staff', 'admin', 'Admin']) {
      expect(canAdminScreen({ role } as { superadmin?: boolean }, none, 'members')).toBe(false);
      expect(canAdminScreen({ role } as { superadmin?: boolean }, none, 'events')).toBe(false);
    }
  });

  it('treats a truthy-but-not-true superadmin as no', () => {
    for (const value of ['true', 1, {}, [], 'yes']) {
      expect(
        canAdminScreen({ superadmin: value } as unknown as { superadmin?: boolean }, none, 'events'),
      ).toBe(false);
    }
  });
});

describe('isAdminScreen', () => {
  it('accepts every listed screen and nothing else', () => {
    for (const screen of ADMIN_SCREENS) expect(isAdminScreen(screen)).toBe(true);
    for (const bad of ['', 'admin', 'Events', null, undefined, 7, {}]) {
      expect(isAdminScreen(bad)).toBe(false);
    }
  });
});

/**
 * `financeScopes` — the one map on this site that reads a missing key as `true`.
 *
 * ---------------------------------------------------------------------------
 * Which is why it is tested at greater length than the map above it.
 *
 * `parseScreenAdmin` is safe by symmetry: everything unknown is `false`, so
 * every failure mode is a refusal. This one has to distinguish "never narrowed"
 * — a member document written before /access could split the finance grant,
 * which is every treasurer in the parish on the day this shipped — from
 * "narrowed to nothing", which is a real allocation an administrator can make.
 * Get that distinction wrong in one direction and unticking every source hands
 * back the whole of the church's money; wrong in the other and shipping this
 * silently revokes a grant somebody made deliberately.
 *
 * The rule that decides it is *not* whether the map is empty — it is whether
 * the map names any known source. `firestore.rules` says the same thing with
 * `keys().hasAny(['bookstore','camp','forms'])`, and `tests/rules/access.test.ts`
 * asserts it against a live emulator.
 * ---------------------------------------------------------------------------
 */
describe('parseFinanceScopes', () => {
  it('reads a document that names no source as all three', () => {
    for (const absent of [undefined, null, {}, 'nonsense', 7, [], { nonsense: true }]) {
      expect(parseFinanceScopes(absent)).toEqual({ bookstore: true, camp: true, forms: true });
    }
  });

  it('honours a map that names even one source, exactly', () => {
    // The trap this exists to avoid: `{ camp: true }` is a *choice*, and the
    // two sources it does not mention are refused rather than inherited.
    expect(parseFinanceScopes({ camp: true })).toEqual({
      bookstore: false,
      camp: true,
      forms: false,
    });
  });

  it('reads all three explicitly false as none, not as unset', () => {
    expect(parseFinanceScopes({ bookstore: false, camp: false, forms: false })).toEqual({
      bookstore: false,
      camp: false,
      forms: false,
    });
  });

  it('takes only an explicit true', () => {
    for (const value of ['true', 1, {}, [], 'yes']) {
      expect(parseFinanceScopes({ camp: value }).camp).toBe(false);
    }
  });

  it('drops keys that are not sources', () => {
    const parsed = parseFinanceScopes({ camp: true, giving: true, orders: true });
    expect(Object.keys(parsed).sort()).toEqual([...FINANCE_SOURCES].sort());
  });

  it('returns a fresh object each time, so one caller cannot poison the next', () => {
    const first = allFinanceScopes();
    first.camp = false;
    expect(allFinanceScopes().camp).toBe(true);
    expect(noFinanceScopes()).toEqual({ bookstore: false, camp: false, forms: false });
  });
});

describe('canSeeFinanceSource', () => {
  const nothing = defaultScreenAdmin();
  const treasurer = { ...defaultScreenAdmin(), finance: true };

  it('asks for the finance grant before it asks for the source', () => {
    // The map narrows and never widens. Somebody with all three sources and no
    // finance flag has been given nothing — `hasFinance()` in firestore.rules
    // is the same order, and the rules suite asserts it against the emulator.
    for (const source of FINANCE_SOURCES) {
      expect(canSeeFinanceSource(null, nothing, allFinanceScopes(), source)).toBe(false);
    }
  });

  it('gives the flag-holder only the sources they hold', () => {
    const scopes = parseFinanceScopes({ bookstore: true, camp: false, forms: false });
    expect(canSeeFinanceSource(null, treasurer, scopes, 'bookstore')).toBe(true);
    expect(canSeeFinanceSource(null, treasurer, scopes, 'camp')).toBe(false);
    expect(canSeeFinanceSource(null, treasurer, scopes, 'forms')).toBe(false);
  });

  it('gives the flag-holder all three when nothing has been narrowed', () => {
    const scopes = parseFinanceScopes(undefined);
    for (const source of FINANCE_SOURCES) {
      expect(canSeeFinanceSource(null, treasurer, scopes, source)).toBe(true);
    }
  });

  it('lets a superadmin through the door without the flag', () => {
    // The half that still short-circuits: `finance` never has to be *given* to
    // a superadmin, and a member document they may not even have cannot be
    // what stands between them and the screen.
    const claims = { superadmin: true };
    for (const source of FINANCE_SOURCES) {
      expect(canSeeFinanceSource(claims, nothing, allFinanceScopes(), source)).toBe(true);
      expect(canSeeFinanceSource(claims, null, null, source)).toBe(true);
    }
  });

  it('honours a superadmin’s own narrowing — the half that does NOT short-circuit', () => {
    /*
     * ---------------------------------------------------------------------------
     * The regression test for a bug that made the feature look broken.
     *
     * This used to return `true` for a superadmin on the first line, like every
     * other check on this site. **Only a superadmin can open /access**, so the
     * first person anybody narrows is themselves — and the screen then showed
     * them all three anyway, which reads as the save having done nothing.
     *
     * The sources are not a permission a superadmin already holds. They are the
     * answer to "which part of this do you look after", and the claim has no
     * opinion about that. `firestore.rules` still serves them every document;
     * this is the browser choosing what to draw.
     * ---------------------------------------------------------------------------
     */
    const claims = { superadmin: true };
    const shopOnly = parseFinanceScopes({ bookstore: true, camp: false, forms: false });
    expect(canSeeFinanceSource(claims, nothing, shopOnly, 'bookstore')).toBe(true);
    expect(canSeeFinanceSource(claims, nothing, shopOnly, 'camp')).toBe(false);
    expect(canSeeFinanceSource(claims, nothing, shopOnly, 'forms')).toBe(false);
    // And unticking everything shows them nothing, which is a thing they can mean.
    expect(financeSourcesFor(claims, nothing, noFinanceScopes())).toEqual([]);
  });

  it('still gives a superadmin all three when they have never narrowed themselves', () => {
    // The default, and the reason this change takes nothing away: a member
    // document with no `financeScopes` — which is every superadmin who has not
    // touched the rows, and the bootstrapped one with no document at all.
    const claims = { superadmin: true };
    expect(financeSourcesFor(claims, defaultScreenAdmin(), parseFinanceScopes(undefined))).toEqual([
      ...FINANCE_SOURCES,
    ]);
  });

  it('treats a null map as unnarrowed rather than as closed', () => {
    // A caller that has not read the document yet must not be told "no" in a
    // way that renders as a revoked grant. `ready` is what guards that on the
    // screens; this is the value-level half of the same care.
    expect(canSeeFinanceSource(null, treasurer, null, 'camp')).toBe(true);
  });
});

describe('financeSourcesFor', () => {
  const treasurer = { ...defaultScreenAdmin(), finance: true };

  it('is empty without the grant, whatever the map says', () => {
    expect(financeSourcesFor(null, defaultScreenAdmin(), allFinanceScopes())).toEqual([]);
  });

  it('is empty for a grant narrowed to nothing — the screen has to say so', () => {
    expect(financeSourcesFor(null, treasurer, noFinanceScopes())).toEqual([]);
  });

  it('keeps the declared order rather than the map’s', () => {
    const scopes = parseFinanceScopes({ forms: true, bookstore: true });
    expect(financeSourcesFor(null, treasurer, scopes)).toEqual(['bookstore', 'forms']);
  });
});

describe('isFinanceSource', () => {
  it('accepts every listed source and nothing else', () => {
    for (const source of FINANCE_SOURCES) expect(isFinanceSource(source)).toBe(true);
    for (const bad of ['', 'finance', 'Bookstore', 'form', null, undefined, 7, {}]) {
      expect(isFinanceSource(bad)).toBe(false);
    }
  });
});
