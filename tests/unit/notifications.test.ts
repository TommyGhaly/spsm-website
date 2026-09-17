import { describe, it, expect } from 'vitest';
import {
  ADMIN_NOTICES,
  ADMIN_NOTICE_SPECS,
  OCCURRENCE_KINDS,
  REMINDER_LEADS,
  defaultReminderPrefs,
  defaultScreenAdmin,
  defaultProgramAdmin,
  entitledAdminNotices,
  noAdminNotices,
  parseAdminNoticePrefs,
  parseReminderPrefs,
  pushDeviceIsUseful,
  reminderLeadLabel,
  wantsAnyAdminNotice,
  wantsReminder,
  withOccurrenceReminder,
  type ScreenAdmin,
} from '@spsm/shared';

/**
 * Who may be told what, and the reminder logic that decides when.
 *
 * ---------------------------------------------------------------------------
 * Two halves, tested for two different reasons.
 *
 * `entitledAdminNotices` is an **authorization** function. It decides whether a
 * row appears on the settings screen, and — more importantly —
 * `functions/src/notify/register.ts` intersects every subscription request
 * through it, and `notify/audience.ts` checks it again at send time. A bug here
 * sends a parishioner's name to somebody who was never trusted with the
 * submission it came from. So the tests below are about the boundaries: a
 * person with nothing, a person with one thing, and the superadmin.
 *
 * The reminder functions are **preference** logic and the risk is different:
 * nothing is disclosed by getting one wrong, but a reminder that fires for an
 * event somebody muted is the failure that makes a person switch the whole
 * feature off. The override ordering in `wantsReminder` and the
 * no-redundant-pin rule in `withOccurrenceReminder` are the two parts that are
 * easy to get subtly wrong and impossible to notice on a device.
 * ---------------------------------------------------------------------------
 */

function screens(granted: Partial<ScreenAdmin> = {}): ScreenAdmin {
  return { ...defaultScreenAdmin(), ...granted };
}

const NOBODY = { superadmin: false };

describe('the notice list itself', () => {
  it('has a spec for every notice, and no spec for anything else', () => {
    // `specOfAdminNotice` non-null asserts its find, which is only safe while
    // this holds. The settings screen maps over the specs, so a missing one is
    // a row that silently never renders.
    expect(ADMIN_NOTICE_SPECS.map((spec) => spec.notice).sort()).toEqual([...ADMIN_NOTICES].sort());
  });

  it('entitles uploads by a program grant rather than a screen', () => {
    // The one exception in the model, and the reason `screen` is nullable.
    const uploads = ADMIN_NOTICE_SPECS.find((spec) => spec.notice === 'uploads');
    expect(uploads?.screen).toBeNull();
    for (const spec of ADMIN_NOTICE_SPECS.filter((entry) => entry.notice !== 'uploads')) {
      expect(spec.screen).not.toBeNull();
    }
  });
});

describe('entitledAdminNotices', () => {
  it('gives a person with no grants nothing at all', () => {
    expect(entitledAdminNotices(NOBODY, defaultScreenAdmin(), defaultProgramAdmin())).toEqual([]);
  });

  it('gives a screen grant exactly its own notice', () => {
    expect(entitledAdminNotices(NOBODY, screens({ forms: true }), defaultProgramAdmin())).toEqual([
      'forms',
    ]);
  });

  it('does not let the forms grant reach the car park, or the reverse', () => {
    /*
     * The split that matters most in this file. `forms` opens personal data —
     * a child's allergies on a registration — and the car-park volunteer holds
     * `parking` and nothing else. `onFormSubmitted` routes on the form's kind
     * for exactly this reason.
     */
    expect(entitledAdminNotices(NOBODY, screens({ parking: true }), defaultProgramAdmin())).toEqual([
      'parking',
    ]);
    expect(
      entitledAdminNotices(NOBODY, screens({ forms: true }), defaultProgramAdmin()),
    ).not.toContain('parking');
  });

  it('entitles uploads to anybody holding one program, by either half of the grant', () => {
    expect(
      entitledAdminNotices(NOBODY, defaultScreenAdmin(), { programs: ['summercamp'], events: [] }),
    ).toEqual(['uploads']);

    // A grant on one gathering is enough to see the row; which *particular*
    // photograph reaches them is `audienceForProgramEvent`'s narrower question.
    expect(
      entitledAdminNotices(NOBODY, defaultScreenAdmin(), { programs: [], events: ['week-1'] }),
    ).toEqual(['uploads']);
  });

  it('gives the superadmin everything without any grant being written down', () => {
    // `grant-admin.mjs` bootstraps an account that may have no member document
    // at all, so this must not depend on the maps.
    expect(
      entitledAdminNotices({ superadmin: true }, defaultScreenAdmin(), defaultProgramAdmin()),
    ).toEqual([...ADMIN_NOTICES]);
  });

  it('survives the absent maps a bootstrapped account really has', () => {
    expect(entitledAdminNotices(null, null, null)).toEqual([]);
    expect(entitledAdminNotices(undefined, undefined, undefined)).toEqual([]);
  });
});

describe('admin notice preferences', () => {
  it('defaults to nothing, because these are opt-in', () => {
    /*
     * The asymmetry worth asserting: every other grant-shaped map in this
     * codebase is all-false because a permission must be given, and this one is
     * all-false so that shipping the feature does not push a fortnight of
     * backlog at every servant in the parish.
     */
    expect(wantsAnyAdminNotice(noAdminNotices())).toBe(false);
    expect(Object.values(noAdminNotices()).every((on) => on === false)).toBe(true);
  });

  it('drops keys that are not notices, and reads a missing one as false', () => {
    const parsed = parseAdminNoticePrefs({ forms: true, nonsense: true });
    expect(parsed.forms).toBe(true);
    expect(parsed.orders).toBe(false);
    expect('nonsense' in parsed).toBe(false);
  });

  it('reads anything unusable as nothing subscribed', () => {
    for (const value of [undefined, null, 'forms', 42, []]) {
      expect(wantsAnyAdminNotice(parseAdminNoticePrefs(value))).toBe(false);
    }
  });

  it('calls a device with nothing ticked not worth keeping', () => {
    // `pushRegister` deletes rather than stores one, which is what keeps
    // `pushDevices` equal to "phones that have opted in".
    expect(pushDeviceIsUseful({ notices: noAdminNotices() })).toBe(false);
    expect(pushDeviceIsUseful({ notices: { ...noAdminNotices(), camp: true } })).toBe(true);
  });
});

describe('reminder preferences', () => {
  it('ships switched off, with working answers behind the switch', () => {
    const prefs = defaultReminderPrefs();
    expect(prefs.enabled).toBe(false);
    // Flipping one switch should produce reminders, not silence and a puzzle.
    expect(prefs.kinds.liturgy).toBe(true);
    // `other` is the bucket for everything `occurrenceKind` could not classify.
    expect(prefs.kinds.other).toBe(false);
    expect(REMINDER_LEADS).toContain(prefs.leadMinutes);
  });

  it('keeps a chosen lead time across an upgrade that adds a kind', () => {
    /*
     * The reason `parseReminderPrefs` falls back field by field rather than
     * discarding the whole object: this is a value written by an older build of
     * the app, not something an adversary sent.
     */
    const parsed = parseReminderPrefs({ enabled: true, leadMinutes: 120 });
    expect(parsed.leadMinutes).toBe(120);
    expect(parsed.enabled).toBe(true);
    // The kinds it did not mention come back as the defaults, complete.
    expect(Object.keys(parsed.kinds).sort()).toEqual([...OCCURRENCE_KINDS].sort());
  });

  it('refuses a lead time that is not on the list', () => {
    // A free number would need validating; the picker offers six answers.
    expect(parseReminderPrefs({ leadMinutes: 37 }).leadMinutes).toBe(
      defaultReminderPrefs().leadMinutes,
    );
  });

  it('deduplicates and bounds the pinned list', () => {
    const parsed = parseReminderPrefs({ pinned: ['a', 'a', 'b', 7, '', null] });
    expect(parsed.pinned).toEqual(['a', 'b']);
  });

  it('labels every lead time the picker offers', () => {
    expect(reminderLeadLabel(0)).toBe('When it starts');
    expect(reminderLeadLabel(30)).toBe('30 minutes before');
    expect(reminderLeadLabel(60)).toBe('1 hour before');
    expect(reminderLeadLabel(120)).toBe('2 hours before');
    expect(reminderLeadLabel(1440)).toBe('The day before');
    for (const minutes of REMINDER_LEADS) {
      expect(reminderLeadLabel(minutes)).not.toBe('');
    }
  });
});

describe('wantsReminder', () => {
  const on = { ...defaultReminderPrefs(), enabled: true };

  it('says nothing at all while the master switch is off', () => {
    const off = { ...on, enabled: false };
    expect(wantsReminder(off, { id: 'x', kind: 'liturgy' })).toBe(false);
  });

  it('follows the standing subscription by kind', () => {
    expect(wantsReminder(on, { id: 'x', kind: 'liturgy' })).toBe(true);
    expect(wantsReminder(on, { id: 'x', kind: 'other' })).toBe(false);
  });

  it('lets a mute beat the subscription that would otherwise include it', () => {
    // The 6am Liturgy inside a subscription to Liturgies. Without this the only
    // way to say so is to give up the subscription.
    const muted = { ...on, muted: ['dawn'] };
    expect(wantsReminder(muted, { id: 'dawn', kind: 'liturgy' })).toBe(false);
  });

  it('lets a pin beat a kind that is switched off', () => {
    // The retreat that is not a kind of anything and happens once.
    const pinned = { ...on, pinned: ['retreat'] };
    expect(wantsReminder(pinned, { id: 'retreat', kind: 'other' })).toBe(true);
  });

  it('lets a mute beat a pin, because it is the later word', () => {
    // Only reachable from hand-edited storage — `withOccurrenceReminder` never
    // writes both — but the order has to be defined rather than incidental.
    const both = { ...on, pinned: ['x'], muted: ['x'] };
    expect(wantsReminder(both, { id: 'x', kind: 'liturgy' })).toBe(false);
  });
});

describe('withOccurrenceReminder', () => {
  const on = { ...defaultReminderPrefs(), enabled: true };

  it('records nothing when the tap agrees with the kind', () => {
    /*
     * The rule that stops the bug: ticking a Liturgy while Liturgies are
     * already on must not add a pin, because turning the kind off later would
     * leave that pin behind and one Liturgy would keep buzzing — which reads as
     * the switch not working.
     */
    const next = withOccurrenceReminder(on, { id: 'x', kind: 'liturgy' }, true);
    expect(next.pinned).toEqual([]);
    expect(next.muted).toEqual([]);
  });

  it('mutes when the tap disagrees with a kind that is on', () => {
    const next = withOccurrenceReminder(on, { id: 'dawn', kind: 'liturgy' }, false);
    expect(next.muted).toEqual(['dawn']);
    expect(wantsReminder(next, { id: 'dawn', kind: 'liturgy' })).toBe(false);
  });

  it('pins when the tap disagrees with a kind that is off', () => {
    const next = withOccurrenceReminder(on, { id: 'retreat', kind: 'other' }, true);
    expect(next.pinned).toEqual(['retreat']);
    expect(wantsReminder(next, { id: 'retreat', kind: 'other' })).toBe(true);
  });

  it('is reversible, leaving no trace of either override', () => {
    const muted = withOccurrenceReminder(on, { id: 'dawn', kind: 'liturgy' }, false);
    const back = withOccurrenceReminder(muted, { id: 'dawn', kind: 'liturgy' }, true);
    expect(back.muted).toEqual([]);
    expect(back.pinned).toEqual([]);
    expect(wantsReminder(back, { id: 'dawn', kind: 'liturgy' })).toBe(true);
  });

  it('never holds the same id in both lists', () => {
    const pinned = withOccurrenceReminder(on, { id: 'retreat', kind: 'other' }, true);
    const muted = withOccurrenceReminder(pinned, { id: 'retreat', kind: 'other' }, false);
    expect(muted.pinned).not.toContain('retreat');
    expect(muted.muted).not.toContain('retreat');
  });
});

describe('the refunds notice', () => {
  it('rides on the finance grant, not the bookstore one', () => {
    /*
     * The shop's volunteer packs parcels; the treasurer asks why money went
     * back out. Two jobs, and /access offers them as two rows.
     */
    expect(entitledAdminNotices(NOBODY, screens({ finance: true }), defaultProgramAdmin())).toEqual([
      'refunds',
    ]);
    expect(
      entitledAdminNotices(NOBODY, screens({ bookstore: true }), defaultProgramAdmin()),
    ).toEqual(['orders']);
  });

  it('lets somebody hold several notices at once', () => {
    // Every row is independent; this is not a single choice.
    expect(
      entitledAdminNotices(
        NOBODY,
        screens({ bookstore: true, forms: true, finance: true, camp: true }),
        { programs: ['summercamp'], events: [] },
      ).sort(),
    ).toEqual(['camp', 'forms', 'orders', 'refunds', 'uploads'].sort());
  });
});
