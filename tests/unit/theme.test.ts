import { describe, it, expect } from 'vitest';
import {
  parseTheme,
  emitThemeCss,
  isSafeThemeCss,
  decodeFirestoreFields,
  decodeFirestoreValue,
  publicDocumentUrl,
  resolveTheme,
  resolveFluid,
  letterSpacingPoints,
  DEFAULT_THEME,
  THEME_SCHEMA_VERSION,
  type ThemeTokens,
} from '@spsm/shared';

/**
 * `config/theme` is admin-writable and hand-edited in the Firebase console, and
 * its parsed output is interpolated into a `<style>` element on every page of
 * the site. So this suite is doing two different jobs:
 *
 *   1. the ordinary config contract — every field falls back independently, so
 *      one bad edit does not discard the rest of the theme;
 *   2. the security contract — no string from the document can reach the
 *      stylesheet. That one is not a nicety. A compromised admin account that
 *      can write arbitrary CSS into every page can deface the site, and
 *      `url()` alone exfiltrates who is reading it.
 */

describe('parseTheme — fallbacks are per field', () => {
  it('returns the committed theme for junk input', () => {
    // The site must render correctly with no Firestore read at all.
    for (const junk of [null, undefined, 42, 'a string', [], () => {}]) {
      expect(parseTheme(junk)).toEqual(DEFAULT_THEME);
    }
  });

  it('keeps a good field when a sibling is broken', () => {
    const theme = parseTheme({
      color: { accent: '#123456', ink: 'not a colour' },
    });
    expect(theme.color.accent).toBe('#123456');
    expect(theme.color.ink).toBe(DEFAULT_THEME.color.ink);
  });

  it('accepts 3-, 4-, 6-, and 8-digit hex, normalised to lowercase', () => {
    expect(parseTheme({ color: { ink: '#ABC' } }).color.ink).toBe('#abc');
    expect(parseTheme({ color: { ink: '#ABCD' } }).color.ink).toBe('#abcd');
    expect(parseTheme({ color: { ink: '#AABBCC' } }).color.ink).toBe('#aabbcc');
    expect(parseTheme({ color: { ink: '#AABBCCDD' } }).color.ink).toBe('#aabbccdd');
  });
});

describe('parseTheme — a CSS string is not a token', () => {
  /**
   * The rule the whole schema exists to enforce. Each of these renders fine on
   * the web and is unparseable to React Native, so accepting one would produce
   * a site that looks right and an app that does not — discovered months later,
   * when part 2 starts.
   */
  it('rejects colour functions and keywords in favour of hex', () => {
    for (const notHex of [
      'red',
      'rebeccapurple',
      'transparent',
      'currentColor',
      'rgb(1 2 3)',
      'rgba(1,2,3,.5)',
      'oklch(0.7 0.1 20)',
      'color-mix(in oklab, red, blue)',
      'light-dark(#fff, #000)',
      'var(--something-else)',
      '#12345',
      '#gggggg',
      '1a1714',
    ]) {
      expect(parseTheme({ color: { accent: notHex } }).color.accent).toBe(
        DEFAULT_THEME.color.accent,
      );
    }
  });

  it('rejects a CSS length where a number belongs', () => {
    // `16px`, `1rem`, and `2vw` are all the sort of thing a well-meaning editor
    // types into a field called `space.md`.
    for (const notNumber of ['16px', '1rem', '2vw', 'clamp(1rem, 2vw, 3rem)', '1.5']) {
      expect(parseTheme({ space: { md: notNumber } }).space.md).toBe(DEFAULT_THEME.space.md);
    }
  });

  it('rejects a fluid value given as a clamp() string', () => {
    expect(parseTheme({ type: { title: 'clamp(1.75rem, 4vw, 2.5rem)' } }).type.title).toEqual(
      DEFAULT_THEME.type.title,
    );
  });
});

describe('parseTheme — numbers are bounded and finite', () => {
  it('rejects NaN and the infinities', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(parseTheme({ lineHeight: { normal: bad } }).lineHeight.normal).toBe(
        DEFAULT_THEME.lineHeight.normal,
      );
    }
  });

  it('rejects out-of-range values rather than clamping them', () => {
    // Rejecting is deliberate: a value that failed validation is a value nobody
    // has looked at, and silently clamping 10000 to 400 ships a layout no one
    // designed.
    expect(parseTheme({ space: { lg: 10_000 } }).space.lg).toBe(DEFAULT_THEME.space.lg);
    expect(parseTheme({ space: { lg: -5 } }).space.lg).toBe(DEFAULT_THEME.space.lg);
    expect(parseTheme({ lineHeight: { normal: 0 } }).lineHeight.normal).toBe(
      DEFAULT_THEME.lineHeight.normal,
    );
    expect(parseTheme({ web: { backdropOpacity: 1.5 } }).web.backdropOpacity).toBe(
      DEFAULT_THEME.web.backdropOpacity,
    );
  });

  it('accepts a legal in-range edit', () => {
    expect(parseTheme({ web: { backdropOpacity: 0 } }).web.backdropOpacity).toBe(0);
    expect(parseTheme({ space: { md: 20 } }).space.md).toBe(20);
  });
});

describe('parseTheme — fluid ranges keep clamp() legal', () => {
  it('accepts a well-formed range', () => {
    const range = { min: 20, max: 30, vwMin: 400, vwMax: 1200 };
    expect(parseTheme({ type: { title: range } }).type.title).toEqual(range);
  });

  it('rejects min > max as a unit', () => {
    // clamp(30rem, …, 20rem) is legal CSS that silently pins to 30 on every
    // screen — the failure would show up as "the heading is huge on mobile".
    expect(parseTheme({ type: { title: { min: 30, max: 20, vwMin: 400, vwMax: 1200 } } }).type.title)
      .toEqual(DEFAULT_THEME.type.title);
  });

  it('rejects a zero or inverted viewport range', () => {
    // vwMin === vwMax divides by zero in the slope, giving `Infinityvw`.
    expect(parseTheme({ type: { title: { min: 20, max: 30, vwMin: 800, vwMax: 800 } } }).type.title)
      .toEqual(DEFAULT_THEME.type.title);
    expect(parseTheme({ type: { title: { min: 20, max: 30, vwMin: 1200, vwMax: 400 } } }).type.title)
      .toEqual(DEFAULT_THEME.type.title);
  });

  it('rejects a partial range rather than filling the gaps', () => {
    expect(parseTheme({ type: { title: { min: 20 } } }).type.title).toEqual(
      DEFAULT_THEME.type.title,
    );
  });
});

describe('parseTheme — font names are allowlisted', () => {
  it('drops stack entries that could break out of font-family', () => {
    const theme = parseTheme({
      font: {
        body: {
          webStack: ['Georgia', "x'; } body { display: none } .y {", 'Iowan Old Style', 'serif'],
          ios: 'Georgia',
          android: 'serif',
        },
      },
    });
    expect(theme.font.body.webStack).toEqual(['Georgia', 'Iowan Old Style', 'serif']);
  });

  it('falls back when every stack entry is rejected', () => {
    // An empty stack is a broken edit, not a request for no fonts.
    const theme = parseTheme({
      font: { body: { webStack: ['url(evil)', '@import x'], ios: '', android: '' } },
    });
    expect(theme.font.body).toEqual(DEFAULT_THEME.font.body);
  });
});

describe('parseTheme — minClientVersion', () => {
  it('discards a document that demands a newer client, rather than half-applying it', () => {
    const theme = parseTheme(
      { minClientVersion: 99, color: { accent: '#123456' } },
      THEME_SCHEMA_VERSION,
    );
    // Not just the version — the whole document, including the accent it could
    // technically have rendered. Half a theme is what looks broken.
    expect(theme).toEqual(DEFAULT_THEME);
  });

  it('applies a document the client can render', () => {
    expect(parseTheme({ minClientVersion: 1, color: { accent: '#123456' } }, 1).color.accent).toBe(
      '#123456',
    );
  });
});

describe('emitThemeCss', () => {
  it('emits declarations only, so the caller picks the scope', () => {
    const css = emitThemeCss(DEFAULT_THEME);
    expect(css).not.toMatch(/[{}]/);
    expect(css).toContain(`--color-accent: ${DEFAULT_THEME.color.accent};`);
  });

  it('converts points to rem against a 16pt root', () => {
    // rem rather than px so a reader who has enlarged their browser's default
    // font still gets a larger site — not hypothetical on a parish site.
    expect(emitThemeCss(DEFAULT_THEME)).toContain('--space-md: 1rem;');
  });

  it('emits a constant fluid token as a bare length, not a degenerate clamp()', () => {
    const css = emitThemeCss(DEFAULT_THEME);
    expect(css).toContain('--type-body: 1.0625rem;');
    expect(css).not.toContain('clamp(1.0625rem, 1.0625rem');
  });

  it('emits a scaling token as a clamp() that hits min and max at the stated widths', () => {
    const theme = withType({ min: 16, max: 32, vwMin: 400, vwMax: 1200 });
    // Slope: 16pt over 800px = 2vw. Intercept: 16 - 2%*400 = 8pt = 0.5rem.
    // At 400px:  0.5rem + 8px  = 16px ✓   At 1200px: 0.5rem + 24px = 32px ✓
    expect(emitThemeCss(theme)).toContain('--type-title: clamp(1rem, 0.5rem + 2vw, 2rem);');
  });

  it('quotes family names with spaces and leaves keywords bare', () => {
    // Quoting `serif` would search for a font literally named "serif", which no
    // system has — so the fallback silently stops working.
    const css = emitThemeCss(DEFAULT_THEME);
    expect(css).toContain("'Iowan Old Style'");
    expect(css).toMatch(/--font-body:[^;]*\bserif;/);
    expect(css).not.toContain("'serif'");
  });

  it('emits line height unitless and letter spacing in em', () => {
    const css = emitThemeCss(DEFAULT_THEME);
    expect(css).toContain('--leading-normal: 1.5;');
    expect(css).toContain('--tracking-wide: 0.06em;');
  });

  it('round-trips every parsed theme without tripping the safety check', () => {
    // The check throws, so this asserting "does not throw" is the real test.
    expect(() => emitThemeCss(parseTheme(hostileDocument()))).not.toThrow();
    expect(emitThemeCss(parseTheme(hostileDocument()))).toEqual(emitThemeCss(DEFAULT_THEME));
  });

  it('lets no injected string reach the stylesheet', () => {
    const css = emitThemeCss(parseTheme(hostileDocument()));
    for (const trace of ['</style', 'display: none', 'url(', '@import', 'evil.example']) {
      expect(css).not.toContain(trace);
    }
  });
});

describe('resolveTheme — the non-web consumer', () => {
  const nativeOptions = { platform: 'ios' as const, viewportWidth: 390 };

  it('emits no CSS and no units — only numbers and hex', () => {
    // The contract in one assertion: if any of this were a CSS string, a React
    // Native client could not use the document and the schema would have failed
    // at its only job.
    const resolved = resolveTheme(DEFAULT_THEME, nativeOptions);

    for (const value of Object.values(resolved.fontSize)) expect(typeof value).toBe('number');
    for (const value of Object.values(resolved.space)) expect(typeof value).toBe('number');
    for (const value of Object.values(resolved.radius)) expect(typeof value).toBe('number');
    for (const value of Object.values(resolved.color)) expect(value).toMatch(/^#[0-9a-f]{3,8}$/);

    // Checked over leaf *values* rather than the serialized blob: scanning the
    // JSON for "em" also matches the `letterSpacingEm` key, which is a key name
    // and not a CSS unit. Asserting the shape of every value is the stronger
    // claim anyway — a number or a hex colour or a bare font name, nothing else.
    for (const [path, value] of leaves(resolved)) {
      if (typeof value === 'number') {
        expect(Number.isFinite(value), path).toBe(true);
        continue;
      }
      expect(typeof value, path).toBe('string');
      // Hex colour, or a font family name. Never a length, a clamp, or a var().
      expect(value as string, path).toMatch(/^(#[0-9a-f]{3,8}|[A-Za-z][A-Za-z0-9 -]*)$/);
      expect(value as string, path).not.toMatch(/\d(rem|px|vw|em)\b|clamp\(|var\(/);
    }
  });

  it('picks the platform font, not the web stack', () => {
    // RN's fontFamily takes one name; handing it the CSS stack renders nothing.
    expect(resolveTheme(DEFAULT_THEME, { ...nativeOptions, platform: 'ios' }).fontFamily.ui).toBe(
      DEFAULT_THEME.font.ui.ios,
    );
    expect(
      resolveTheme(DEFAULT_THEME, { ...nativeOptions, platform: 'android' }).fontFamily.ui,
    ).toBe(DEFAULT_THEME.font.ui.android);
  });

  it('flattens at the ends of the fluid range and interpolates between', () => {
    const range = { min: 16, max: 32, vwMin: 400, vwMax: 1200 };
    expect(resolveFluid(range, 320)).toBe(16); // narrower than vwMin
    expect(resolveFluid(range, 400)).toBe(16);
    expect(resolveFluid(range, 800)).toBe(24); // midpoint
    expect(resolveFluid(range, 1200)).toBe(32);
    expect(resolveFluid(range, 2000)).toBe(32); // wider than vwMax
  });

  it('converts em tracking to points against a font size', () => {
    expect(letterSpacingPoints(0.06, 20)).toBeCloseTo(1.2);
    expect(letterSpacingPoints(-0.02, 40)).toBeCloseTo(-0.8);
  });
});

describe('the web and native resolvers agree', () => {
  /**
   * The test this whole file exists for.
   *
   * One document has to produce the same design on both platforms. The web gets
   * a CSS `clamp()`; native gets a number from `resolveFluid`. Nothing but a
   * test stops those two drifting — and a drift would show up as "the app's
   * headings are subtly the wrong size", which nobody files a bug about.
   *
   * So: evaluate the emitted CSS the way a browser would, and hold it to the
   * number the native resolver computed.
   */
  const widths = [320, 380, 500, 700, 900, 1280, 1600];

  /**
   * A hundredth of a point.
   *
   * Not an arbitrary fudge: `emitThemeCss` rounds to four decimals so the
   * generated sheet is legible to whoever inspects an element, which makes the
   * clamp's slope and intercept very slightly lossy. The measured disagreement
   * is about 0.001pt — a thousandth of a pixel. This bound is tight enough that
   * any *real* divergence in the two formulas fails the test, and loose enough
   * that the rounding does not.
   */
  const TOLERANCE_POINTS = 0.01;

  it.each(widths)('matches at %ipx for every type role', (width) => {
    const css = emitThemeCss(DEFAULT_THEME);
    const resolved = resolveTheme(DEFAULT_THEME, { platform: 'ios', viewportWidth: width });

    for (const role of Object.keys(DEFAULT_THEME.type) as (keyof typeof DEFAULT_THEME.type)[]) {
      const web = evaluateCssLength(declarationOf(css, `--type-${role}`), width);
      expect(Math.abs(web - resolved.fontSize[role])).toBeLessThan(TOLERANCE_POINTS);
    }
  });

  it('matches for the fluid spacing tokens too', () => {
    const css = emitThemeCss(DEFAULT_THEME);
    for (const width of widths) {
      const resolved = resolveTheme(DEFAULT_THEME, { platform: 'android', viewportWidth: width });
      for (const token of ['section', 'gutter'] as const) {
        const web = evaluateCssLength(declarationOf(css, `--space-${token}`), width);
        expect(Math.abs(web - resolved.space[token])).toBeLessThan(TOLERANCE_POINTS);
      }
    }
  });
});

/** Every leaf value in a nested object, with a dotted path for the failure message. */
function leaves(value: unknown, path = ''): [string, unknown][] {
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) =>
      leaves(child, path ? `${path}.${key}` : key),
    );
  }
  return [[path, value]];
}

/** Pull one custom property's value out of the emitted sheet. */
function declarationOf(css: string, name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`${name} was not emitted`);
  return match[1]!.trim();
}

/**
 * Evaluate an emitted length in points, as a browser at `viewportWidth` would.
 *
 * Handles the only two forms the emitter produces: a bare `<n>rem`, and
 * `clamp(<a>rem, <b>rem + <c>vw, <d>rem)`.
 */
function evaluateCssLength(value: string, viewportWidth: number): number {
  const rem = (n: string) => Number.parseFloat(n) * 16;

  const bare = value.match(/^([\d.]+)rem$/);
  if (bare) return rem(bare[1]!);

  const clamp = value.match(
    /^clamp\(\s*([\d.]+)rem\s*,\s*(-?[\d.]+)rem \+ (-?[\d.]+)vw\s*,\s*([\d.]+)rem\s*\)$/,
  );
  if (!clamp) throw new Error(`unrecognised emitted length: ${value}`);

  const [, min, intercept, slopeVw, max] = clamp;
  const preferred = rem(intercept!) + (Number.parseFloat(slopeVw!) / 100) * viewportWidth;
  return Math.min(Math.max(preferred, rem(min!)), rem(max!));
}

describe('isSafeThemeCss — the localStorage cache is not trusted', () => {
  /**
   * The theme is cached as CSS and reinjected before first paint by a boot
   * script, to stop a returning visitor seeing a flash of the fallback palette.
   * That cache lives in `localStorage`, which **any script on the origin can
   * write to** — so the string coming back is untrusted input even though this
   * code is what put it there.
   */
  it('accepts what emitThemeCss actually produces', () => {
    expect(isSafeThemeCss(emitThemeCss(DEFAULT_THEME))).toBe(true);
    // Including the awkward real cases: quoted font names with spaces, a
    // clamp() with a signed intercept, and a bare unitless ratio.
    expect(isSafeThemeCss("  --font-body: ui-serif, Georgia, 'Iowan Old Style', serif;")).toBe(true);
    expect(isSafeThemeCss('--type-title: clamp(1.75rem, 1.38rem + 1.55vw, 2.62rem);')).toBe(true);
    expect(isSafeThemeCss('--leading-normal: 1.5;')).toBe(true);
  });

  it('rejects a poisoned cache', () => {
    for (const poisoned of [
      '--x: red; } body { display: none } .y {',
      '--x: url(https://evil.example/pixel.gif);',
      '@import "https://evil.example/all.css";',
      '--x: red;</style><script>alert(1)</script>',
      '--x: expression(alert(1));',
      '--x: javascript:alert(1);',
      '--x: red; /* hide the rest */',
      'body { display: none }',
      '--x: red',
    ]) {
      expect(isSafeThemeCss(poisoned), poisoned).toBe(false);
    }
  });

  it('rejects non-strings, the empty string, and absurd lengths', () => {
    for (const bad of [null, undefined, 42, {}, [], '']) {
      expect(isSafeThemeCss(bad)).toBe(false);
    }
    expect(isSafeThemeCss(`--x: red;\n`.repeat(3000))).toBe(false);
  });
});

describe('decodeFirestoreFields — the browser reads the document over REST', () => {
  it('decodes the shapes config/theme actually contains', () => {
    const decoded = decodeFirestoreFields({
      version: { integerValue: '1' },
      backdropOpacity: { doubleValue: 0.14 },
      enabled: { booleanValue: true },
      accent: { stringValue: '#8c2f26' },
      missing: { nullValue: null },
      color: { mapValue: { fields: { ink: { stringValue: '#1a1714' } } } },
      webStack: { arrayValue: { values: [{ stringValue: 'Georgia' }, { stringValue: 'serif' }] } },
    });

    expect(decoded).toEqual({
      version: 1,
      backdropOpacity: 0.14,
      enabled: true,
      accent: '#8c2f26',
      missing: null,
      color: { ink: '#1a1714' },
      webStack: ['Georgia', 'serif'],
    });
  });

  it('survives an empty map and an empty array', () => {
    // Firestore omits `fields` and `values` entirely when they are empty, which
    // is the shape most likely to throw on a naive decoder.
    expect(decodeFirestoreFields({ m: { mapValue: {} }, a: { arrayValue: {} } })).toEqual({
      m: {},
      a: [],
    });
  });

  it('round-trips a real theme document through the decoder and parser', () => {
    // The actual browser path: REST envelope -> decode -> parse -> tokens.
    const encoded = {
      color: { mapValue: { fields: { accent: { stringValue: '#123456' } } } },
      space: { mapValue: { fields: { md: { integerValue: '20' } } } },
    };
    const theme = parseTheme(decodeFirestoreFields(encoded));
    expect(theme.color.accent).toBe('#123456');
    expect(theme.space.md).toBe(20);
    expect(theme.color.ink).toBe(DEFAULT_THEME.color.ink);
  });

  it('returns null for an unknown wrapper rather than the raw envelope', () => {
    // Handing back `{geoPointValue:…}` is how "[object Object]" reaches a page.
    expect(decodeFirestoreValue({ geoPointValue: { latitude: 1, longitude: 2 } })).toBeNull();
  });
});

describe('publicDocumentUrl', () => {
  it('builds a URL against the (default) database with the key as a query param', () => {
    expect(publicDocumentUrl('spsm-database', 'config/theme', 'AIzaKEY')).toBe(
      'https://firestore.googleapis.com/v1/projects/spsm-database' +
        '/databases/(default)/documents/config/theme?key=AIzaKEY',
    );
  });

  it('encodes each path segment without encoding the separators', () => {
    // A slash in the path is structure, not data — encoding it would address a
    // document whose id literally contains "/", which cannot exist.
    expect(publicDocumentUrl('p', 'config/a b', 'k')).toContain('/documents/config/a%20b?key=k');
  });
});

/** Every field a defacement attempt would reach for, in one document. */
function hostileDocument() {
  return {
    color: {
      ink: '#fff; } html { background: url(https://evil.example/x) } .z {',
      accent: '</style><script>alert(1)</script>',
      paper: 'url(https://evil.example/pixel.gif)',
      deep: '@import "https://evil.example/all.css"',
    },
    font: {
      ui: { webStack: ['x</style><script>y'], ios: 'a;b', android: 'c}d' },
    },
    space: { md: '16px} body { display: none }' },
    web: {
      shadowMd: {
        x: '0px',
        y: '0px',
        blur: '99px',
        spread: '0',
        color: 'red; } * { display: none',
      },
    },
  };
}

function withType(title: ThemeTokens['type']['title']): ThemeTokens {
  return { ...DEFAULT_THEME, type: { ...DEFAULT_THEME.type, title } };
}
