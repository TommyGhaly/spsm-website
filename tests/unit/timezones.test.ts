import { describe, it, expect } from 'vitest';
import { wallClockToInstant, instantToWallClock, zoneAbbreviation } from '@spsm/shared';

/**
 * Staff type a wall-clock time into the events admin and never think about
 * offsets. These conversions are where that convenience is paid for, and the
 * DST cases are the reason they exist at all — a liturgy entered in October and
 * displayed in November is exactly where an hour goes missing.
 */

const NY = 'America/New_York';

describe('wallClockToInstant', () => {
  it('converts summer wall-clock time using the DST offset', () => {
    // 2026-07-04 09:00 EDT = 13:00 UTC (UTC-4)
    expect(wallClockToInstant('2026-07-04T09:00', NY)?.toISOString()).toBe(
      '2026-07-04T13:00:00.000Z',
    );
  });

  it('converts winter wall-clock time using the standard offset', () => {
    // 2026-01-04 09:00 EST = 14:00 UTC (UTC-5)
    expect(wallClockToInstant('2026-01-04T09:00', NY)?.toISOString()).toBe(
      '2026-01-04T14:00:00.000Z',
    );
  });

  it('handles the hour before and after a spring-forward transition', () => {
    // US DST 2026 begins Sunday March 8 at 02:00 local.
    expect(wallClockToInstant('2026-03-08T01:00', NY)?.toISOString()).toBe(
      '2026-03-08T06:00:00.000Z', // still EST, UTC-5
    );
    expect(wallClockToInstant('2026-03-08T03:00', NY)?.toISOString()).toBe(
      '2026-03-08T07:00:00.000Z', // now EDT, UTC-4
    );
  });

  it('handles the hour around a fall-back transition', () => {
    // US DST 2026 ends Sunday November 1 at 02:00 local.
    expect(wallClockToInstant('2026-11-01T00:30', NY)?.toISOString()).toBe(
      '2026-11-01T04:30:00.000Z', // EDT, UTC-4
    );
    expect(wallClockToInstant('2026-11-01T03:00', NY)?.toISOString()).toBe(
      '2026-11-01T08:00:00.000Z', // EST, UTC-5
    );
  });

  it('treats UTC as a no-op', () => {
    expect(wallClockToInstant('2026-07-04T09:00', 'UTC')?.toISOString()).toBe(
      '2026-07-04T09:00:00.000Z',
    );
  });

  it('handles a zone ahead of UTC', () => {
    // Cairo is UTC+3 in July 2026 (Egypt observes DST again).
    const cairo = wallClockToInstant('2026-07-04T09:00', 'Africa/Cairo');
    expect(cairo).not.toBeNull();
    // Assert the round trip rather than a hardcoded offset — Egypt's DST policy
    // has changed twice in a decade and this test should not be what breaks.
    expect(instantToWallClock(cairo!, 'Africa/Cairo')).toBe('2026-07-04T09:00');
  });

  it('accepts seconds, and midnight', () => {
    expect(wallClockToInstant('2026-07-04T09:30:00', NY)?.toISOString()).toBe(
      '2026-07-04T13:30:00.000Z',
    );
    expect(wallClockToInstant('2026-07-04T00:00', NY)?.toISOString()).toBe(
      '2026-07-04T04:00:00.000Z',
    );
  });

  it('returns null rather than an Invalid Date for junk', () => {
    // An Invalid Date propagates silently into Firestore; null is caught.
    for (const bad of ['', 'tomorrow', '2026-07-04', '07/04/2026 9:00', '2026-13-45T99:99']) {
      expect(wallClockToInstant(bad, NY)).toBeNull();
    }
  });
});

describe('instantToWallClock', () => {
  it('is the inverse of wallClockToInstant across DST', () => {
    for (const wall of [
      '2026-01-04T09:00',
      '2026-07-04T09:00',
      '2026-03-08T03:00',
      '2026-11-01T00:30',
      '2026-12-31T23:59',
    ]) {
      const instant = wallClockToInstant(wall, NY);
      expect(instant).not.toBeNull();
      expect(instantToWallClock(instant!, NY)).toBe(wall);
    }
  });

  it('renders midnight as 00:00, not 24:00', () => {
    const midnight = wallClockToInstant('2026-07-04T00:00', NY)!;
    expect(instantToWallClock(midnight, NY)).toBe('2026-07-04T00:00');
  });

  it('shows the same instant differently in two zones', () => {
    const instant = new Date('2026-07-04T13:00:00.000Z');
    expect(instantToWallClock(instant, NY)).toBe('2026-07-04T09:00');
    expect(instantToWallClock(instant, 'UTC')).toBe('2026-07-04T13:00');
  });

  it('returns an empty string for an invalid date', () => {
    expect(instantToWallClock(new Date('nonsense'), NY)).toBe('');
  });
});

describe('zoneAbbreviation', () => {
  it('distinguishes daylight from standard time, which is the point', () => {
    expect(zoneAbbreviation(new Date('2026-07-04T13:00:00Z'), NY)).toBe('EDT');
    expect(zoneAbbreviation(new Date('2026-01-04T14:00:00Z'), NY)).toBe('EST');
  });
});
