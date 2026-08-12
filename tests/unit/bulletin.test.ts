import { describe, it, expect } from 'vitest';
import { parseBulletin, BulletinShapeError } from '@spsm/shared';

/**
 * `parseBulletin` normalizes a document written by an app we do not own, whose
 * schema was inferred from a single sample and which nobody is obliged to keep
 * stable. Its whole contract is "degrade every field except the one that
 * identifies the week" — so that is what these tests pin down.
 */

const ORIGIN = {
  project: 'weeklyannouncements-1d046',
  collection: 'bulletins',
  documentId: 'current',
};

/** A minimally valid document: one dated day, plus a week label. */
function minimal(overrides: Record<string, unknown> = {}) {
  return {
    weekLabel: 'Week of August 10',
    days: [{ date: '2026-08-10', day: 'Monday', events: [] }],
    ...overrides,
  };
}

describe('parseBulletin — the two things that throw', () => {
  it('throws when no day carries a usable ISO date', () => {
    expect(() => parseBulletin({ weekLabel: 'Some week', days: [] }, ORIGIN)).toThrow(
      BulletinShapeError,
    );
  });

  it('rejects a date that is not ISO yyyy-mm-dd, rather than guessing', () => {
    // "8/10/2026" is a plausible thing for a human to type into the source app.
    // Guessing at it is how the whole week lands on the wrong dates.
    expect(() =>
      parseBulletin({ weekLabel: 'Some week', days: [{ date: '8/10/2026' }] }, ORIGIN),
    ).toThrow(BulletinShapeError);
  });

  it('throws when weekLabel is missing or blank', () => {
    expect(() => parseBulletin({ days: [{ date: '2026-08-10' }] }, ORIGIN)).toThrow(
      BulletinShapeError,
    );
    expect(() =>
      parseBulletin({ weekLabel: '   ', days: [{ date: '2026-08-10' }] }, ORIGIN),
    ).toThrow(BulletinShapeError);
  });
});

describe('parseBulletin — everything else degrades', () => {
  it('takes weekOf from the earliest day, not from the array order', () => {
    const bulletin = parseBulletin(
      minimal({
        days: [
          { date: '2026-08-14', day: 'Friday' },
          { date: '2026-08-10', day: 'Monday' },
        ],
      }),
      ORIGIN,
    );
    expect(bulletin.weekOf).toBe('2026-08-10');
    expect(bulletin.days.map((d) => d.date)).toEqual(['2026-08-10', '2026-08-14']);
  });

  it('drops unnamed events — a blank row in the editor is not data', () => {
    const bulletin = parseBulletin(
      minimal({
        days: [
          {
            date: '2026-08-10',
            day: 'Monday',
            events: [{ name: 'Vespers', time: '7:30pm' }, { time: '9:00am' }, {}],
          },
        ],
      }),
      ORIGIN,
    );
    expect(bulletin.days[0]?.events).toHaveLength(1);
    expect(bulletin.days[0]?.events[0]?.name).toBe('Vespers');
  });

  it('keeps times as written and never parses them into an instant', () => {
    // The source guarantees no time format and records no time zone. Parsing
    // "7:30am" silently produces a wrong instant when either assumption breaks.
    const bulletin = parseBulletin(
      minimal({
        days: [
          { date: '2026-08-10', events: [{ name: 'Liturgy', time: '7:30am', timeTo: '10:00am' }] },
        ],
      }),
      ORIGIN,
    );
    const event = bulletin.days[0]?.events[0];
    expect(event?.time).toBe('7:30am');
    expect(event?.timeTo).toBe('10:00am');
  });

  it('survives every optional field being the wrong type', () => {
    const bulletin = parseBulletin(
      minimal({
        presetName: 42,
        announcements: 'not an array',
        multiDayEvents: null,
        headerNotes: [null, 'A real note', 7],
        lastPublished: 'not a date',
      }),
      ORIGIN,
    );
    expect(bulletin.presetName).toBeNull();
    expect(bulletin.announcements).toEqual([]);
    expect(bulletin.multiDayEvents).toEqual([]);
    expect(bulletin.headerNotes).toEqual(['A real note']);
    expect(bulletin.source.publishedAt).toBeNull();
  });

  it('parses ISO timestamps into Dates and reports the origin it was told', () => {
    const bulletin = parseBulletin(
      minimal({ lastPublished: '2026-08-09T14:30:00.000Z' }),
      ORIGIN,
    );
    expect(bulletin.source.publishedAt?.toISOString()).toBe('2026-08-09T14:30:00.000Z');
    expect(bulletin.source.project).toBe('weeklyannouncements-1d046');
    expect(bulletin.source.documentId).toBe('current');
  });

  it('gives unnamed announcements a stable synthetic id', () => {
    const bulletin = parseBulletin(
      minimal({ announcements: [{ text: 'Coffee hour follows liturgy.' }] }),
      ORIGIN,
    );
    expect(bulletin.announcements[0]?.sourceId).toBe('untitled-0');
  });

  it('drops a multi-day event that is missing its date range', () => {
    const bulletin = parseBulletin(
      minimal({
        multiDayEvents: [
          { name: 'Summer camp', startDate: '2026-08-10', endDate: '2026-08-14' },
          { name: 'No range given' },
        ],
      }),
      ORIGIN,
    );
    expect(bulletin.multiDayEvents).toHaveLength(1);
    expect(bulletin.multiDayEvents[0]?.name).toBe('Summer camp');
  });
});
