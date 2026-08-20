import { describe, it, expect } from 'vitest';
import { captionOf } from '../../apps/website/src/features/programs/caption.js';

/**
 * The one-line captions under each program in the Events dropdown.
 *
 * Worth testing because the failure is silent and public. A caption is derived
 * from prose an administrator wrote, so it is never checked by anyone before it
 * appears in the header of every page on the site — and it is only ever a few
 * words, so a wrong one looks deliberate rather than broken.
 */

describe('captionOf', () => {
  it('takes the first sentence', () => {
    expect(captionOf('Meals are served monthly. Volunteers meet at six.')).toBe(
      'Meals are served monthly.',
    );
  });

  /**
   * The regression. Splitting naively on ". " reduced "St. Simon for Seniors…"
   * to the caption "St." — and half the parish's ministries are named for a
   * saint. Found by reading the rendered HTML, not by a test.
   */
  it('does not mistake a saint\'s title for the end of a sentence', () => {
    expect(captionOf('St. Simon offers care and fellowship to the elderly.')).toBe(
      'St. Simon offers care and fellowship to the elderly.',
    );
  });

  it('handles the other titles a parish uses', () => {
    expect(captionOf('Fr. Daoud leads it.')).toBe('Fr. Daoud leads it.');
    expect(captionOf('Ss. Peter and Paul are remembered.')).toBe(
      'Ss. Peter and Paul are remembered.',
    );
    expect(captionOf('Dr. Mina speaks each month.')).toBe('Dr. Mina speaks each month.');
  });

  it('still splits when a real sentence follows an abbreviation', () => {
    expect(captionOf('St. Simon meets weekly. Everyone is welcome.')).toBe(
      'St. Simon meets weekly.',
    );
  });

  it('does not split on a decimal point', () => {
    expect(captionOf('Tickets are 12.50 for the weekend.')).toBe(
      'Tickets are 12.50 for the weekend.',
    );
  });

  it('does not split mid-sentence on a lowercase continuation', () => {
    expect(captionOf('It meets on the first Friday. it is open to all.')).toBe(
      'It meets on the first Friday. it is open to all.',
    );
  });

  it('takes only the first paragraph', () => {
    expect(captionOf('The first line.\n\nA second paragraph entirely.')).toBe('The first line.');
  });

  it('strips markdown marks and reduces a link to its text', () => {
    expect(captionOf('It runs **monthly**, on the [fourth Friday](/calendar).')).toBe(
      'It runs monthly, on the fourth Friday.',
    );
  });

  it('collapses newlines inside a paragraph', () => {
    expect(captionOf('Meals for people\nwho are homeless.')).toBe(
      'Meals for people who are homeless.',
    );
  });

  /**
   * The seeded descriptions carry a "REPLACE — …" note aimed at whoever writes
   * the copy. It must never reach a visitor's screen.
   */
  it('suppresses the placeholder note rather than publishing it', () => {
    expect(captionOf('REPLACE — the old site said nothing more than the day it meets.')).toBe('');
  });

  it('is empty for an empty description', () => {
    expect(captionOf('')).toBe('');
  });

  describe('length', () => {
    const long =
      'To offer compassionate care, support, and fellowship to the elderly and those who are sick.';

    it('truncates an over-long sentence', () => {
      const caption = captionOf(long);
      expect(caption.length).toBeLessThanOrEqual(63);
      expect(caption.endsWith('…')).toBe(true);
    });

    it('cuts on a word boundary, not mid-word', () => {
      const kept = captionOf(long).replace('…', '');
      // The kept text is a prefix of the original, and the original continues
      // with a space \u2014 which is what "did not cut a word in half" means. A
      // truncated caption necessarily *ends* in a word character, so asserting
      // otherwise (as this test first did) is asserting the opposite.
      expect(long.startsWith(kept)).toBe(true);
      expect(long[kept.length]).toBe(' ');
    });

    it('leaves a short sentence untouched, with no ellipsis', () => {
      expect(captionOf('Monthly, the first Friday.')).toBe('Monthly, the first Friday.');
    });

    it('does not leave a dangling comma before the ellipsis', () => {
      expect(captionOf('Care, support, fellowship, and prayer for the elderly and the sick.'))
        .not.toMatch(/[,;:]…$/);
    });
  });
});
