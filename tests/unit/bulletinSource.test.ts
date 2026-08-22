import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  readActiveBulletin,
  reviveBulletin,
  mostRecentlyPublished,
  activeBulletinId,
  parseBulletin,
  ANNOUNCEMENTS_ACTIVE_BULLETIN_DOC,
  type SourceFirestore,
  type AnnouncementsConfig,
} from '@spsm/shared';

/**
 * Which bulletin the homepage shows.
 *
 * These are regression tests for a live bug, not hypotheticals. The rule used to
 * be "sort by week, take the newest", written when the source was documented as
 * a singleton overwritten weekly. It is not one: the collection holds the week
 * the parish has made active *plus* whichever future week staff have started
 * drafting. So on 2026-08-20 the homepage was headed "August 24, 2026" and
 * listed an unpublished draft, while the screen in the narthex showed August 17.
 *
 * The announcements app records its own answer in `config/active_bulletin`, and
 * following that is what makes the two agree by construction.
 */

const CONFIG: AnnouncementsConfig = {
  enabled: true,
  projectId: 'weeklyannouncements-1d046',
  collectionPath: 'bulletins',
  databaseId: '',
};

/** A source document, shaped the way the announcements app writes one. */
function sourceDoc(weekOf: string, label: string, published: string | null) {
  return {
    weekLabel: label,
    presetName: 'Weekly Schedule',
    lastPublished: published,
    days: [{ date: weekOf, day: 'Monday', events: [{ id: 'e1', name: 'Arabic Tasbeha', time: '5:30pm' }] }],
    multiDayEvents: [],
    announcements: [],
    headerNotes: [],
  };
}

/**
 * A stand-in for the Admin SDK handle. `readActiveBulletin` takes its Firestore
 * structurally precisely so this is a plain object rather than an emulator.
 */
function fakeFirestore(docs: Record<string, Record<string, unknown>>): SourceFirestore {
  return {
    doc: (path: string) => ({
      get: async () => {
        const data = docs[path];
        return {
          exists: data !== undefined,
          id: path.split('/').pop() ?? '',
          data: () => data,
        };
      },
    }),
    collection: (path: string) => ({
      get: async () => {
        const entries = Object.entries(docs).filter(
          ([key]) => key.startsWith(`${path}/`) && key.split('/').length === 2,
        );
        return {
          empty: entries.length === 0,
          docs: entries.map(([key, data]) => ({ id: key.split('/')[1]!, data: () => data })),
        };
      },
    }),
  };
}

/** The real shape: the active week, plus next week's draft. */
const TWO_WEEKS = {
  'bulletins/318bf22a': sourceDoc('2026-08-17', 'August 17, 2026', '2026-08-16T13:49:56.871Z'),
  'bulletins/f746b0ff': sourceDoc('2026-08-24', 'August 24, 2026', null),
};

// The fallback paths all warn on purpose. Silenced so a passing run is quiet,
// and asserted on where the warning is the point.
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe('readActiveBulletin — the pointer is the answer', () => {
  it('follows config/active_bulletin rather than picking the newest week', () => {
    return readActiveBulletin(
      fakeFirestore({
        ...TWO_WEEKS,
        [ANNOUNCEMENTS_ACTIVE_BULLETIN_DOC]: { id: '318bf22a' },
      }),
      CONFIG,
    ).then((bulletin) => {
      // The exact bug: August 24 is the newest document and the wrong answer.
      expect(bulletin?.weekLabel).toBe('August 17, 2026');
      expect(bulletin?.source.documentId).toBe('318bf22a');
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it('follows the pointer even to a week that has not started yet', () => {
    // The parish is entitled to put next week up early, or to leave last week's
    // up over a feast. Deriving the week from dates overrides that decision.
    return readActiveBulletin(
      fakeFirestore({
        ...TWO_WEEKS,
        [ANNOUNCEMENTS_ACTIVE_BULLETIN_DOC]: { id: 'f746b0ff' },
      }),
      CONFIG,
    ).then((bulletin) => {
      expect(bulletin?.weekLabel).toBe('August 24, 2026');
    });
  });

  it('reads one document, not the whole collection, when the pointer is good', async () => {
    const store = fakeFirestore({
      ...TWO_WEEKS,
      [ANNOUNCEMENTS_ACTIVE_BULLETIN_DOC]: { id: '318bf22a' },
    });
    const scan = vi.spyOn(store, 'collection');
    await readActiveBulletin(store, CONFIG);
    expect(scan).not.toHaveBeenCalled();
  });
});

describe('readActiveBulletin — falling back without reaching for the draft', () => {
  it('uses the last PUBLISHED week when the pointer is missing', async () => {
    const bulletin = await readActiveBulletin(fakeFirestore(TWO_WEEKS), CONFIG);
    // Not August 24. The newest document is always the draft, because drafting
    // next week is what people use that app for.
    expect(bulletin?.weekLabel).toBe('August 17, 2026');
    expect(warn).toHaveBeenCalled();
  });

  it('falls back when the pointer names a document that is not there', async () => {
    const bulletin = await readActiveBulletin(
      fakeFirestore({ ...TWO_WEEKS, [ANNOUNCEMENTS_ACTIVE_BULLETIN_DOC]: { id: 'deleted' } }),
      CONFIG,
    );
    expect(bulletin?.weekLabel).toBe('August 17, 2026');
    expect(warn.mock.calls.flat().join(' ')).toContain('deleted');
  });

  it('falls back when the pointer names a document that cannot be parsed', async () => {
    const bulletin = await readActiveBulletin(
      fakeFirestore({
        ...TWO_WEEKS,
        // No usable date in days[] — `parseBulletin` throws on this one.
        'bulletins/broken': { weekLabel: 'Broken week', days: [] },
        [ANNOUNCEMENTS_ACTIVE_BULLETIN_DOC]: { id: 'broken' },
      }),
      CONFIG,
    );
    expect(bulletin?.weekLabel).toBe('August 17, 2026');
  });

  it('returns null rather than a draft when nothing has ever been published', async () => {
    const bulletin = await readActiveBulletin(
      fakeFirestore({ 'bulletins/f746b0ff': TWO_WEEKS['bulletins/f746b0ff'] }),
      CONFIG,
    );
    // A missing section beats an unpublished schedule on the parish's homepage.
    expect(bulletin).toBeNull();
  });

  it('returns null for an empty collection', async () => {
    expect(await readActiveBulletin(fakeFirestore({}), CONFIG)).toBeNull();
  });

  it('ignores a pointer document with no usable id', async () => {
    for (const pointer of [{}, { id: '' }, { id: '   ' }, { id: 42 }]) {
      const bulletin = await readActiveBulletin(
        fakeFirestore({ ...TWO_WEEKS, [ANNOUNCEMENTS_ACTIVE_BULLETIN_DOC]: pointer }),
        CONFIG,
      );
      expect(bulletin?.weekLabel).toBe('August 17, 2026');
    }
  });
});

describe('activeBulletinId', () => {
  it('reads the id, and refuses everything else', () => {
    expect(activeBulletinId({ id: '318bf22a' })).toBe('318bf22a');
    // Trimmed, like every other string this package parses.
    expect(activeBulletinId({ id: '  318bf22a  ' })).toBe('318bf22a');
    for (const junk of [null, undefined, 'a string', [], {}, { id: '' }, { id: 7 }]) {
      expect(activeBulletinId(junk)).toBeNull();
    }
  });
});

describe('mostRecentlyPublished', () => {
  const week = (weekOf: string, published: string | null) =>
    parseBulletin(sourceDoc(weekOf, `Week of ${weekOf}`, published), {
      project: 'p',
      collection: 'bulletins',
      documentId: weekOf,
    });

  it('picks by publish time, not by week', () => {
    // A correction to an older week, published after the newer week went up.
    const weeks = [week('2026-08-24', '2026-08-20T10:00:00Z'), week('2026-08-17', '2026-08-21T10:00:00Z')];
    expect(mostRecentlyPublished(weeks)?.weekOf).toBe('2026-08-17');
  });

  it('never returns an unpublished week', () => {
    expect(mostRecentlyPublished([week('2026-08-24', null)])).toBeNull();
    expect(mostRecentlyPublished([])).toBeNull();
  });
});

/**
 * `reviveBulletin` is the receiving end of `/api/bulletin`: it undoes what JSON
 * does to a `Date`, and refuses anything it cannot vouch for so the page keeps
 * the week already on screen.
 */
describe('reviveBulletin', () => {
  const overTheWire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

  const full = () =>
    parseBulletin(
      {
        weekLabel: 'August 17, 2026',
        presetName: 'St. Mary Nahda Schedule',
        lastPublished: '2026-08-16T13:49:56.871Z',
        updatedAt: '2026-08-16T14:00:00.000Z',
        headerNotes: ['Fasting continues this week.'],
        announcements: [
          { id: 'a1', text: 'Coffee hour follows liturgy.', addedAt: '2026-08-15T10:00:00.000Z' },
        ],
        days: [
          {
            date: '2026-08-17',
            day: 'Monday',
            events: [{ id: 'e1', name: 'Arabic Tasbeha', time: '5:30pm', color: '#992a21' }],
          },
        ],
        multiDayEvents: [
          {
            id: 'm1',
            name: 'St. Mary Nahda',
            time: '7:00pm',
            startDate: '2026-08-17',
            endDate: '2026-08-21',
          },
        ],
      },
      { project: 'weeklyannouncements-1d046', collection: 'bulletins', documentId: '318bf22a' },
    );

  it('round-trips a whole week through JSON unchanged', () => {
    expect(reviveBulletin(overTheWire(full()))).toEqual(full());
  });

  it('restores dates as Dates rather than the strings JSON left behind', () => {
    // The failure this prevents: `publishedAt.getTime()` throwing in a browser
    // on a field the build swears is a Date.
    const revived = reviveBulletin(overTheWire(full()));
    expect(revived?.source.publishedAt).toBeInstanceOf(Date);
    expect(revived?.source.publishedAt?.toISOString()).toBe('2026-08-16T13:49:56.871Z');
    expect(revived?.announcements[0]?.addedAt).toBeInstanceOf(Date);
  });

  it('returns null rather than throwing for anything it cannot vouch for', () => {
    // An HTML error page from a proxy, a truncated body, a cached older shape.
    for (const junk of [null, undefined, '<!doctype html>', 42, [], {}]) {
      expect(reviveBulletin(junk)).toBeNull();
    }
    expect(reviveBulletin({ weekLabel: 'Some week', days: [], source: {} })).toBeNull();
    expect(reviveBulletin({ weekLabel: 'Some week', days: [{ date: '2026-08-17' }] })).toBeNull();
  });

  it('drops an unusable day or span without losing the rest of the week', () => {
    const wire = overTheWire(full()) as Record<string, unknown>;
    (wire['days'] as unknown[]).push({ date: '8/24/2026' });
    (wire['multiDayEvents'] as unknown[]).push({ sourceId: 'm2', name: 'No range given' });
    const revived = reviveBulletin(wire);
    expect(revived?.days).toHaveLength(1);
    expect(revived?.multiDayEvents).toHaveLength(1);
    expect(revived?.days[0]?.events[0]?.name).toBe('Arabic Tasbeha');
  });
});
