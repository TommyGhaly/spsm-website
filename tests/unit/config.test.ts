import { describe, it, expect } from 'vitest';
import {
  parseIntegrationsConfig,
  parseParishConfig,
  hasParishDetails,
  formatAddress,
  DEFAULT_INTEGRATIONS_CONFIG,
  DEFAULT_PARISH_CONFIG,
} from '@spsm/shared';

/**
 * Staff edit `config/integrations` and `config/parish` by hand in the Firebase
 * console, so a missing or mistyped field is an ordinary occurrence. The
 * contract is that each field falls back independently — one bad edit must not
 * discard the others.
 */

describe('parseIntegrationsConfig — the two opposite enabled defaults', () => {
  it('treats a missing announcements.enabled as ON', () => {
    // The bulletin is normally present, so absent means "on".
    expect(parseIntegrationsConfig({}).announcements.enabled).toBe(true);
    expect(parseIntegrationsConfig({ announcements: {} }).announcements.enabled).toBe(true);
  });

  it('disables announcements only on an explicit false', () => {
    expect(
      parseIntegrationsConfig({ announcements: { enabled: false } }).announcements.enabled,
    ).toBe(false);
    // A truthy-but-wrong value must not read as "off".
    expect(
      parseIntegrationsConfig({ announcements: { enabled: 'no' } }).announcements.enabled,
    ).toBe(true);
  });

  it('treats a missing livestream.enabled as OFF', () => {
    // Opposite default, deliberately: a player for a stream that isn't
    // configured reads as broken rather than as absent.
    expect(parseIntegrationsConfig({}).livestream.enabled).toBe(false);
    expect(parseIntegrationsConfig({ livestream: { enabled: 'yes' } }).livestream.enabled).toBe(
      false,
    );
    expect(parseIntegrationsConfig({ livestream: { enabled: true } }).livestream.enabled).toBe(true);
  });
});

describe('parseIntegrationsConfig — field-by-field fallback', () => {
  it('preserves an empty databaseId, because empty means the (default) database', () => {
    // This is the `??` vs `||` distinction, and getting it wrong is what
    // produced a bare `5 NOT_FOUND` that read like a missing collection.
    expect(
      parseIntegrationsConfig({ announcements: { databaseId: '' } }).announcements.databaseId,
    ).toBe('');
    expect(
      parseIntegrationsConfig({ announcements: { databaseId: 'other-db' } }).announcements
        .databaseId,
    ).toBe('other-db');
  });

  it('keeps the good fields when one sibling is the wrong type', () => {
    const config = parseIntegrationsConfig({
      announcements: { projectId: 12345, collectionPath: 'weekly' },
    });
    expect(config.announcements.projectId).toBe(
      DEFAULT_INTEGRATIONS_CONFIG.announcements.projectId,
    );
    expect(config.announcements.collectionPath).toBe('weekly');
  });

  it('falls back to a known platform when given an unknown one', () => {
    expect(parseIntegrationsConfig({ livestream: { platform: 'vimeo' } }).livestream.platform).toBe(
      DEFAULT_INTEGRATIONS_CONFIG.livestream.platform,
    );
    expect(
      parseIntegrationsConfig({ livestream: { platform: 'facebook' } }).livestream.platform,
    ).toBe('facebook');
  });

  it('returns the committed defaults for junk input rather than throwing', () => {
    for (const junk of [null, undefined, 'a string', 42, []]) {
      expect(() => parseIntegrationsConfig(junk)).not.toThrow();
    }
    // Against the constant, not a literal. This asserted `''` until the parish
    // gave us a real Castr URL to commit as the default, at which point a test
    // named "returns the committed defaults" was failing for saying otherwise.
    expect(parseIntegrationsConfig(null).livestream.target).toBe(
      DEFAULT_INTEGRATIONS_CONFIG.livestream.target,
    );

    // `enabled` is the one field with no fallback, and that now *diverges* from
    // the committed default rather than agreeing with it: the default is on,
    // because there is a stream, but a document that predates the stream and
    // says nothing about it must still resolve to off. Anything else turns a
    // player on under a parish that never asked for one.
    expect(DEFAULT_INTEGRATIONS_CONFIG.livestream.enabled).toBe(true);
    expect(parseIntegrationsConfig(null).livestream.enabled).toBe(false);
  });
});

describe('parseParishConfig', () => {
  it('falls back to blank, never to a plausible guess', () => {
    // A plausible wrong address is one nobody thinks to check.
    const config = parseParishConfig(null);
    expect(config).toEqual(DEFAULT_PARISH_CONFIG);
    expect(config.address.line1).toBe('');
    expect(config.serviceTimes).toEqual([]);
  });

  it('drops a service row with no name but keeps the rest', () => {
    const config = parseParishConfig({
      serviceTimes: [
        { name: 'Divine Liturgy', day: 'Sunday', time: '8:00 AM' },
        { day: 'Wednesday', time: '7:00 PM' },
        { name: 'Vespers' },
      ],
    });
    expect(config.serviceTimes).toEqual([
      { name: 'Divine Liturgy', day: 'Sunday', time: '8:00 AM' },
      { name: 'Vespers', day: '', time: '' },
    ]);
  });

  it('ignores serviceTimes that is not an array', () => {
    expect(parseParishConfig({ serviceTimes: 'Sundays at 8' }).serviceTimes).toEqual([]);
  });

  it('trims whitespace-padded values', () => {
    expect(parseParishConfig({ phone: '  (508) 555-0100  ' }).phone).toBe('(508) 555-0100');
  });
});

describe('hasParishDetails', () => {
  it('is false for the blank default, so /contact renders an honest empty state', () => {
    expect(hasParishDetails(DEFAULT_PARISH_CONFIG)).toBe(false);
  });

  it('is true once any one of phone, email, or street address is filled in', () => {
    expect(hasParishDetails({ ...DEFAULT_PARISH_CONFIG, phone: '508-555-0100' })).toBe(true);
    expect(hasParishDetails({ ...DEFAULT_PARISH_CONFIG, email: 'office@example.org' })).toBe(true);
    expect(
      hasParishDetails({
        ...DEFAULT_PARISH_CONFIG,
        address: { ...DEFAULT_PARISH_CONFIG.address, line1: '1 Main St' },
      }),
    ).toBe(true);
  });

  it('is false when only a city is filled in — that is not reachable detail', () => {
    expect(
      hasParishDetails({
        ...DEFAULT_PARISH_CONFIG,
        address: { ...DEFAULT_PARISH_CONFIG.address, city: 'Wayland' },
      }),
    ).toBe(false);
  });
});

describe('formatAddress', () => {
  it('skips the blank parts instead of leaving stray separators', () => {
    expect(
      formatAddress({ line1: '1 Main St', line2: '', city: 'Wayland', state: 'MA', postalCode: '01778' }),
    ).toBe('1 Main St · Wayland, MA · 01778');
  });

  it('returns an empty string for a wholly blank address', () => {
    expect(formatAddress(DEFAULT_PARISH_CONFIG.address)).toBe('');
  });
});
