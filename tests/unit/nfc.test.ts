import { describe, it, expect } from 'vitest';
import {
  NFC_SLUGS,
  isNfcVisit,
  nestFieldPaths,
  nfcPercent,
  nfcPeriodDocIds,
  nfcPeriodIds,
  nfcPlatformFromUserAgent,
  nfcRevenuePaths,
  nfcStatsPaths,
  nfcVisitFrom,
  parseNfcAttribution,
  parseNfcEvent,
  summarizeNfcStats,
  sumNfcRevenue,
  sumNfcStats,
} from '@spsm/shared';

/**
 * The NFC tag statistics' arithmetic and its gate.
 *
 * `parseNfcEvent` is the whole of what stands between an unauthenticated
 * endpoint and a write, so the refusals matter as much as the acceptances —
 * above all that a device cannot report `paid` or `formSubmit`, which only the
 * server may record.
 */

const visit = '0123456789abcdef';
const attribution = { visit, slug: 'bookstore', path: 'clip', platform: 'ios' } as const;

describe('parseNfcEvent', () => {
  it('accepts a well-formed scan', () => {
    expect(parseNfcEvent({ ...attribution, action: 'scan' })).toEqual({ ...attribution, action: 'scan' });
  });

  it('refuses the two steps only the server may record', () => {
    expect(parseNfcEvent({ ...attribution, action: 'paid' })).toBeNull();
    expect(parseNfcEvent({ ...attribution, action: 'formSubmit' })).toBeNull();
  });

  it('refuses an unknown slug, path, platform or a malformed visit', () => {
    expect(parseNfcEvent({ ...attribution, slug: 'register-vehicle', action: 'scan' })).toBeNull();
    expect(parseNfcEvent({ ...attribution, path: 'email', action: 'scan' })).toBeNull();
    expect(parseNfcEvent({ ...attribution, platform: 'windows', action: 'scan' })).toBeNull();
    expect(parseNfcEvent({ ...attribution, visit: 'ABCDEF0123456789', action: 'scan' })).toBeNull();
    expect(parseNfcEvent({ ...attribution, visit: 'abc', action: 'scan' })).toBeNull();
    expect(parseNfcEvent(null)).toBeNull();
    expect(parseNfcEvent('scan')).toBeNull();
  });

  it('drops extra fields rather than carrying them into the write', () => {
    expect(parseNfcAttribution({ ...attribution, ip: '1.2.3.4' })).toEqual(attribution);
  });
});

describe('visits and platforms', () => {
  it('makes sixteen hex characters from eight bytes', () => {
    const made = nfcVisitFrom([0, 1, 254, 255, 16, 32, 64, 128, 9, 9]);
    expect(made).toBe('0001feff10204080');
    expect(isNfcVisit(made)).toBe(true);
  });

  it('reads the platform from a user agent', () => {
    expect(nfcPlatformFromUserAgent('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe('android');
    expect(nfcPlatformFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios');
    expect(nfcPlatformFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('web');
  });
});

describe('the counters an event moves', () => {
  it('splits a scan by path and platform', () => {
    expect(nfcStatsPaths(attribution, 'scan')).toEqual([
      'slugs.bookstore.scans',
      'slugs.bookstore.path.clip',
      'slugs.bookstore.platform.ios',
    ]);
  });

  it('counts a step under the tag the visit started on', () => {
    expect(nfcStatsPaths(attribution, 'cartAdd')).toEqual(['slugs.bookstore.actions.cartAdd']);
  });

  it('nests dotted paths for a merge write', () => {
    expect(nestFieldPaths({ 'a.b.c': 1, 'a.b.d': 2, 'a.e': 3 })).toEqual({ a: { b: { c: 1, d: 2 }, e: 3 } });
  });

  it('credits money by source and by path', () => {
    expect(nfcRevenuePaths(attribution, 'forms', 2500)).toEqual({
      'slugs.bookstore.cents': 2500,
      'slugs.bookstore.count': 1,
      'slugs.bookstore.source.forms.cents': 2500,
      'slugs.bookstore.source.forms.count': 1,
      'slugs.bookstore.path.clip': 2500,
    });
  });

  it('files a day in its day and its month', () => {
    expect(nfcPeriodIds('2026-11-21')).toEqual({ day: 'day-2026-11-21', month: 'month-2026-11' });
  });
});

describe('adding up', () => {
  const day1 = nestFieldPaths({
    'slugs.give.scans': 3,
    'slugs.give.path.web': 2,
    'slugs.give.path.app': 1,
    'slugs.give.platform.android': 2,
    'slugs.give.platform.ios': 1,
    'slugs.give.actions.giveTap': 2,
  });
  const day2 = nestFieldPaths({
    'slugs.bookstore.scans': 5,
    'slugs.bookstore.path.clip': 5,
    'slugs.bookstore.platform.ios': 5,
    'slugs.give.scans': 1,
    'slugs.give.path.clip': 1,
    'slugs.give.platform.ios': 1,
  });

  it('sums documents per tag, reading missing counters as zero', () => {
    const summed = sumNfcStats([day1, day2, { slugs: { nonsense: { scans: 99 } } }, null]);
    expect(summed.give.scans).toBe(4);
    expect(summed.give.path).toEqual({ clip: 1, app: 1, web: 2 });
    expect(summed.give.actions.giveTap).toBe(2);
    expect(summed.give.actions.paid).toBe(0);
    expect(summed.bookstore.scans).toBe(5);
    expect(Object.keys(summed)).toEqual([...NFC_SLUGS]);
  });

  it('ranks the busiest tag first and leaves untapped ones out', () => {
    const summary = summarizeNfcStats(sumNfcStats([day1, day2]));
    expect(summary.scans).toBe(9);
    expect(summary.ranked.map((row) => row.slug)).toEqual(['bookstore', 'give']);
    expect(summary.path).toEqual({ clip: 6, app: 1, web: 2 });
    expect(summary.platform).toEqual({ ios: 7, android: 2, web: 0 });
  });

  it('sums revenue', () => {
    const revenue = sumNfcRevenue([
      nestFieldPaths(nfcRevenuePaths(attribution, 'bookstore', 1500)),
      nestFieldPaths(nfcRevenuePaths(attribution, 'forms', 1000)),
    ]);
    expect(revenue.bookstore.cents).toBe(2500);
    expect(revenue.bookstore.count).toBe(2);
    expect(revenue.bookstore.source.bookstore.cents).toBe(1500);
    expect(revenue.bookstore.path.clip).toBe(2500);
  });

  it('gives no percentage of nothing', () => {
    expect(nfcPercent(1, 0)).toBeNull();
    expect(nfcPercent(1, 3)).toBe(33);
  });
});

describe('nfcPeriodDocIds', () => {
  it('reads days up to ninety, oldest first, across a month end', () => {
    expect(nfcPeriodDocIds('2026-12-02', 4)).toEqual([
      'day-2026-11-29',
      'day-2026-11-30',
      'day-2026-12-01',
      'day-2026-12-02',
    ]);
    expect(nfcPeriodDocIds('2026-11-21', 90)).toHaveLength(90);
  });

  it('reads months for a year', () => {
    const ids = nfcPeriodDocIds('2026-11-21', 365);
    expect(ids).toHaveLength(12);
    expect(ids[0]).toBe('month-2025-12');
    expect(ids[11]).toBe('month-2026-11');
  });
});
