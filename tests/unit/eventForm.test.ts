import { describe, it, expect } from 'vitest';
import {
  BLANK_EVENT_FORM,
  PARISH_TIME_ZONE,
  applyDraft,
  draftToDocument,
  endInstantOf,
  eventMistakes,
  eventStillMissing,
  eventToForm,
  formToDraft,
  formatEventWhen,
  startInstantOf,
  type Event,
  type EventFormState,
} from '@spsm/shared';

/**
 * The arithmetic behind both event editors.
 *
 * This model is shared by the website's in-place editor and the mobile app's,
 * which is the whole reason it is worth testing here rather than in either: the
 * two surfaces must agree about what a date field means, what counts as a
 * mistake, and what a save overwrites. A difference in any of the three is one
 * document with two opinions about itself.
 *
 * The cases chosen are the ones the parish has actually got wrong — an event
 * that runs past midnight, an end before a start, and a festival in a zone that
 * is not the church's — plus the two round trips that must not lose anything.
 */

const ZONE = PARISH_TIME_ZONE;

function form(over: Partial<EventFormState> = {}): EventFormState {
  return {
    ...BLANK_EVENT_FORM,
    title: 'Iconography class',
    date: '2026-09-06',
    startTime: '19:00',
    ...over,
  };
}

function document(over: Partial<Event> = {}): Event {
  return {
    slug: 'iconography-class',
    title: 'Iconography class',
    summary: 'A six-week introduction.',
    body: 'Bring a board.',
    startAt: new Date('2026-09-06T23:00:00.000Z'), // 19:00 in New York, EDT.
    endAt: null,
    allDay: false,
    timeZone: ZONE,
    location: null,
    heroImagePath: null,
    category: 'class',
    tags: [],
    registration: null,
    audience: 'parish',
    recurrence: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedBy: null,
    ...over,
  };
}

describe('the wall clock', () => {
  it('reads the fields in the event’s own zone, not the reader’s', () => {
    // 19:00 in New York on 6 September is 23:00 UTC, because of daylight time.
    // Getting this wrong by an hour is the whole reason `timeZone` is stored.
    expect(startInstantOf(form())?.toISOString()).toBe('2026-09-06T23:00:00.000Z');
  });

  it('starts an all-day event at midnight, so it lands in the right cell', () => {
    const at = startInstantOf(form({ allDay: true, startTime: '' }));
    expect(at?.toISOString()).toBe('2026-09-06T04:00:00.000Z');
  });

  it('has no end until one is given — open-ended is a real state', () => {
    expect(endInstantOf(form())).toBeNull();
  });

  it('puts the end on the first day when no second day is named', () => {
    const at = endInstantOf(form({ endTime: '21:00' }));
    expect(at?.toISOString()).toBe('2026-09-07T01:00:00.000Z');
  });

  it('runs an event past midnight onto the day it is given', () => {
    const at = endInstantOf(form({ endTime: '01:00', endDate: '2026-09-07' }));
    expect(at?.toISOString()).toBe('2026-09-07T05:00:00.000Z');
  });

  it('ends a multi-day all-day event at the end of its last day', () => {
    // A three-day festival has to read as three days rather than as two and a
    // bit, which is what ending at the *start* of the last day would give.
    const at = endInstantOf(form({ allDay: true, startTime: '', endDate: '2026-09-08' }));
    expect(at?.toISOString()).toBe('2026-09-09T03:59:00.000Z');
  });

  it('keeps a festival in another zone in that zone', () => {
    const at = startInstantOf(form({ timeZone: 'Africa/Cairo' }));
    expect(at?.toISOString()).toBe('2026-09-06T16:00:00.000Z');
  });
});

describe('what is wrong with it', () => {
  it('has nothing to say about a complete event', () => {
    expect(eventMistakes(form({ summary: 'A class.', body: 'Bring a board.' }))).toEqual([]);
    expect(eventStillMissing(form({ summary: 'A class.', body: 'Bring a board.' }))).toEqual([]);
  });

  it('asks for a name, a day and a start time', () => {
    const problems = eventMistakes(form({ title: '', date: '', startTime: '' }));
    expect(problems.map((problem) => problem.field)).toEqual(['title', 'date']);
  });

  it('names the shape a typed date has to have', () => {
    // The browser's date input cannot produce this. The app's typed field can,
    // and without the check the save silently does nothing.
    const problems = eventMistakes(form({ date: '2026-9-6' }));
    expect(problems[0]).toMatchObject({ field: 'date', message: 'Write the day as 2026-09-06.' });
  });

  it('catches an end before its start', () => {
    const problems = eventMistakes(form({ endTime: '18:00' }));
    expect(problems).toContainEqual({ field: 'endTime', message: 'It ends before it starts.' });
  });

  it('does not call an overnight event a mistake', () => {
    expect(eventMistakes(form({ endTime: '01:00', endDate: '2026-09-07' }))).toEqual([]);
  });

  it('wants an end time once it runs onto another day', () => {
    const problems = eventMistakes(form({ endDate: '2026-09-07' }));
    expect(problems.map((problem) => problem.field)).toEqual(['endTime']);
  });

  it('refuses a link that is not a link', () => {
    const problems = eventMistakes(form({ registrationUrl: 'signup.example.com' }));
    expect(problems.map((problem) => problem.field)).toEqual(['registrationUrl']);
  });

  it('keeps an unwritten description as advice rather than an error', () => {
    // An event with no description is the ordinary state of a new one, and it
    // is on the website the whole time it stays that way. Red would be nagging
    // about the normal case.
    const empty = form({ summary: '', body: '' });
    expect(eventMistakes(empty)).toEqual([]);
    expect(eventStillMissing(empty).map((problem) => problem.message)).toEqual([
      'the one line the calendar shows',
      'a description',
    ]);
  });
});

describe('the round trip', () => {
  it('reads a document into fields and writes the same instants back', () => {
    const before = document({ endAt: new Date('2026-09-07T01:00:00.000Z') });
    const fields = eventToForm(before);

    expect(fields).toMatchObject({
      date: '2026-09-06',
      startTime: '19:00',
      endTime: '21:00',
      // Blank, because it ends on the day it started. The second date field is
      // drawn only when this has something in it.
      endDate: '',
    });

    const draft = formToDraft(fields);
    expect(draft?.startAt.toISOString()).toBe('2026-09-06T23:00:00.000Z');
    expect(draft?.endAt?.toISOString()).toBe('2026-09-07T01:00:00.000Z');
  });

  it('carries a second day through when there is one', () => {
    const fields = eventToForm(
      document({
        startAt: new Date('2026-09-06T23:00:00.000Z'),
        endAt: new Date('2026-09-07T05:00:00.000Z'),
      }),
    );
    expect(fields.endDate).toBe('2026-09-07');
    expect(fields.endTime).toBe('01:00');
  });

  it('drops the times of an all-day event rather than showing midnight', () => {
    const fields = eventToForm(document({ allDay: true }));
    expect(fields.startTime).toBe('');
    expect(fields.endTime).toBe('');
  });

  it('answers null while the date is empty, so autosave holds instead of throwing', () => {
    expect(formToDraft(form({ date: '' }))).toBeNull();
  });
});

describe('what a save overwrites', () => {
  it('builds the registration object from the one field the editors offer', () => {
    const draft = formToDraft(form({ registrationUrl: ' https://example.com/signup ' }));
    expect(draftToDocument(draft!).registration).toEqual({
      formId: null,
      externalUrl: 'https://example.com/signup',
      opensAt: null,
      closesAt: null,
      capacity: null,
    });
  });

  it('clears the whole registration rather than merging when the link goes', () => {
    // A merge would preserve a capacity or an opening date that no editor on
    // either surface can see or clear.
    const draft = formToDraft(form({ registrationUrl: '' }));
    expect(draftToDocument(draft!).registration).toBeNull();
  });

  it('sends no slug and no recurrence', () => {
    const written = draftToDocument(formToDraft(form())!);
    expect(written).not.toHaveProperty('slug');
    expect(written).not.toHaveProperty('recurrence');
  });

  it('drops a location that has been emptied, and trims the one that has not', () => {
    expect(formToDraft(form({ locationName: '   ' }))?.location).toBeNull();
    expect(formToDraft(form({ locationName: ' The hall ' }))?.location).toEqual({
      name: 'The hall',
      address: null,
      meetingUrl: null,
    });
  });

  it('advances a local copy without letting the editor’s own shape leak into it', () => {
    const before = document();
    const after = applyDraft(before, formToDraft(form({ title: 'Renamed' }))!);

    expect(after.title).toBe('Renamed');
    expect(after.slug).toBe('iconography-class');
    expect(after).not.toHaveProperty('registrationUrl');
  });
});

describe('the sentence both surfaces print', () => {
  it('prints a same-day range with the day once', () => {
    expect(
      formatEventWhen(
        new Date('2026-09-06T23:00:00.000Z'),
        new Date('2026-09-07T01:00:00.000Z'),
        false,
        ZONE,
      ),
    ).toBe('Sunday, September 6, 2026 · 7:00 PM – 9:00 PM');
  });

  it('prints no time at all for an all-day event', () => {
    expect(formatEventWhen(new Date('2026-09-06T04:00:00.000Z'), null, true, ZONE)).toBe(
      'Sunday, September 6, 2026',
    );
  });

  it('prints both days when it runs onto another', () => {
    expect(
      formatEventWhen(
        new Date('2026-09-06T23:00:00.000Z'),
        new Date('2026-09-07T05:00:00.000Z'),
        false,
        ZONE,
      ),
    ).toBe('Sunday, September 6, 2026, 7:00 PM – Monday, September 7, 2026, 1:00 AM');
  });

  it('says nothing rather than something wrong when there is no start', () => {
    expect(formatEventWhen(null, null, false, ZONE)).toBe('');
  });
});
