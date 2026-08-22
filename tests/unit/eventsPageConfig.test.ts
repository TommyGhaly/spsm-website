import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EVENTS_PAGE_CONFIG,
  parseEventsPageConfig,
} from '../../packages/shared/src/schema/config.js';

/**
 * `config/events` — the `/events` page's own settings, which today is one
 * pointer at one ministry.
 *
 * Worth tests for the reason the rest of the config parsers have them: this
 * document is hand-editable in the Firebase console, and **nothing downstream of
 * it fails loudly.** A blank string read as a real pointer is a ministry id that
 * matches nothing, which every reader then treats as "not set" — the same
 * outcome as null, reached by accident, in a page that looks entirely correct.
 * What must not happen is the two spellings of "nothing" reaching consumers, so
 * that each one has to write its own `|| null`.
 */

describe('parseEventsPageConfig', () => {
  it('reads a ministry id', () => {
    expect(parseEventsPageConfig({ mainSection: 'summercamp' }).mainSection).toBe('summercamp');
  });

  it('trims what somebody typed in the console', () => {
    expect(parseEventsPageConfig({ mainSection: '  summercamp  ' }).mainSection).toBe(
      'summercamp',
    );
  });

  /* The whole point of the `|| null` in there: one spelling of "nothing chosen"
     reaches every reader, whether the field is absent, null, blank, or spaces. */
  it('gives null for every shape of nothing', () => {
    for (const raw of [
      undefined,
      null,
      {},
      { mainSection: null },
      { mainSection: '' },
      { mainSection: '   ' },
    ]) {
      expect(parseEventsPageConfig(raw).mainSection).toBeNull();
    }
  });

  it('gives null rather than a coerced value for a non-string', () => {
    for (const mainSection of [42, true, [], { programId: 'summercamp' }]) {
      expect(parseEventsPageConfig({ mainSection }).mainSection).toBeNull();
    }
  });

  /*
   * The shape this field held for about an hour, before it was narrowed to a
   * ministry. Nothing in production ever carried it, but a document written
   * during that window would, and reading `{ programId: … }` as a ministry id is
   * the one wrong answer available — it would point the tags at a ministry
   * nobody chose rather than at nothing.
   */
  it('does not mistake the old { programId, programEventId } pointer for an id', () => {
    expect(
      parseEventsPageConfig({
        mainSection: { programId: 'summercamp', programEventId: 'day-1' },
      }).mainSection,
    ).toBeNull();
  });

  it('matches the committed default when the document is empty', () => {
    expect(parseEventsPageConfig({})).toEqual(DEFAULT_EVENTS_PAGE_CONFIG);
  });
});
