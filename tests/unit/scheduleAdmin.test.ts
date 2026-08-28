import { describe, it, expect } from 'vitest';
import {
  applyCalendarDetails,
  EMPTY_CALENDAR_DETAIL,
  isSafeLink,
  kindOf,
  linkLabelFor,
  occurrenceOfScheduleEntry,
  parseCalendarDetail,
  parseScheduleEntry,
  type CalendarDetail,
  type CalendarOccurrence,
} from '@spsm/shared';

/**
 * The two layers staff may add to a calendar assembled from sources the parish
 * maintains elsewhere.
 *
 * The rule these exist to enforce is that **staff may only remove what staff
 * added**, and the way it is enforced is structural: manual entries and
 * annotations are separate collections, and nothing in either can delete a
 * liturgy. `tests/rules/writes.test.ts` asserts that half against the emulator;
 * this file covers the shapes.
 */

function occurrence(over: Partial<CalendarOccurrence>): CalendarOccurrence {
  const day = over.day ?? '2026-08-24';
  return {
    id: 'x',
    title: 'Something',
    day,
    endDay: day,
    startTime: '09:00',
    endTime: null,
    allDay: false,
    location: '',
    description: '',
    source: 'parish',
    href: null,
    imageUrl: null,
    contact: null,
    link: null,
    kind: null,
    ...over,
  };
}

describe('parseScheduleEntry', () => {
  it('reads what the form writes', () => {
    const entry = parseScheduleEntry({
      title: '  Choir practice  ',
      day: '2026-09-03',
      endDay: '2026-09-03',
      startTime: '19:00',
      endTime: '20:30',
      allDay: false,
      kind: 'study',
      note: 'Bring music',
      location: 'Church hall',
    });

    expect(entry.title).toBe('Choir practice');
    expect(entry.startTime).toBe('19:00');
    expect(entry.kind).toBe('study');
  });

  /** A reversed span renders on no day at all, because `daysBetween` refuses it. */
  it('never lets the end fall before the start', () => {
    const entry = parseScheduleEntry({
      title: 'Camp',
      day: '2026-09-03',
      endDay: '2026-08-01',
    });
    expect(entry.endDay).toBe('2026-09-03');
  });

  it('treats an entry with no readable time as all-day', () => {
    expect(parseScheduleEntry({ title: 'Fast begins', day: '2026-09-03' }).allDay).toBe(true);
    // "7pm" is what a person types; the form gives `HH:MM` and anything else is
    // not a time we can place on a clock.
    expect(parseScheduleEntry({ title: 'x', day: '2026-09-03', startTime: '7pm' }).allDay).toBe(
      true,
    );
    expect(parseScheduleEntry({ title: 'x', day: '2026-09-03', startTime: '25:00' }).startTime).toBe(
      '',
    );
  });

  it('falls back to `other` for a kind it does not know', () => {
    expect(parseScheduleEntry({ title: 'x', day: '2026-09-03', kind: 'wedding' }).kind).toBe(
      'other',
    );
  });
});

describe('occurrenceOfScheduleEntry', () => {
  it('marks itself as the one source the parish owns', () => {
    const entry = occurrenceOfScheduleEntry(
      parseScheduleEntry({
        title: 'Choir practice',
        day: '2026-09-03',
        startTime: '19:00',
        kind: 'study',
      }),
      'abc123',
    );

    expect(entry?.source).toBe('manual');
    // The id carries the document it came from, which is how the delete control
    // knows what to remove — and how `removeScheduleEntry` refuses anything else.
    expect(entry?.id).toBe('manual:abc123');
  });

  /** The chosen kind wins over whatever the title would have implied. */
  it('keeps the kind that was chosen rather than guessing from the title', () => {
    const entry = occurrenceOfScheduleEntry(
      parseScheduleEntry({
        title: 'Bible Study social',
        day: '2026-09-03',
        startTime: '19:00',
        kind: 'gathering',
      }),
      'x',
    );

    // "Study" in the title would classify this as teaching if anything asked.
    expect(kindOf(entry!)).toBe('gathering');
  });

  it('refuses an entry with no title or no day', () => {
    expect(occurrenceOfScheduleEntry(parseScheduleEntry({ day: '2026-09-03' }), 'x')).toBeNull();
    expect(occurrenceOfScheduleEntry(parseScheduleEntry({ title: 'x' }), 'x')).toBeNull();
  });
});

describe('isSafeLink', () => {
  it('allows http and https', () => {
    expect(isSafeLink('https://zoom.us/j/123')).toBe(true);
    expect(isSafeLink('http://example.test')).toBe(true);
  });

  /**
   * This value becomes an `href` on a page every parishioner reads, so the
   * allowlist gets tested like the security control it is.
   */
  it('refuses anything that is not', () => {
    expect(isSafeLink('javascript:alert(document.cookie)')).toBe(false);
    expect(isSafeLink('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeLink('zoom.us/j/123')).toBe(false);
    expect(isSafeLink('')).toBe(false);
  });

  it('is applied by the parser, not just available to callers', () => {
    expect(parseCalendarDetail({ linkUrl: 'javascript:alert(1)' }).linkUrl).toBe('');
    expect(parseCalendarDetail({ linkUrl: 'https://zoom.us/j/1' }).linkUrl).toBe(
      'https://zoom.us/j/1',
    );
  });
});

describe('linkLabelFor', () => {
  it('uses the label when there is one', () => {
    expect(
      linkLabelFor({ ...EMPTY_CALENDAR_DETAIL, linkUrl: 'https://zoom.us/j/1', linkLabel: 'Join on Zoom' }),
    ).toBe('Join on Zoom');
  });

  it('falls back to the host, without the www', () => {
    expect(linkLabelFor({ ...EMPTY_CALENDAR_DETAIL, linkUrl: 'https://www.zoom.us/j/1' })).toBe(
      'zoom.us',
    );
  });
});

describe('applyCalendarDetails', () => {
  const detail = (over: Partial<CalendarDetail>): Map<string, CalendarDetail> =>
    new Map([[over.occurrenceId ?? 'x', { ...EMPTY_CALENDAR_DETAIL, ...over }]]);

  it('fills a location the source left blank', () => {
    // Breeze sends an empty location on every event it has, so this is filling
    // a gap rather than overriding anything.
    const [entry] = applyCalendarDetails(
      [occurrence({ id: 'x', location: '' })],
      detail({ occurrenceId: 'x', location: 'Church hall' }),
    );
    expect(entry?.location).toBe('Church hall');
  });

  /**
   * The line this must not cross. A title and a time belong to whichever source
   * the occurrence came from, and a website quietly disagreeing with Breeze
   * about when the Liturgy starts is worse than one that says less.
   */
  it('never overwrites a title or a time', () => {
    const [entry] = applyCalendarDetails(
      [occurrence({ id: 'x', title: 'Divine Liturgy', startTime: '08:00' })],
      detail({ occurrenceId: 'x', note: 'anything' }),
    );
    expect(entry?.title).toBe('Divine Liturgy');
    expect(entry?.startTime).toBe('08:00');
  });

  it('does not lose a location the source did supply', () => {
    const [entry] = applyCalendarDetails(
      [occurrence({ id: 'x', location: 'From the source' })],
      detail({ occurrenceId: 'x', location: 'From staff' }),
    );
    expect(entry?.location).toBe('From the source');
  });

  /** Appended, so annotating a bulletin event does not lose what the bulletin said. */
  it('adds a note to an existing description rather than replacing it', () => {
    const [entry] = applyCalendarDetails(
      [occurrence({ id: 'x', description: 'From the bulletin' })],
      detail({ occurrenceId: 'x', note: 'In the hall this week' }),
    );
    expect(entry?.description).toBe('From the bulletin · In the hall this week');
  });

  it('carries a contact and a link through', () => {
    const [entry] = applyCalendarDetails(
      [occurrence({ id: 'x' })],
      detail({
        occurrenceId: 'x',
        contactName: 'Servant Michael',
        contactPhone: '(508) 555-0142',
        linkUrl: 'https://zoom.us/j/1',
        linkLabel: 'Join on Zoom',
      }),
    );
    expect(entry?.contact).toBe('Servant Michael · (508) 555-0142');
    expect(entry?.link).toEqual({ url: 'https://zoom.us/j/1', label: 'Join on Zoom' });
    expect(entry?.hasDetail).toBe(true);
  });

  it('leaves everything else untouched', () => {
    const before = [occurrence({ id: 'a' }), occurrence({ id: 'b' })];
    const after = applyCalendarDetails(before, detail({ occurrenceId: 'a', note: 'hello' }));
    expect(after[1]).toEqual(before[1]);
  });
});
