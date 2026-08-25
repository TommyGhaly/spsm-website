import { describe, it, expect } from 'vitest';
import {
  parseIntegrationsConfig,
  parseParishConfig,
  hasParishDetails,
  formatAddress,
  parseBookstoreConfig,
  DEFAULT_INTEGRATIONS_CONFIG,
  DEFAULT_PARISH_CONFIG,
  DEFAULT_BOOKSTORE_CONFIG,
  MAX_DELIVERY_CENTS,
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

/**
 * The channel whose past streams are listed under the player. It follows the
 * same absent-versus-invalid rule as the social URLs below, and for the same
 * reason — see `channelId` in packages/shared/src/schema/config.ts.
 */
describe('parseIntegrationsConfig — the livestream archive channel', () => {
  it('falls back to the parish channel when the key is absent', () => {
    // This is what keeps the archive working against the live config document,
    // which was written before this field existed.
    expect(parseIntegrationsConfig({ livestream: {} }).livestream.archiveChannelId).toBe(
      DEFAULT_INTEGRATIONS_CONFIG.livestream.archiveChannelId,
    );
    expect(parseIntegrationsConfig({}).livestream.archiveChannelId).toBe(
      DEFAULT_INTEGRATIONS_CONFIG.livestream.archiveChannelId,
    );
  });

  it('honours an explicit empty string as "no archive"', () => {
    expect(
      parseIntegrationsConfig({ livestream: { archiveChannelId: '' } }).livestream
        .archiveChannelId,
    ).toBe('');
  });

  it('hides the archive rather than showing the old channel when the value is unusable', () => {
    // Someone pasting a handle was *trying* to change which channel is listed.
    // Quietly listing the previous one instead conceals the mistake.
    for (const wrong of [
      '@WaylandCopticChurch',
      'https://www.youtube.com/@WaylandCopticChurch',
      'https://www.youtube.com/channel/UC6xlDBsD02-k7M5o-51CUQw',
      'UCtooshort',
      42,
    ]) {
      expect(
        parseIntegrationsConfig({ livestream: { archiveChannelId: wrong } }).livestream
          .archiveChannelId,
      ).toBe('');
    }
  });

  it('keeps a well-formed channel id', () => {
    expect(
      parseIntegrationsConfig({ livestream: { archiveChannelId: 'UCxQNRqQk14A3NVYUO0O14Ng' } })
        .livestream.archiveChannelId,
    ).toBe('UCxQNRqQk14A3NVYUO0O14Ng');
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

/**
 * The social URLs go straight into a footer `href`, and staff paste them in by
 * hand. The two realistic mistakes are a bare handle and a scheme-less domain;
 * both would emit a *relative* link that 404s on this site rather than opening
 * the account. The dangerous one is rarer but cheaper to exclude than to
 * explain.
 */
describe('parseParishConfig — social links', () => {
  it('defaults to the parish’s own accounts, all https', () => {
    // These three are the one part of the parish default that is not blank —
    // supplied by the parish and publicly verifiable. See DEFAULT_PARISH_CONFIG.
    const social = parseParishConfig(null).social;
    expect(social.instagram).toBe('https://www.instagram.com/spsmchurch');
    expect(social.facebook).toBe('https://www.facebook.com/waylandcopticchurch');
    expect(social.youtube).toBe('https://www.youtube.com/@WaylandCopticChurch');
    // The YouTube URL was given as http. Nothing here should ship http.
    for (const url of Object.values(social)) {
      expect(url.startsWith('https://')).toBe(true);
    }
  });

  it('lets config/parish override an account without a deploy', () => {
    const social = parseParishConfig({
      social: { instagram: 'https://www.instagram.com/moved-account/' },
    }).social;
    expect(social.instagram).toBe('https://www.instagram.com/moved-account/');
    // The two not overridden keep the defaults rather than being blanked.
    expect(social.facebook).toBe('https://www.facebook.com/waylandcopticchurch');
  });

  it('rejects a bare handle and a scheme-less domain', () => {
    // Both would render as a relative href and 404 on this site. Rejected means
    // "no icon", not "fall back to the default" — a staff member who typed a
    // handle meant to change the link, and silently showing the old one hides
    // the mistake.
    const social = parseParishConfig({
      social: { instagram: '@spsmchurch', facebook: 'www.facebook.com/waylandcopticchurch' },
    }).social;
    expect(social.instagram).toBe('');
    expect(social.facebook).toBe('');
  });

  it('rejects non-http schemes, so the href cannot become script', () => {
    const social = parseParishConfig({
      social: {
        instagram: 'javascript:alert(1)',
        facebook: 'data:text/html,<script>alert(1)</script>',
        youtube: 'ftp://example.org/channel',
      },
    }).social;
    expect(social).toEqual({ instagram: '', facebook: '', youtube: '' });
  });

  it('survives social being the wrong shape entirely', () => {
    // Not an object → no per-key values to read, so every platform falls back.
    expect(parseParishConfig({ social: 'instagram.com/spsm' }).social).toEqual(
      DEFAULT_PARISH_CONFIG.social,
    );
    expect(parseParishConfig({ social: [] }).social).toEqual(DEFAULT_PARISH_CONFIG.social);
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

describe('parseBookstoreConfig', () => {
  it('falls back to the committed wording when the document is missing', () => {
    expect(parseBookstoreConfig(null)).toEqual(DEFAULT_BOOKSTORE_CONFIG);
    expect(parseBookstoreConfig(undefined)).toEqual(DEFAULT_BOOKSTORE_CONFIG);
    expect(parseBookstoreConfig('nonsense')).toEqual(DEFAULT_BOOKSTORE_CONFIG);
  });

  it('takes the parish’s values when they are usable', () => {
    expect(
      parseBookstoreConfig({
        deliveryCents: 550,
        orderEmail: 'office@spsmwayland.org',
        fulfilmentNote: 'Pick up after Liturgy.',
        returnsNotice: 'All sales final.',
      }),
    ).toEqual({
      deliveryCents: 550,
      orderEmail: 'office@spsmwayland.org',
      fulfilmentNote: 'Pick up after Liturgy.',
      returnsNotice: 'All sales final.',
      // Absent from the document means no divisions, which is the ordinary
      // state — `parseSections` has its own tests in shopSections.test.ts.
      sections: [],
    });
  });

  it('falls each field back on its own, so a half-written document still counts', () => {
    const partial = parseBookstoreConfig({ deliveryCents: 0 });
    expect(partial.deliveryCents).toBe(0);
    expect(partial.returnsNotice).toBe(DEFAULT_BOOKSTORE_CONFIG.returnsNotice);
  });

  /*
   * `deliveryCents` is turned into a real charge by the checkout Function, so
   * these are the cases that would take money nobody authorised. Rejected back
   * to the default rather than clamped — clamping silently charges a figure the
   * parish never chose.
   */
  it('refuses a delivery charge that is not a usable amount', () => {
    for (const bad of [-100, 1_000_00, 7.5, NaN, Infinity, '700', null]) {
      expect(parseBookstoreConfig({ deliveryCents: bad }).deliveryCents).toBe(
        DEFAULT_BOOKSTORE_CONFIG.deliveryCents,
      );
    }
  });

  it('allows free delivery, which is not the same as unset', () => {
    expect(parseBookstoreConfig({ deliveryCents: 0 }).deliveryCents).toBe(0);
    expect(parseBookstoreConfig({ deliveryCents: MAX_DELIVERY_CENTS }).deliveryCents).toBe(
      MAX_DELIVERY_CENTS,
    );
  });

  it('preserves a deliberately cleared order email', () => {
    // Empty means "say contact the parish office", which is a choice, not a gap.
    expect(parseBookstoreConfig({ orderEmail: '' }).orderEmail).toBe('');
  });
});
