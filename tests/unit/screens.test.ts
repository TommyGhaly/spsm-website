import { describe, it, expect } from 'vitest';
import {
  ADMIN_SCREENS,
  canAdminScreen,
  defaultScreenAdmin,
  isAdminScreen,
  parseScreenAdmin,
} from '@spsm/shared';

/**
 * `screenAdmin` is the only record of which areas a non-admin may manage —
 * there is no custom claim behind it, unlike `role`. So the parsing gets tested
 * like the security control it is: the question throughout is whether anything
 * that is not an explicit, recognised `true` can come back as permission.
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

  it('lets admin through every screen without any flag set', () => {
    // grant-admin.mjs mints an admin with no member document changes; if the
    // tier did not short-circuit, the first admin could reach nothing.
    for (const screen of ADMIN_SCREENS) {
      expect(canAdminScreen({ role: 'admin' }, none, screen)).toBe(true);
    }
  });

  it('grants a non-admin exactly the screens they are given', () => {
    const map = { ...none, bulletin: true };
    expect(canAdminScreen({ role: 'servant' }, map, 'bulletin')).toBe(true);
    expect(canAdminScreen({ role: 'servant' }, map, 'events')).toBe(false);
  });

  it('refuses when there is no claim or no map', () => {
    expect(canAdminScreen(null, null, 'events')).toBe(false);
    expect(canAdminScreen(undefined, undefined, 'events')).toBe(false);
    expect(canAdminScreen({ role: 'staff' }, null, 'events')).toBe(false);
  });

  it('does not let a lesser role inherit admin by name', () => {
    for (const role of ['member', 'servant', 'staff', 'administrator', 'Admin']) {
      expect(canAdminScreen({ role }, none, 'members')).toBe(false);
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
