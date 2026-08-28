import { describe, it, expect } from 'vitest';
import {
  breezeOccurrence,
  dedupeOccurrences,
  groupByDay,
  occurrenceOfEvent,
  parseBreezeEventSources,
  rangeLength,
  sortOccurrences,
  bulletinTime,
  mergeCalendarSources,
  occurrencesOfBulletin,
  occurrenceKind,
  spanLabel,
  step,
  weekRange,
  weekdayOf,
  formatClock,
  monthRange,
  type CalendarOccurrence,
} from '@spsm/shared';

/**
 * The Breeze reader, tested against what Breeze actually sends.
 *
 * Every fixture below is copied from a real response from the parish's own
 * calendar, because the two things that make this parser non-trivial are both
 * undocumented quirks nobody would have predicted from a type: the all-day end
 * date is *exclusive*, and the same `end` field arrives in two different date
 * formats depending on whether the event is all-day. Both were found by reading
 * bytes, and a test written from the spec rather than the wire would have
 * missed both.
 */

/* ---- parseBreezeEventSources -------------------------------------------- */

/** Trimmed from the real embed page. Two categories, as the servants URL has. */
const EMBED_HTML = `
  var event_sources = [];
    var event_source = {};
      event_source.url = '/ajax/events/details?category_id=104099&oid=230652&rand=730688238';
      event_source.external = false;
      event_source.color = '#ff5900';
      event_source.textColor = '#ffffff';
      event_sources.push(event_source);
    var event_source = {};
      event_source.url = '/ajax/events/details?category_id=0&oid=230652&rand=340180910';
      event_source.external = false;
      event_source.color = '#b2cd92';
      event_source.textColor = '#ffffff';
      event_sources.push(event_source);
`;

describe('parseBreezeEventSources', () => {
  it('finds every category the embed token grants', () => {
    const sources = parseBreezeEventSources(EMBED_HTML);

    expect(sources).toHaveLength(2);
    expect(sources[0]?.categoryId).toBe('104099');
    expect(sources[0]?.color).toBe('#ff5900');
    expect(sources[1]?.categoryId).toBe('0');
    expect(sources[1]?.color).toBe('#b2cd92');
  });

  /**
   * The bounded gap in the pattern, tested directly.
   *
   * With a greedy `[\s\S]*?` and one source missing its colour assignment, the
   * match runs on into the *next* block and reports two sources sharing one
   * colour — quietly, with the right count, which is the worst kind of wrong.
   */
  it('does not let one source borrow the next one’s colour', () => {
    const truncated = EMBED_HTML.replace("event_source.color = '#ff5900';", '');
    const sources = parseBreezeEventSources(truncated);

    // The first source has no colour of its own within reach, so it is either
    // dropped or colourless — what it must never be is '#b2cd92'.
    expect(sources.every((source) => source.color !== '#ff5900')).toBe(true);
    expect(sources.filter((source) => source.color === '#b2cd92')).toHaveLength(1);
  });

  /**
   * An empty result must be distinguishable from an empty calendar. The Function
   * throws on this rather than returning no events, because a wrong token and a
   * quiet week look identical downstream and only one should blank the page.
   */
  it('returns nothing for a page with no sources', () => {
    expect(parseBreezeEventSources('<html><body>Sorry, this is not available.</body></html>')).toEqual(
      [],
    );
  });
});

/* ---- breezeOccurrence ---------------------------------------------------- */

describe('breezeOccurrence', () => {
  it('reads an ordinary timed service', () => {
    const occurrence = breezeOccurrence(
      {
        id: '404577144',
        title: 'Divine Liturgy',
        start: '2026-08-30 08:00:00',
        end: '2026-08-30 11:00:00',
        allDay: false,
        location: '',
        description: 'No Description',
      },
      'parish',
    );

    expect(occurrence).toEqual({
      id: '404577144',
      title: 'Divine Liturgy',
      day: '2026-08-30',
      endDay: '2026-08-30',
      startTime: '08:00',
      endTime: '11:00',
      allDay: false,
      location: '',
      description: '',
      source: 'parish',
      href: null,
      imageUrl: null,
      contact: null,
      link: null,
      kind: null,
    });
  });

  /**
   * The off-by-one that would have made every multi-day entry a day too long.
   *
   * Real fixture: Summer Camp Week 2 starts on the 3rd with an end of
   * `08/08/2026`, and Breeze's own `date_description` calls it "Mon Aug 3" — it
   * is a five-day camp, the 3rd to the 7th. The end is exclusive.
   */
  it('treats an all-day end as exclusive', () => {
    const camp = breezeOccurrence(
      {
        id: '1',
        title: 'Summer Camp Week 2',
        start: '2026-08-03 00:00:00',
        end: '08/08/2026 00:00:00',
        allDay: true,
      },
      'servants',
    );

    expect(camp?.day).toBe('2026-08-03');
    expect(camp?.endDay).toBe('2026-08-07');
  });

  it('keeps a one-day all-day entry on its one day', () => {
    const competition = breezeOccurrence(
      {
        id: '2',
        title: 'Tentative KRISPY Competition',
        start: '2026-08-22 00:00:00',
        end: '08/23/2026 00:00:00',
        allDay: true,
      },
      'servants',
    );

    expect(competition?.day).toBe('2026-08-22');
    expect(competition?.endDay).toBe('2026-08-22');
    expect(competition?.startTime).toBeNull();
    expect(competition?.allDay).toBe(true);
  });

  /**
   * A timed event's end is *not* exclusive and must not be shifted. Getting
   * this backwards moves an overnight vigil off the day it ends on.
   */
  it('does not shift a timed end', () => {
    const vigil = breezeOccurrence(
      {
        id: '3',
        title: 'Midnight Praises',
        start: '2026-08-29 22:00:00',
        end: '2026-08-30 01:00:00',
        allDay: false,
      },
      'parish',
    );

    expect(vigil?.endDay).toBe('2026-08-30');
    expect(vigil?.endTime).toBe('01:00');
  });

  /** Both date formats arrive in one payload, from the same field. */
  it('reads the US-format dates Breeze uses only for all-day ends', () => {
    const trip = breezeOccurrence(
      { id: '4', title: 'Trip', start: '2026-08-28 00:00:00', end: '08/31/2026 00:00:00', allDay: true },
      'servants',
    );
    expect(trip?.endDay).toBe('2026-08-30');
  });

  /**
   * Descriptions come back as HTML pasted out of Word. React would escape it
   * and show the reader the tags, which is not a security problem and is very
   * much a legibility one.
   */
  it('reduces a pasted-in HTML description to text', () => {
    const occurrence = breezeOccurrence(
      {
        id: '5',
        title: 'Bible Study',
        start: '2026-08-24 21:00:00',
        allDay: false,
        description:
          '<span style="color:#242424;font-family:\'Aptos\'">Join us&nbsp;on Zoom &amp; in person.</span>',
      },
      'parish',
    );

    expect(occurrence?.description).toBe('Join us on Zoom & in person.');
  });

  /**
   * Breeze ships ~47 keys of internal state per event, including the email
   * address of whichever member of staff last saved it, and this is on its way
   * to a public JSON endpoint. "We do not read that field" is not the same
   * protection as "that field is not in the response".
   */
  it('drops the metadata Breeze attaches, including staff email addresses', () => {
    const occurrence = breezeOccurrence(
      {
        id: '6',
        title: 'Vespers',
        start: '2026-08-29 19:00:00',
        allDay: false,
        metadata: {
          account_settings_modal_email: 'marlene.takla@waylandcopticchurch.org',
          account_settings_modal_first_name: 'Marlene',
        },
      },
      'parish',
    );

    expect(occurrence).not.toBeNull();
    expect(JSON.stringify(occurrence)).not.toContain('waylandcopticchurch.org');
    expect(Object.keys(occurrence as object)).not.toContain('metadata');
  });

  it('refuses an entry with no title or no readable start', () => {
    expect(breezeOccurrence({ id: '7', title: '', start: '2026-08-01 09:00:00' }, 'parish')).toBeNull();
    expect(breezeOccurrence({ id: '8', title: 'Something', start: 'not a date' }, 'parish')).toBeNull();
    expect(breezeOccurrence({ id: '9', title: 'Something' }, 'parish')).toBeNull();
  });
});

/* ---- assembling a feed --------------------------------------------------- */

/**
 * A one-day occurrence, overridable field by field.
 *
 * `endDay` follows `day` unless it is given explicitly. Defaulting it to a
 * fixed date instead means overriding only `day` silently produces a span that
 * ends before it begins — which no real constructor can emit, both of them
 * clamp it, so it would only ever be a fixture lying to the test.
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

describe('sortOccurrences', () => {
  it('puts all-day entries above the timed ones on the same day', () => {
    const sorted = sortOccurrences([
      occurrence({ id: 'liturgy', startTime: '08:00' }),
      occurrence({ id: 'camp', allDay: true, startTime: null }),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(['camp', 'liturgy']);
  });

  it('orders a day by its clock times', () => {
    const sorted = sortOccurrences([
      occurrence({ id: 'tasbeha', startTime: '19:30' }),
      occurrence({ id: 'liturgy', startTime: '08:00' }),
      occurrence({ id: 'vespers', startTime: '19:00' }),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(['liturgy', 'vespers', 'tasbeha']);
  });
});

describe('dedupeOccurrences', () => {
  /**
   * The duplicate only a signed-in servant ever saw, and the reason the key is
   * `id` rather than `source:id`.
   *
   * The servants embed's token grants the parish category as well as its own,
   * so the Function reads the same liturgy twice — once tagged `parish` from
   * the parish embed and once tagged `servants` from the other. Measured
   * against the real week of 2026-08-23: all 25 parish occurrences came back
   * from both embeds under identical instance ids, and only 6 entries were
   * genuinely servants-only.
   *
   * Keyed on `source:id` those were two different keys, nothing collapsed, and
   * a servant saw the entire parish calendar twice over.
   */
  it('collapses one Breeze instance arriving under two source tags', () => {
    const deduped = dedupeOccurrences([
      occurrence({ id: '404577147', title: 'Divine Liturgy', source: 'parish' }),
      occurrence({ id: '404577147', title: 'Divine Liturgy', source: 'servants' }),
    ]);

    expect(deduped).toHaveLength(1);
    // Parish, not servants — the caller passes the parish embed first, and a
    // service on both calendars must not end up behind the servants gate.
    expect(deduped[0]?.source).toBe('parish');
  });

  it('keeps the entries that really are servants-only', () => {
    const deduped = dedupeOccurrences([
      occurrence({ id: '404577147', source: 'parish' }),
      occurrence({ id: '404577147', source: 'servants' }),
      occurrence({ id: '999', title: 'Volleyball Tournament', source: 'servants' }),
    ]);

    expect(deduped).toHaveLength(2);
    expect(deduped.map((entry) => entry.source)).toEqual(['parish', 'servants']);
  });

  /**
   * Keyed on the *instance* id, not the series id — otherwise a weekly liturgy's
   * fifty-two occurrences would collapse into one and the calendar would show
   * the Liturgy once a year.
   */
  it('keeps distinct instances of a recurring service', () => {
    const deduped = dedupeOccurrences([
      occurrence({ id: '404577144', day: '2026-08-23' }),
      occurrence({ id: '404577145', day: '2026-08-30' }),
    ]);

    expect(deduped).toHaveLength(2);
  });
});

/* ---- the bulletin, and reconciling it with Breeze ------------------------ */

describe('bulletinTime', () => {
  it('reads the shapes the sheet actually uses', () => {
    expect(bulletinTime('5:30pm')).toBe('17:30');
    expect(bulletinTime('7:00am')).toBe('07:00');
    expect(bulletinTime('11:00am')).toBe('11:00');
    expect(bulletinTime('7pm')).toBe('19:00');
  });

  /** The two the obvious arithmetic gets backwards. */
  it('gets noon and midnight right', () => {
    expect(bulletinTime('12:00pm')).toBe('12:00');
    expect(bulletinTime('12:30am')).toBe('00:30');
  });

  /**
   * Null rather than a guess. The bulletin stores what a person typed and
   * guarantees no format, so an unreadable time renders as an all-day entry
   * instead of at a wrong hour.
   */
  it('refuses anything it cannot read', () => {
    expect(bulletinTime(null)).toBeNull();
    expect(bulletinTime('after Liturgy')).toBeNull();
    expect(bulletinTime('25:00pm')).toBeNull();
    expect(bulletinTime('17:30')).toBeNull();
  });
});

describe('occurrencesOfBulletin', () => {
  const bulletin = {
    days: [
      {
        date: '2026-08-25',
        events: [
          {
            sourceId: 'a',
            name: 'Tuesday Liturgy',
            time: '7:00am',
            timeTo: null,
            notes: null,
            image: 'https://example.test/liturgy.jpg',
            contacts: [],
          },
        ],
      },
    ],
    multiDayEvents: [
      {
        sourceId: 'b',
        name: 'High School Online Bible Study',
        time: '9:00pm',
        timeTo: '9:30pm',
        notes: null,
        image: null,
        contacts: [{ name: 'Servant Michael', phone: '(508) 555-0142' }],
        startDate: '2026-08-24',
        endDate: '2026-08-27',
      },
    ],
  };

  it('reads a day event, keeping its photograph', () => {
    const [liturgy] = occurrencesOfBulletin(bulletin);
    expect(liturgy?.day).toBe('2026-08-25');
    expect(liturgy?.startTime).toBe('07:00');
    expect(liturgy?.source).toBe('bulletin');
    expect(liturgy?.imageUrl).toBe('https://example.test/liturgy.jpg');
  });

  /**
   * One span, not four days' worth of entries — which is also how the bulletin
   * itself states it, and what lets Breeze's four separate nightly instances
   * collapse against this single one.
   */
  it('keeps a multi-day event as one span, with its contact', () => {
    const study = occurrencesOfBulletin(bulletin).find((entry) => entry.id === 'bulletin:b');
    expect(study?.day).toBe('2026-08-24');
    expect(study?.endDay).toBe('2026-08-27');
    expect(study?.startTime).toBe('21:00');
    expect(study?.contact).toBe('Servant Michael · (508) 555-0142');
  });

  /** No time on the sheet means all day — the absence is information. */
  it('treats an untimed entry as all-day', () => {
    const [entry] = occurrencesOfBulletin({
      days: [
        {
          date: '2026-08-25',
          events: [
            { sourceId: 'c', name: 'Fasting begins', time: null, timeTo: null, notes: null, image: null, contacts: [] },
          ],
        },
      ],
      multiDayEvents: [],
    });
    expect(entry?.allDay).toBe(true);
    expect(entry?.startTime).toBeNull();
  });
});

describe('mergeCalendarSources', () => {
  /*
   * Every pair below is copied from the real week of 2026-08-24, where the
   * bulletin and Breeze describe the same services in different words and at
   * different times. See the note above `mergeCalendarSources`.
   */
  const bulletinEntry = (over: Partial<CalendarOccurrence>) =>
    occurrence({ source: 'bulletin', id: `bulletin:${over.title ?? 'x'}`, ...over });
  const breezeEntry = (over: Partial<CalendarOccurrence>) =>
    occurrence({ source: 'parish', id: `breeze:${over.title ?? 'y'}`, ...over });

  const merges = (a: CalendarOccurrence, b: CalendarOccurrence) =>
    mergeCalendarSources([[a], [b]]).length === 1;

  it('merges the same service under two names at the same time', () => {
    expect(
      merges(
        bulletinEntry({ title: 'Saturday Liturgy', day: '2026-08-29', startTime: '08:00' }),
        breezeEntry({ title: 'Divine Liturgy', day: '2026-08-29', startTime: '08:00' }),
      ),
    ).toBe(true);
  });

  it('merges across the two transliterations of Tasbeha', () => {
    expect(
      merges(
        bulletinEntry({ title: 'Midnight Praises (Tesbeha)', day: '2026-08-29', startTime: '19:30' }),
        breezeEntry({ title: 'Tasbeha', day: '2026-08-29', startTime: '19:30' }),
      ),
    ).toBe(true);
  });

  it('merges when the two systems disagree about the time by up to an hour', () => {
    expect(
      merges(
        bulletinEntry({ title: 'Arabic Tasbeha', day: '2026-08-24', startTime: '17:30' }),
        breezeEntry({ title: 'Midnight Tasbeha Arabic', day: '2026-08-24', startTime: '17:00' }),
      ),
    ).toBe(true);
    expect(
      merges(
        bulletinEntry({ title: 'St. Maurice & St. Verina Arabic Meeting', day: '2026-08-24', startTime: '19:00' }),
        breezeEntry({ title: 'St. Maurice & St. Verina Arabic Meeting', day: '2026-08-24', startTime: '18:00' }),
      ),
    ).toBe(true);
  });

  /**
   * The one that must NOT merge, and the reason the threshold is half the
   * shorter title rather than any overlap at all. Two genuinely different
   * things at seven o'clock on the same Friday.
   */
  it('leaves two different events that share an hour alone', () => {
    expect(
      merges(
        bulletinEntry({ title: 'Bible Study for College and Young Professionals', day: '2026-08-28', startTime: '19:00' }),
        breezeEntry({ title: 'SPSM Mother of Mercy Homeless Meals', day: '2026-08-28', startTime: '19:00' }),
      ),
    ).toBe(false);
  });

  /** Two words shared out of five is 40%, and they are not the same study. */
  it('does not merge two different Bible studies on a shared hour', () => {
    expect(
      merges(
        bulletinEntry({ title: 'Bible Study for College and Young Professionals', day: '2026-08-28', startTime: '19:00' }),
        breezeEntry({ title: 'High School Online Bible Study', day: '2026-08-28', startTime: '19:00' }),
      ),
    ).toBe(false);
  });

  /**
   * Never within one source. Breeze runs two different Mahragan classes at 7pm
   * on the same evening and both must survive.
   */
  it('never merges two entries from the same source', () => {
    const merged = mergeCalendarSources([
      [
        breezeEntry({ id: 'a', title: '3rd and 4th Mahragan El Keraza', day: '2026-08-25', startTime: '19:00' }),
        breezeEntry({ id: 'b', title: '5th - 8th Grade Mahragan ElKeraza', day: '2026-08-25', startTime: '19:00' }),
      ],
    ]);
    expect(merged).toHaveLength(2);
  });

  /**
   * The bulletin holds the study as one Monday-to-Thursday span and Breeze as
   * four nightly instances. Matching on equal start days caught only the
   * Monday and left the other three showing twice.
   */
  it('collapses four nightly instances against one multi-day span', () => {
    const merged = mergeCalendarSources([
      [
        bulletinEntry({
          title: 'High School Online Bible Study',
          day: '2026-08-24',
          endDay: '2026-08-27',
          startTime: '21:00',
        }),
      ],
      ['24', '25', '26', '27'].map((dayOfMonth) =>
        breezeEntry({
          id: `breeze:${dayOfMonth}`,
          title: 'High School Online Bible Study',
          day: `2026-08-${dayOfMonth}`,
          startTime: '21:00',
        }),
      ),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe('bulletin');
    expect(merged[0]?.endDay).toBe('2026-08-27');
  });

  it('does not merge an all-day entry with a timed one', () => {
    expect(
      merges(
        bulletinEntry({ title: 'Summer Camp', day: '2026-08-03', allDay: true, startTime: null }),
        breezeEntry({ title: 'Summer Camp', day: '2026-08-03', startTime: '19:00' }),
      ),
    ).toBe(false);
  });

  it('lets the surviving entry keep what the other one had', () => {
    const merged = mergeCalendarSources([
      [bulletinEntry({ title: 'Vespers', day: '2026-08-29', startTime: '19:00', endTime: null })],
      [breezeEntry({ title: 'Vespers', day: '2026-08-29', startTime: '19:00', endTime: '19:30' })],
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe('bulletin');
    // The bulletin had no end time; Breeze's is better than none.
    expect(merged[0]?.endTime).toBe('19:30');
  });

  /** A feature event outranks everything, because it is the one with a page. */
  it('prefers an authored event, and keeps its link', () => {
    const merged = mergeCalendarSources([
      [bulletinEntry({ title: 'Summer Camp', day: '2026-08-03', startTime: '09:00' })],
      [occurrence({ id: 'event:summer-camp', title: 'Summer Camp', day: '2026-08-03', startTime: '09:00', source: 'feature', href: '/events/summer-camp' })],
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.href).toBe('/events/summer-camp');
  });
});

describe('groupByDay', () => {
  /**
   * A camp that runs Monday to Friday has to appear on all five days. Pinned to
   * its start, the calendar tells somebody looking at Wednesday that nothing is
   * on.
   */
  it('puts a multi-day entry in every day it covers', () => {
    const byDay = groupByDay([
      occurrence({ id: 'camp', day: '2026-08-03', endDay: '2026-08-07', allDay: true }),
    ]);

    expect([...byDay.keys()]).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
    ]);
  });
});

describe('rangeLength', () => {
  it('counts both ends of the range', () => {
    expect(rangeLength('2026-08-23', '2026-08-29')).toBe(7);
    expect(rangeLength('2026-08-23', '2026-08-23')).toBe(1);
  });

  /** The cap in the Function is enforced on this number, so a bad pair must not
      come back as a small positive one. */
  it('rejects a backwards or unreadable range', () => {
    expect(rangeLength('2026-08-29', '2026-08-23')).toBe(-1);
    expect(rangeLength('', '2026-08-23')).toBe(-1);
    expect(rangeLength('yesterday', 'tomorrow')).toBe(-1);
  });

  /** Across a DST boundary, where naive millisecond division loses an hour and
      `Math.round` is what keeps the count whole. */
  it('counts correctly across a DST change', () => {
    expect(rangeLength('2026-11-01', '2026-11-07')).toBe(7);
    expect(rangeLength('2026-03-08', '2026-03-14')).toBe(7);
  });
});

/* ---- the site's own events ---------------------------------------------- */

describe('occurrenceOfEvent', () => {
  /**
   * The one place an instant becomes a civil date. A liturgy at 9am Eastern
   * rendered in UTC reads as 1pm — and anything in the evening lands on the
   * wrong day entirely, which is the failure the whole civil-string design
   * exists to prevent.
   */
  it('reads an instant in the parish zone, not the host zone', () => {
    // 2026-08-25T00:30:00Z is 8:30pm on the 24th in Wayland.
    const event = occurrenceOfEvent(
      {
        slug: 'late-vigil',
        title: 'Vigil',
        startAt: new Date('2026-08-25T00:30:00Z'),
        endAt: null,
        allDay: false,
      },
      'America/New_York',
    );

    expect(event.day).toBe('2026-08-24');
    expect(event.startTime).toBe('20:30');
  });

  it('honours the event’s own zone over the default', () => {
    const event = occurrenceOfEvent(
      {
        slug: 'cairo',
        title: 'Broadcast from Cairo',
        startAt: new Date('2026-08-25T00:30:00Z'),
        endAt: null,
        allDay: false,
        timeZone: 'Africa/Cairo',
      },
      'America/New_York',
    );

    expect(event.day).toBe('2026-08-25');
  });

  /** The reason a feature event is worth merging in: it has somewhere to go. */
  it('carries a link to its own page', () => {
    const event = occurrenceOfEvent(
      {
        slug: 'summer-camp',
        title: 'Summer Camp',
        startAt: new Date('2026-08-03T12:00:00Z'),
        endAt: null,
        allDay: true,
      },
      'America/New_York',
    );

    expect(event.href).toBe('/events/summer-camp');
    expect(event.source).toBe('feature');
    expect(event.startTime).toBeNull();
  });
});

/* ---- view ranges --------------------------------------------------------- */

describe('weekRange', () => {
  /**
   * Monday to Sunday, matching the bulletin's own week — `weekOf` is a Monday
   * and `days[0]` is Monday, so a Sunday-first grid put the parish's published
   * week across two of ours.
   */
  it('opens the week on Monday, whichever day it is anchored to', () => {
    for (const anchor of ['2026-08-24', '2026-08-26', '2026-08-30']) {
      const week = weekRange(anchor);
      expect(week.from).toBe('2026-08-24');
      expect(week.to).toBe('2026-08-30');
      expect(week.days).toHaveLength(7);
    }
  });

  /** Sunday belongs to the week that *began* six days earlier, not the next one. */
  it('puts a Sunday at the end of its week', () => {
    expect(weekRange('2026-08-23').from).toBe('2026-08-17');
    expect(weekRange('2026-08-23').to).toBe('2026-08-23');
  });

  /**
   * An empty day keeps its place, so the range is always seven days even when
   * nothing is on. The reader is checking *whether* anything is on Wednesday,
   * and a missing row answers a different question.
   */
  it('spans a month boundary without losing a day', () => {
    const week = weekRange('2026-09-02');
    expect(week.from).toBe('2026-08-31');
    expect(week.to).toBe('2026-09-06');
    expect(week.days).toHaveLength(7);
  });
});

describe('monthRange', () => {
  /**
   * The padding is what makes the grid a grid — and those days are *shown*, so
   * they must be fetched. Without them the last days of July render as reliably
   * empty in the August grid, which is a lie the reader cannot detect.
   */
  it('pads out to whole weeks on both ends', () => {
    // August 2026 opens on a Saturday, so five days of July lead it in on a
    // Monday-first grid (Mon 27th through Fri 31st).
    const august = monthRange('2026-08-15');
    expect(august.from).toBe('2026-07-27');
    expect(august.days.length % 7).toBe(0);
    expect(august.days).toContain('2026-08-01');
    expect(august.days).toContain('2026-08-31');
    expect(august.label).toBe('August 2026');
  });

  it('needs no padding for a month that already fills its weeks', () => {
    // February 2027 opens on a Monday and has 28 days — exactly four rows on a
    // Monday-first grid, with no padding at either end.
    const february = monthRange('2027-02-10');
    expect(february.from).toBe('2027-02-01');
    expect(february.to).toBe('2027-02-28');
    expect(february.days.length % 7).toBe(0);
    expect(february.days).toContain('2027-02-01');
    expect(february.days).toContain('2027-02-28');
  });

  /** Never more than the Function's cap, or the month view 400s on itself. */
  it('never exceeds the range the endpoint will serve', () => {
    for (const month of ['2026-01', '2026-02', '2026-05', '2026-08', '2026-11', '2027-02']) {
      expect(monthRange(`${month}-15`).days.length).toBeLessThanOrEqual(42);
    }
  });
});

describe('step', () => {
  it('moves a week by seven days', () => {
    expect(step('week', '2026-08-26', 1)).toBe('2026-09-02');
    expect(step('week', '2026-08-26', -1)).toBe('2026-08-19');
  });

  /**
   * The classic month-stepper bug: adding days to the 31st walks January 31st
   * to March 3rd, skipping February entirely. Stepping from the first of the
   * month is what makes it exact.
   */
  it('steps months from the first, so a 31st does not skip February', () => {
    expect(step('month', '2027-01-31', 1).slice(0, 7)).toBe('2027-02');
    expect(step('month', '2027-03-31', -1).slice(0, 7)).toBe('2027-02');
  });

  it('crosses a year boundary in both directions', () => {
    expect(step('month', '2026-12-15', 1)).toBe('2027-01-01');
    expect(step('month', '2026-01-15', -1)).toBe('2025-12-01');
    // And further than one year, which is where a naive modulo goes negative.
    expect(step('month', '2026-01-15', -13)).toBe('2024-12-01');
    expect(step('month', '2026-12-15', 13)).toBe('2028-01-01');
  });
});

describe('spanLabel', () => {
  it('prints a week inside one month as one span', () => {
    expect(spanLabel('2026-08-23', '2026-08-29')).toBe('August 23–29, 2026');
  });

  it('names both months when a week straddles them', () => {
    expect(spanLabel('2026-08-30', '2026-09-05')).toBe('August 30 – September 5, 2026');
  });

  it('names both years when a week straddles those', () => {
    expect(spanLabel('2026-12-27', '2027-01-02')).toBe('December 27, 2026 – January 2, 2027');
  });
});

describe('formatClock', () => {
  it('drops the minutes on the hour', () => {
    expect(formatClock('08:00')).toBe('8 AM');
    expect(formatClock('19:00')).toBe('7 PM');
  });

  it('keeps them when they are not', () => {
    expect(formatClock('19:30')).toBe('7:30 PM');
    expect(formatClock('06:45')).toBe('6:45 AM');
  });

  /** `% 12` alone renders both of these as "0". */
  it('gets midnight and noon right', () => {
    expect(formatClock('00:00')).toBe('12 AM');
    expect(formatClock('12:00')).toBe('12 PM');
    expect(formatClock('00:30')).toBe('12:30 AM');
  });

  it('says nothing for an all-day entry', () => {
    expect(formatClock(null)).toBe('');
  });
});

describe('weekdayOf', () => {
  /** Column index on a Monday-first grid, so Sunday is 6 and not 0. */
  it('reads a civil date without the host zone getting a vote', () => {
    expect(weekdayOf('2026-08-24')).toBe(0); // Monday
    expect(weekdayOf('2026-08-29')).toBe(5); // Saturday
    expect(weekdayOf('2026-08-23')).toBe(6); // Sunday
  });
});

/* ---- what kind of thing an occurrence is --------------------------------- */

describe('occurrenceKind', () => {
  /**
   * Every title below is one the parish actually has on its calendar. The
   * classifier only decides a colour, so a miss is cosmetic — but the whole
   * point is that the services read as a group, and these are the services.
   */
  it('places the liturgical services', () => {
    for (const title of [
      'Divine Liturgy',
      'Tuesday Liturgy',
      'Saturday Liturgy',
      'Vespers',
      'Tasbeha',
      'Arabic Tasbeha',
      'Midnight Tasbeha Arabic',
      'Midnight Praises (Tesbeha)',
      'Transfiguration Feast',
      'St Mary Assumption Feast',
      'St Mary Nahda',
    ]) {
      expect(occurrenceKind(title), title).toBe('liturgy');
    }
  });

  it('places the teaching', () => {
    for (const title of [
      'Sunday School',
      'Rites Class',
      'Hymns Class',
      'High School Online Bible Study',
      'St Philopater & St Mina Online Bible Study',
      'Online Middle School Bible Study',
      'Mahragan El Keraza Competition - El Karma',
    ]) {
      expect(occurrenceKind(title), title).toBe('study');
    }
  });

  it('places the gatherings', () => {
    for (const title of [
      'Servants Meeting',
      'St. Maurice & St. Verina Arabic Meeting',
      'SPSM Mother of Mercy Homeless Meals',
      'Fellowship Time',
      'Volleyball Tournament',
      'Tentative KRISPY Trip',
      'Summer Camp Week 2',
      'St Mary College and Youth Meeting',
    ]) {
      expect(occurrenceKind(title), title).toBe('gathering');
    }
  });

  /**
   * `other` is the absence of a claim, not a fourth category — a title the
   * words cannot place gets no colour rather than a guessed one.
   */
  it('declines to guess at a title it cannot place', () => {
    expect(occurrenceKind('Parking lot resurfacing')).toBe('other');
    expect(occurrenceKind('')).toBe('other');
  });

  /**
   * Whole words, not substrings. "Christmas" contains "mass" and "classical"
   * contains "class"; neither should drag an entry into a kind.
   */
  it('matches whole words only', () => {
    expect(occurrenceKind('Classical concert')).toBe('other');
  });
});
