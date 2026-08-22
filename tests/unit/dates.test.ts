import { describe, it, expect } from 'vitest';
import { dayKey, fromDayKey } from '../../apps/website/src/lib/dates.js';

/**
 * A civil date out of a form and back again.
 *
 * Worth a test for the reason the gallery walks are: **it fails quietly and by
 * one.** A date stored a day early renders as a real date, sorts as a real date,
 * and prints on the card as a real date — it is simply the wrong one, and the only
 * person who can tell is somebody who remembers when the camp was.
 *
 * The trap is that `new Date('2026-07-22')` is *midnight UTC*, not midnight
 * anywhere anybody lives. In America/New_York that is 20:00 on the 21st, so the
 * obvious implementation of `fromDayKey` stores the day before the one that was
 * typed — for every zone west of Greenwich, which is the one the parish is in.
 */

const PARISH = 'America/New_York';

describe('fromDayKey', () => {
  /** The whole point: type a day, read back the same day. */
  it('round-trips through dayKey in the parish zone', () => {
    for (const day of ['2026-07-22', '2026-01-01', '2026-12-31', '2027-02-28']) {
      expect(dayKey(fromDayKey(day), PARISH)).toBe(day);
    }
  });

  /**
   * Noon UTC holds from UTC-11 to UTC+11, which is the claim the comment on
   * `fromDayKey` makes and the margin the parish sits inside with seven hours to
   * spare.
   */
  it('keeps the civil date across the offsets it claims', () => {
    const day = '2026-07-22';
    expect(dayKey(fromDayKey(day), 'Pacific/Midway')).toBe(day); // UTC-11
    expect(dayKey(fromDayKey(day), 'Pacific/Noumea')).toBe(day); // UTC+11
  });

  /**
   * And the edge it does *not* hold at, asserted rather than left implicit.
   *
   * Kiribati is UTC+14, so noon UTC there is two in the morning the next day.
   * This cannot arise — every `dayKey` call on the site passes
   * `PARISH_TIME_ZONE` — but a test that pins the limit is what stops somebody
   * "fixing" the noon to something with less margin on the side that matters.
   */
  it('is honest about UTC+14, which it does not cover', () => {
    expect(dayKey(fromDayKey('2026-07-22'), 'Pacific/Kiritimati')).toBe('2026-07-23');
  });

  /**
   * Across a daylight-saving boundary, where a naive local-midnight construction
   * is off by an hour and therefore sometimes by a day.
   */
  it('survives the spring and autumn changeovers', () => {
    for (const day of ['2026-03-08', '2026-11-01']) {
      expect(dayKey(fromDayKey(day), PARISH)).toBe(day);
    }
  });

  /** Clearing the field is a real choice — "no fixed date" — not a no-op. */
  it('reads an empty field as null', () => {
    expect(fromDayKey('')).toBeNull();
    expect(fromDayKey('   ')).toBeNull();
  });

  /**
   * A date input can be typed into on some platforms, and a half-finished or
   * pasted value must not become a `Date` of `NaN` — which Firestore accepts and
   * every reader then renders as nothing.
   */
  it('refuses anything that is not a whole civil date', () => {
    for (const bad of ['2026-07', '22/07/2026', 'tomorrow', '2026-7-2', '0000-00-00']) {
      const parsed = fromDayKey(bad);
      expect(parsed === null || !Number.isNaN(parsed.getTime())).toBe(true);
    }
    expect(fromDayKey('2026-07')).toBeNull();
    expect(fromDayKey('tomorrow')).toBeNull();
  });

  /**
   * The value that made this a function rather than a one-liner at the call site.
   * Midnight would be the 21st in the parish zone; noon is the 22nd everywhere.
   */
  it('pins the time to noon rather than midnight', () => {
    expect(fromDayKey('2026-07-22')?.toISOString()).toBe('2026-07-22T12:00:00.000Z');
    // And this is what the obvious version would have done instead.
    expect(dayKey(new Date('2026-07-22'), PARISH)).toBe('2026-07-21');
  });
});
