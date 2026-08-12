import { describe, it, expect } from 'vitest';
import {
  isAllowedEmbedUrl,
  parseServantsSchedule,
  DEFAULT_SERVANTS_SCHEDULE,
} from '@spsm/shared';

/**
 * This value becomes an `iframe src` on a page servants trust. A bad one is not
 * a broken layout — it is third-party content, or a script, running inside our
 * origin's page. So the allowlist gets tested like the security control it is.
 */

const REAL = 'https://stphilopaterstmina.breezechms.com/embed/calendar/grid?size=medium';

describe('isAllowedEmbedUrl', () => {
  it('accepts the Breeze embed host', () => {
    expect(isAllowedEmbedUrl(REAL)).toBe(true);
    expect(isAllowedEmbedUrl('https://breezechms.com/embed/calendar/grid')).toBe(true);
  });

  it('rejects anything that is not https', () => {
    expect(isAllowedEmbedUrl('http://stphilopaterstmina.breezechms.com/embed')).toBe(false);
    // The one that actually matters: `javascript:` in a src attribute is a
    // script running as us.
    expect(isAllowedEmbedUrl('javascript:alert(document.cookie)')).toBe(false);
    expect(isAllowedEmbedUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects other hosts', () => {
    expect(isAllowedEmbedUrl('https://example.com/embed/calendar/grid')).toBe(false);
  });

  it('is not fooled by a lookalike host', () => {
    // Suffix matching done carelessly accepts all three of these.
    expect(isAllowedEmbedUrl('https://breezechms.com.evil.test/embed')).toBe(false);
    expect(isAllowedEmbedUrl('https://notbreezechms.com/embed')).toBe(false);
    expect(isAllowedEmbedUrl('https://evil.test/?x=breezechms.com')).toBe(false);
  });

  it('rejects a host smuggled into credentials', () => {
    // `new URL(...).hostname` is evil.test here, not breezechms.com — which is
    // exactly why this parses the URL instead of matching on the string.
    expect(isAllowedEmbedUrl('https://breezechms.com@evil.test/embed')).toBe(false);
  });

  it('rejects junk without throwing', () => {
    for (const bad of ['', 'not a url', '//breezechms.com/embed', 'breezechms.com/embed']) {
      expect(isAllowedEmbedUrl(bad)).toBe(false);
    }
  });
});

describe('parseServantsSchedule', () => {
  it('reads a well-formed document', () => {
    const parsed = parseServantsSchedule({
      embedUrl: REAL,
      note: 'Updated every Sunday.',
      manageUrl: 'https://stphilopaterstmina.breezechms.com/login',
    });
    expect(parsed.embedUrl).toBe(REAL);
    expect(parsed.note).toBe('Updated every Sunday.');
  });

  it('blanks a URL that fails the allowlist rather than passing it through', () => {
    // The page treats an empty embedUrl as "not set up yet", so a bad edit
    // degrades to an honest message instead of framing something unknown.
    expect(parseServantsSchedule({ embedUrl: 'https://evil.test/x' }).embedUrl).toBe('');
    expect(parseServantsSchedule({ embedUrl: 'javascript:alert(1)' }).embedUrl).toBe('');
  });

  it('falls back per field, keeping the good ones', () => {
    const parsed = parseServantsSchedule({ embedUrl: 12345, note: 'Still useful.' });
    expect(parsed.embedUrl).toBe('');
    expect(parsed.note).toBe('Still useful.');
  });

  it('returns blanks for junk instead of throwing', () => {
    for (const junk of [null, undefined, 'a string', 42, []]) {
      expect(() => parseServantsSchedule(junk)).not.toThrow();
    }
    expect(parseServantsSchedule(null)).toEqual(DEFAULT_SERVANTS_SCHEDULE);
  });
});
