/**
 * Design tokens, stored in Firestore so the parish's look is data rather than
 * code — and stored in a shape the mobile app can read too.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE: store design intent as unitless numbers. Never a CSS string.
 *
 * `clamp(1.75rem, 4vw, 2.5rem)` is a web-only artifact. `{ min: 28, max: 40,
 * vwMin: 700, vwMax: 1000 }` is the same intent, and both a CSS emitter and a
 * React Native resolver can consume it. Part 2 of this program is a native app
 * reading these same documents; a document full of ready-made CSS works
 * perfectly here and makes that app impossible, which nobody discovers until
 * part 2 starts.
 *
 * The unit of storage is the **design point** = 1 CSS px = 1 RN
 * density-independent point.
 * ---------------------------------------------------------------------------
 *
 * Cross-platform bridges, each chosen because the two platforms disagree:
 *
 *   - line height is a unitless **ratio**. RN's `lineHeight` is absolute points;
 *     a ratio multiplied by the font size works on both.
 *   - letter spacing is in **em**. RN's is in points, so it needs the font size
 *     to resolve — em carries the intent without it.
 *   - font family is `{ webStack, ios, android }`. CSS wants a fallback stack,
 *     RN takes exactly one name.
 *   - colours are **hex only**. RN parses hex, rgba, and named colours and
 *     nothing else — no `oklch()`, no `color-mix()`, no `light-dark()`.
 *
 * Anything with no native analogue goes under `web` rather than being faked, so
 * a native resolver can ignore that key wholesale instead of half-applying it.
 *
 * ---------------------------------------------------------------------------
 * TOKENS ARE ADDITIVE-ONLY
 *
 * Once a mobile binary ships it reads whatever this document says forever. An
 * old app meeting a removed or retyped token half-applies it and looks broken,
 * with no hotfix short of an App Store review. So: deprecated tokens keep being
 * written, and `minClientVersion` lets a document declare "older clients should
 * discard me entirely and use their bundled defaults."
 * ---------------------------------------------------------------------------
 */

/** Document id of the theme document, within the `config` collection. */
export const CONFIG_DOC_THEME = 'theme';

/**
 * Schema version of the token set below. Bump when tokens are *added* (which is
 * the only change allowed) so a client can tell what it is looking at.
 */
export const THEME_SCHEMA_VERSION = 1;

/**
 * Root font size, in design points. The bridge between stored points and the
 * `rem` the emitted CSS uses.
 *
 * Emitting `rem` rather than `px` is deliberate: it keeps the site honouring a
 * reader who has set a larger default font size in their browser, which on a
 * parish site — where a good share of visitors are over seventy — is not a
 * hypothetical.
 */
const ROOT_FONT_SIZE = 16;

/**
 * A value that scales with the viewport: `min` points at `vwMin` points wide,
 * `max` at `vwMax`, interpolated between.
 *
 * `min === max` is legal and means "constant", which is how a token opts out of
 * scaling without needing a second representation.
 */
export interface FluidValue {
  min: number;
  max: number;
  vwMin: number;
  vwMax: number;
}

/**
 * One typeface, expressed for three platforms.
 *
 * `webStack` is ordered most- to least-preferred and may name generic families
 * (`serif`, `system-ui`). `ios` and `android` take a single family name each,
 * because that is all RN's `fontFamily` accepts.
 */
export interface FontFamilyToken {
  webStack: string[];
  ios: string;
  android: string;
}

/**
 * Colours. Hex only — see the header.
 *
 * The names describe *role*, not appearance, so a future dark palette can
 * change every value without any consumer changing. `paper` is a background and
 * `ink` is a foreground even if a night theme makes paper nearly black.
 */
export interface ThemeColors {
  /** Body text, and the darkest thing on the page. */
  ink: string;
  /** Secondary prose — ledes, card bodies. Must still pass AA on `paper`. */
  inkSoft: string;
  /** Metadata, timestamps, labels. Large or uppercase only. */
  inkFaint: string;
  /** Text on top of `deep` or `accent`. */
  inkInverse: string;

  /** Page background. */
  paper: string;
  /** Cards, the masthead, anything lifted off the page. */
  paperRaised: string;
  /** Alternating bands that group sections without drawing a box. */
  paperSunken: string;
  /** Hairlines and card borders. */
  rule: string;

  /** Liturgical red. Links, primary buttons, the current nav item. */
  accent: string;
  /** Hover and active states for anything `accent`. */
  accentStrong: string;
  /** Tinted fills — inline code, admin bars, quiet highlights. */
  accentSoft: string;

  /** Iconographic gold. Ornament and pinned markers, never body text. */
  gold: string;
  /** Gold at fill strength. */
  goldSoft: string;

  /** Dark ground for the hero and footer. */
  deep: string;

  /*
   * The sanctuary blues, added 2026-08-13.
   *
   * Taken off the parish's own murals — the iconostasis at Wayland is painted
   * against a deep blue sky and water, and it is the dominant colour in the
   * homepage photograph. The palette before this was cream, oxblood and gold
   * only, which read as parchment: dignified and, by itself, drab. This is the
   * colour the church actually is.
   *
   * Added rather than substituted, per the additive-only rule at the top of this
   * file: a shipped mobile build that has never heard of `azure` falls back
   * per-field and still renders.
   */
  /** Mid blue for icons, quiet emphasis, and links on dark grounds. */
  azure: string;
  /** Tinted fill — icon backgrounds, quiet highlights. */
  azureSoft: string;
  /** Deep blue ground, for a dark band that is not the near-black `deep`. */
  azureDeep: string;
}

/**
 * The type scale. Every entry is fluid; constants set `min === max`.
 *
 * Roles rather than sizes (`display`, not `xxl`) so that deciding a page title
 * should be smaller is one edit here instead of a rename everywhere.
 */
export interface ThemeTypeScale {
  /** The homepage hero. The largest type on the site. */
  display: FluidValue;
  /** Page `h1`. */
  title: FluidValue;
  /** Section `h2`. */
  heading: FluidValue;
  /** Card `h3`. */
  subheading: FluidValue;
  /** The opening paragraph of a page. */
  lede: FluidValue;
  /** Body copy. */
  body: FluidValue;
  /** Card bodies, form fields, nav. */
  small: FluidValue;
  /** Uppercase labels and timestamps. */
  micro: FluidValue;
}

/** Unitless ratios, multiplied by the font size on both platforms. */
export interface ThemeLineHeights {
  /** Display and titles, where the leading should be tight. */
  tight: number;
  /** Headings. */
  snug: number;
  /** Body prose. */
  normal: number;
  /** Long-form reading. */
  relaxed: number;
}

/** In em, so it resolves against whatever font size it lands on. */
export interface ThemeLetterSpacing {
  /** Large display type, which needs pulling in. */
  tight: number;
  normal: number;
  /** Uppercase labels, which need opening up. */
  wide: number;
}

/**
 * Spacing, in design points.
 *
 * A fixed named scale rather than a multiplier function: RN has no `calc()`, so
 * a consumer cannot derive `space.md * 1.5` at style time without shipping the
 * arithmetic. Naming every step keeps both platforms reading the same value.
 */
export interface ThemeSpace {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
  /** Vertical rhythm between top-level page sections. Fluid. */
  section: FluidValue;
  /** Page side padding. Fluid — a phone should not waste 32pt on each edge. */
  gutter: FluidValue;
}

export interface ThemeRadius {
  /** Inputs and buttons. */
  sm: number;
  /** Cards. */
  md: number;
  /** Hero panels and images. */
  lg: number;
  /** Pills and avatars. Clamped by the consumer, not stored as 9999. */
  full: number;
}

/**
 * Web-only tokens.
 *
 * These have no React Native analogue, or a different enough one that faking it
 * would be worse than omitting it. A native resolver ignores this whole object.
 */
export interface ThemeWeb {
  /** Reading measure, in `ch`. Depends on the rendered font; meaningless in RN. */
  measureCh: number;
  /** Max width of the page shell, in design points. */
  shellWidth: number;
  /**
   * Opacity applied to background photographs, 0–1.
   *
   * Load-bearing for more than looks: the parish's only architectural
   * photographs are of other churches, so they are only usable dimmed far
   * enough to read as texture. See assets/README.md.
   */
  backdropOpacity: number;
  /** Shadow tokens, as CSS `box-shadow` is not RN's `shadowOffset` family. */
  shadowSm: ThemeShadow;
  shadowMd: ThemeShadow;
  shadowLg: ThemeShadow;
}

/**
 * Structured rather than a CSS string, for the same reason as everything else
 * here — and so the colour goes through the same hex validation.
 */
export interface ThemeShadow {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

export interface ThemeTokens {
  /** `THEME_SCHEMA_VERSION` as written. Informational. */
  version: number;
  /**
   * Clients older than this discard the document wholesale and use their
   * bundled defaults. The escape hatch for a document that a shipped binary
   * cannot render — raise it only when that is genuinely true, because every
   * raise strands users on old builds with a stale look.
   */
  minClientVersion: number;
  color: ThemeColors;
  font: {
    /** Prose. */
    body: FontFamilyToken;
    /** Navigation, labels, buttons — anything that is interface, not reading. */
    ui: FontFamilyToken;
    /** The hero and page titles. May be the same as `ui`. */
    display: FontFamilyToken;
  };
  type: ThemeTypeScale;
  lineHeight: ThemeLineHeights;
  letterSpacing: ThemeLetterSpacing;
  space: ThemeSpace;
  radius: ThemeRadius;
  web: ThemeWeb;
}

/**
 * The committed theme. Shipped in the bundle and used whenever `config/theme`
 * is missing, unreadable, or too new for this client.
 *
 * These values are the design itself, not a placeholder: the site must look
 * correct with no Firestore read at all, because the alternative is a parish
 * website that renders unstyled when a settings document is deleted.
 */
export const DEFAULT_THEME: ThemeTokens = {
  version: THEME_SCHEMA_VERSION,
  minClientVersion: 1,

  color: {
    ink: '#1c1614',
    inkSoft: '#4b413e',
    /*
     * Darkened from #7c746a while the ramp was being re-hued, because the old
     * value never passed: 4.31:1 on `paper` and 3.95:1 on `paperSunken`, both
     * short of 4.5, and this is the colour of every date line and caption on
     * the site. This one clears 4.5 against `paper`, `paperRaised`,
     * `paperSunken`, and `accentSoft` alike.
     */
    inkFaint: '#6f5f5a',
    inkInverse: '#f9efec',

    /*
     * The neutrals are not neutral. They sit on the accent's own hue with real
     * saturation, so that every surface on the site is a pale red rather than a
     * white one.
     *
     * This ramp was a yellow cream (#faf7f2) over pure white (#ffffff), and
     * pure white was the problem: it is the background of every card and both
     * nav panels, which is most of the site by area. A red accent on a white
     * page reads as a red *detail*. The same accent on a blush page reads as
     * the page's colour.
     *
     * A first pass at #f9f0ec/#fffaf8 was too timid to see — `paperRaised` in
     * particular was white by any honest reading. These are roughly three times
     * the chroma. The ceiling is contrast, not taste: these surfaces hold body
     * text, so the saturation can go as far as keeps `inkFaint` — the lightest
     * text in the system — above 4.5:1 on all of them. It measures 5.08 on
     * `paper` and 4.61 on `paperSunken` here, so there is very little headroom
     * left. Deepen further and the captions have to darken with it.
     */
    paper: '#f6e8e3',
    paperRaised: '#fdf7f4',
    paperSunken: '#eeddd7',
    rule: '#e0cac3',

    /*
     * Liturgical red and gold.
     *
     * Settled at about 80% saturation, after overshooting in both directions.
     * At #8c2f26 / #6f231c (~70%) the pair read as maroon or brick rather than
     * as red; at #a3231a / #7d150f (~85%) it was red but loud, closer to a
     * warning colour than to vestments. The hue never moved through any of it —
     * only how much grey is in it.
     */
    accent: '#992a21',
    accentStrong: '#731d16',
    /*
     * Has to out-chroma `paperSunken`, not just out-lighten it. These two are
     * within 2% of the same luminance by design — `accentSoft` is what marks a
     * thing as *accented* on a sunken band, and if it differs only in lightness
     * the two read as a rendering artefact. The separation is hue.
     */
    accentSoft: '#f6d8d0',

    // Brightened from #9a7b3f. At the old value the gold ornament and the
    // section eyebrows read as brown against cream rather than as gold.
    gold: '#b08d43',
    goldSoft: '#f4ead2',

    /*
     * Dark red. This backs the masthead, the footer, and the closing band —
     * together the largest solid colour on the site, and the first thing seen on
     * every page.
     *
     * Three revisions, all worth recording. It was #1d2230, a near-black navy
     * chosen to echo the blue of the murals in the hero photograph; that held
     * for the homepage and nowhere else, since the footer is on every page and
     * the photograph is on one. Then #3a1512, the right hue but only 69%
     * saturated — grey enough to read as maroon or brown rather than red. Then
     * #4f0c0c at 85%, which was red and too vivid for a surface this large.
     *
     * This is 78%. The ceiling is not taste: `gold` is the chrome's second
     * colour — the subtitle, the current nav item, the focus ring — and needs
     * 4.5:1, which it clears here at 4.96. Anything brighter than about #4f0c0c
     * and the gold has to go with it.
     */
    deep: '#481010',

    /*
     * The sanctuary blue. Nothing on the website uses these any more — the fact
     * tiles that did now run red/dark-red/gold, and the closing band's gradient
     * is two reds.
     *
     * Kept in the schema rather than deleted: removing a token is a breaking
     * change for the mobile app, which reads the same document, and blue is
     * genuinely in the murals if a future surface wants it. Anything reaching
     * for these on the website should expect to justify a cool colour on a red
     * site.
     */
    azure: '#2f5d8a',
    azureSoft: '#e9eff6',
    azureDeep: '#16304d',
  },

  font: {
    /*
     * One real serif, and the system sans for chrome.
     *
     * This used to be system fonts throughout, on the grounds that a parish
     * site is read on old Android phones over church-hall wifi and 200KB of
     * webfont to render the word "Welcome" is a poor trade. That trade was
     * priced honestly and it has changed: the latin subset of EB Garamond is
     * 23KB for the regular, 108KB for all four faces, and only the regular is
     * on the critical path. What the old answer actually bought was a parish
     * whose typeface was "whatever Georgia is on this device" — a different
     * face on Android, on Windows, and in the app, which is the same drift
     * this file exists to prevent, just in type instead of colour.
     *
     * `ui` stays on the system sans deliberately. The reader's own OS sans is
     * the one face that never looks borrowed in a tab bar, it costs nothing,
     * and it is what keeps the serif meaning "this is the church's voice"
     * rather than "this is all text".
     *
     * Georgia and the generic `serif` stay in the stack behind EB Garamond,
     * so a reader who blocks webfonts lands exactly where this theme used to.
     *
     * The native names are not free-form. On iOS `fontFamily` resolves the
     * family name stored *inside* the file, and Google's static EB Garamond
     * puts only Regular, Italic, Bold and Bold Italic under `EB Garamond`;
     * SemiBold and friends each get their own family. On Android the name is
     * whatever the embedded XML family declares. Both platforms are wired to
     * answer to `EB Garamond` with those four faces — see the `expo-font`
     * block in SPSM-Connect's app.config.ts, which is the other half of this
     * and must ship before this name does.
     */
    body: {
      webStack: [
        'EB Garamond',
        'ui-serif',
        'Georgia',
        'Iowan Old Style',
        'Times New Roman',
        'serif',
      ],
      ios: 'EB Garamond',
      android: 'EB Garamond',
    },
    ui: {
      webStack: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      ios: 'System',
      android: 'sans-serif',
    },
    display: {
      webStack: [
        'EB Garamond',
        'ui-serif',
        'Georgia',
        'Iowan Old Style',
        'Times New Roman',
        'serif',
      ],
      ios: 'EB Garamond',
      android: 'EB Garamond',
    },
  },

  // vwMin 380 / vwMax 1280: the narrowest phone still sold, to the width the
  // shell stops growing at. Scaling past the point the layout stops changing
  // just makes type big on a desktop nobody asked to zoom.
  type: {
    display: { min: 34, max: 60, vwMin: 380, vwMax: 1280 },
    title: { min: 28, max: 42, vwMin: 380, vwMax: 1280 },
    heading: { min: 21, max: 27, vwMin: 380, vwMax: 1280 },
    subheading: { min: 17, max: 19, vwMin: 380, vwMax: 1280 },
    lede: { min: 18, max: 21, vwMin: 380, vwMax: 1280 },
    body: { min: 17, max: 17, vwMin: 380, vwMax: 1280 },
    small: { min: 15, max: 15, vwMin: 380, vwMax: 1280 },
    micro: { min: 13, max: 13, vwMin: 380, vwMax: 1280 },
  },

  lineHeight: {
    tight: 1.1,
    snug: 1.25,
    normal: 1.5,
    relaxed: 1.65,
  },

  letterSpacing: {
    tight: -0.02,
    normal: 0,
    wide: 0.06,
  },

  space: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 40,
    xxl: 64,
    section: { min: 44, max: 76, vwMin: 380, vwMax: 1280 },
    gutter: { min: 18, max: 40, vwMin: 380, vwMax: 1280 },
  },

  radius: {
    sm: 4,
    md: 8,
    lg: 16,
    full: 999,
  },

  web: {
    measureCh: 68,
    /**
     * 1280, raised from 1152 when "Home" became the eleventh nav item.
     *
     * The masthead shares this shell, and eleven links plus the wordmark need
     * about 1117pt of it. At 1152 the content box after gutters was 1072 — so
     * the inline nav could not fit at *any* viewport width, and the wordmark
     * silently wrapped to two lines instead. This is the number that decides
     * whether the header works, not just how wide the text column is.
     */
    shellWidth: 1280,
    backdropOpacity: 0.14,
    // Warm-tinted rather than neutral black: a grey shadow over a cream page
    // reads as dirt. Alpha is in the hex, which RN would also accept if these
    // ever moved out of `web`.
    shadowSm: { x: 0, y: 1, blur: 2, spread: 0, color: '#1c161412' },
    shadowMd: { x: 0, y: 4, blur: 16, spread: -2, color: '#1c16141a' },
    shadowLg: { x: 0, y: 18, blur: 48, spread: -12, color: '#1c161426' },
  },
};

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Coerce a Firestore document into usable tokens.
 *
 * **This is a sanitizer, not just a coercer, and the distinction is the whole
 * point of the function.** Its output is interpolated into a `<style>` element
 * on every page of the site, so a compromised admin account writing
 * `color.ink` = `red; } body { display: none } ...` would otherwise be a
 * defacement vector — or worse, given what a `<style>` element can do with
 * attribute selectors and `background-image: url()`.
 *
 * The defence is not escaping. It is that **no string from the document ever
 * reaches the output**: colours must match a hex regex, numbers are coerced and
 * bounded, font names must match an allowlist, and everything is re-emitted
 * from typed values. A field that fails validation falls back to
 * `DEFAULT_THEME` rather than being cleaned up and used, because a value that
 * failed validation is a value nobody has looked at.
 *
 * Every field falls back independently: one bad hand-edit in the console must
 * not discard the rest of the theme.
 *
 * @param clientVersion what this client can render. A document demanding more
 *   is discarded wholesale — see `minClientVersion`.
 */
export function parseTheme(raw: unknown, clientVersion = THEME_SCHEMA_VERSION): ThemeTokens {
  const doc = asRecord(raw);
  const fallback = DEFAULT_THEME;

  // Checked before anything else is read. The point of the field is that a
  // client which cannot render the document does not try to partially apply it.
  const minClientVersion = num(doc?.['minClientVersion'], 1, 1_000, fallback.minClientVersion);
  if (minClientVersion > clientVersion) return fallback;

  const color = asRecord(doc?.['color']);
  const font = asRecord(doc?.['font']);
  const type = asRecord(doc?.['type']);
  const lineHeight = asRecord(doc?.['lineHeight']);
  const letterSpacing = asRecord(doc?.['letterSpacing']);
  const space = asRecord(doc?.['space']);
  const radius = asRecord(doc?.['radius']);
  const web = asRecord(doc?.['web']);
  const shadows = fallback.web;

  return {
    version: num(doc?.['version'], 1, 1_000, fallback.version),
    minClientVersion,

    color: {
      ink: hex(color?.['ink'], fallback.color.ink),
      inkSoft: hex(color?.['inkSoft'], fallback.color.inkSoft),
      inkFaint: hex(color?.['inkFaint'], fallback.color.inkFaint),
      inkInverse: hex(color?.['inkInverse'], fallback.color.inkInverse),
      paper: hex(color?.['paper'], fallback.color.paper),
      paperRaised: hex(color?.['paperRaised'], fallback.color.paperRaised),
      paperSunken: hex(color?.['paperSunken'], fallback.color.paperSunken),
      rule: hex(color?.['rule'], fallback.color.rule),
      accent: hex(color?.['accent'], fallback.color.accent),
      accentStrong: hex(color?.['accentStrong'], fallback.color.accentStrong),
      accentSoft: hex(color?.['accentSoft'], fallback.color.accentSoft),
      gold: hex(color?.['gold'], fallback.color.gold),
      goldSoft: hex(color?.['goldSoft'], fallback.color.goldSoft),
      deep: hex(color?.['deep'], fallback.color.deep),
      azure: hex(color?.['azure'], fallback.color.azure),
      azureSoft: hex(color?.['azureSoft'], fallback.color.azureSoft),
      azureDeep: hex(color?.['azureDeep'], fallback.color.azureDeep),
    },

    font: {
      body: fontFamily(font?.['body'], fallback.font.body),
      ui: fontFamily(font?.['ui'], fallback.font.ui),
      display: fontFamily(font?.['display'], fallback.font.display),
    },

    type: {
      display: fluid(type?.['display'], fallback.type.display),
      title: fluid(type?.['title'], fallback.type.title),
      heading: fluid(type?.['heading'], fallback.type.heading),
      subheading: fluid(type?.['subheading'], fallback.type.subheading),
      lede: fluid(type?.['lede'], fallback.type.lede),
      body: fluid(type?.['body'], fallback.type.body),
      small: fluid(type?.['small'], fallback.type.small),
      micro: fluid(type?.['micro'], fallback.type.micro),
    },

    // Bounds are deliberately generous but finite. 0.5 is unreadable and 4 is
    // absurd; both are survivable, whereas 0 collapses every line onto one and
    // 1e6 makes the page a mile tall with no way for staff to see why.
    lineHeight: {
      tight: num(lineHeight?.['tight'], 0.5, 4, fallback.lineHeight.tight),
      snug: num(lineHeight?.['snug'], 0.5, 4, fallback.lineHeight.snug),
      normal: num(lineHeight?.['normal'], 0.5, 4, fallback.lineHeight.normal),
      relaxed: num(lineHeight?.['relaxed'], 0.5, 4, fallback.lineHeight.relaxed),
    },

    letterSpacing: {
      tight: num(letterSpacing?.['tight'], -0.25, 1, fallback.letterSpacing.tight),
      normal: num(letterSpacing?.['normal'], -0.25, 1, fallback.letterSpacing.normal),
      wide: num(letterSpacing?.['wide'], -0.25, 1, fallback.letterSpacing.wide),
    },

    space: {
      xs: num(space?.['xs'], 0, 400, fallback.space.xs),
      sm: num(space?.['sm'], 0, 400, fallback.space.sm),
      md: num(space?.['md'], 0, 400, fallback.space.md),
      lg: num(space?.['lg'], 0, 400, fallback.space.lg),
      xl: num(space?.['xl'], 0, 400, fallback.space.xl),
      xxl: num(space?.['xxl'], 0, 400, fallback.space.xxl),
      section: fluid(space?.['section'], fallback.space.section),
      gutter: fluid(space?.['gutter'], fallback.space.gutter),
    },

    radius: {
      sm: num(radius?.['sm'], 0, 999, fallback.radius.sm),
      md: num(radius?.['md'], 0, 999, fallback.radius.md),
      lg: num(radius?.['lg'], 0, 999, fallback.radius.lg),
      full: num(radius?.['full'], 0, 9_999, fallback.radius.full),
    },

    web: {
      measureCh: num(web?.['measureCh'], 20, 200, fallback.web.measureCh),
      shellWidth: num(web?.['shellWidth'], 320, 3_000, fallback.web.shellWidth),
      backdropOpacity: num(web?.['backdropOpacity'], 0, 1, fallback.web.backdropOpacity),
      shadowSm: shadow(web?.['shadowSm'], shadows.shadowSm),
      shadowMd: shadow(web?.['shadowMd'], shadows.shadowMd),
      shadowLg: shadow(web?.['shadowLg'], shadows.shadowLg),
    },
  };
}

/** `#abc`, `#aabbcc`, or `#aabbccdd`. Nothing else — see `parseTheme`. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * The reason `oklch()` and `color-mix()` are unavailable to this theme even
 * though every target browser supports them: React Native's colour parser does
 * not, so a token using one would render on the website and crash or silently
 * blank in the app. Convert to hex before storing.
 */
function hex(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return HEX.test(trimmed) ? trimmed.toLowerCase() : fallback;
}

/**
 * Letters, digits, spaces, and hyphens.
 *
 * Excludes the quote, comma, semicolon, backslash, and parenthesis that a CSS
 * injection through a font stack needs — `font-family` is one of the few
 * properties whose value is an arbitrary author string, which makes it the
 * obvious place to try. Leading `-` is allowed for `-apple-system`.
 */
const FONT_NAME = /^-?[a-z0-9]+(?:[ -][a-z0-9]+)*$/i;

function fontFamily(value: unknown, fallback: FontFamilyToken): FontFamilyToken {
  const record = asRecord(value);
  if (!record) return fallback;

  const stack = Array.isArray(record['webStack'])
    ? record['webStack'].filter(
        (name): name is string => typeof name === 'string' && FONT_NAME.test(name.trim()),
      )
    : [];

  return {
    // An empty stack after filtering means every entry was rejected, which is a
    // broken edit rather than a request for no fonts.
    webStack: stack.length > 0 ? stack.map((name) => name.trim()) : fallback.webStack,
    ios: fontName(record['ios'], fallback.ios),
    android: fontName(record['android'], fallback.android),
  };
}

function fontName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return FONT_NAME.test(trimmed) ? trimmed : fallback;
}

/**
 * Bounded, finite, and never `NaN`.
 *
 * Firestore stores every number as a double, so an integer field can come back
 * as `3.0000000000000004` after a console edit — hence rounding at emit rather
 * than insisting on integers here.
 */
function num(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < min || value > max) return fallback;
  return value;
}

/**
 * A fluid value, with the ordering invariants CSS `clamp()` needs.
 *
 * `min > max` produces a `clamp()` that silently pins to `min` on every screen,
 * and `vwMin >= vwMax` divides by zero to produce `Infinity`. Both are rejected
 * as a unit rather than field by field, because half of a broken range is not
 * better than none of it.
 */
function fluid(value: unknown, fallback: FluidValue): FluidValue {
  const record = asRecord(value);
  if (!record) return fallback;

  const min = num(record['min'], 0, 400, NaN);
  const max = num(record['max'], 0, 400, NaN);
  const vwMin = num(record['vwMin'], 200, 4_000, NaN);
  const vwMax = num(record['vwMax'], 200, 4_000, NaN);

  if (Number.isNaN(min) || Number.isNaN(max) || Number.isNaN(vwMin) || Number.isNaN(vwMax)) {
    return fallback;
  }
  if (min > max || vwMin >= vwMax) return fallback;

  return { min, max, vwMin, vwMax };
}

function shadow(value: unknown, fallback: ThemeShadow): ThemeShadow {
  const record = asRecord(value);
  if (!record) return fallback;
  return {
    x: num(record['x'], -200, 200, fallback.x),
    y: num(record['y'], -200, 200, fallback.y),
    blur: num(record['blur'], 0, 400, fallback.blur),
    spread: num(record['spread'], -200, 200, fallback.spread),
    color: hex(record['color'], fallback.color),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/* -------------------------------------------------------------------------- */
/* Platform-neutral resolution — the non-web consumer                          */
/* -------------------------------------------------------------------------- */

/**
 * The tokens, resolved to plain numbers and hex strings for one platform and one
 * screen width. No units, no CSS, no `clamp()` — every value is directly
 * assignable to a React Native style, a SwiftUI modifier, or a Compose
 * `TextStyle`.
 *
 * This is the other half of the contract `emitThemeCss` implements for the web,
 * and the reason the stored tokens are unitless numbers in the first place. If
 * this function could not exist, the schema would have failed at its one job.
 */
export interface ResolvedTheme {
  /** Hex, exactly as stored — every platform parses hex. */
  color: ThemeColors;
  /** One family name per role, chosen for the platform asked for. */
  fontFamily: { body: string; ui: string; display: string };
  /** Resolved for the given width, in points. */
  fontSize: Record<keyof ThemeTypeScale, number>;
  /**
   * Unitless multipliers, unchanged.
   *
   * React Native's `lineHeight` is **absolute points**, so a consumer must
   * multiply: `lineHeight: fontSize.body * lineHeight.normal`. Doing that
   * multiplication here would mean picking a font size per role and is the
   * caller's business, not the theme's.
   */
  lineHeight: ThemeLineHeights;
  /**
   * In em. RN's `letterSpacing` is in points, so pass this through
   * `letterSpacingPoints` with the font size it applies to.
   */
  letterSpacingEm: ThemeLetterSpacing;
  /** Points. `section` and `gutter` resolved for the given width. */
  space: Record<keyof ThemeSpace, number>;
  /** Points. */
  radius: ThemeRadius;
}

/** The platforms with a single-font-family style system. */
export type NativePlatform = 'ios' | 'android';

/**
 * Resolve tokens for a native client.
 *
 * @param viewportWidth the screen width in points — RN's
 *   `Dimensions.get('window').width`. Fluid tokens interpolate against it
 *   exactly as CSS `clamp()` does on the web, so a phone 390pt wide gets the
 *   same type size the website gives a 390px viewport. That equivalence is the
 *   whole point; if it ever stops holding, the two frontends have drifted.
 */
export function resolveTheme(
  theme: ThemeTokens,
  { platform, viewportWidth }: { platform: NativePlatform; viewportWidth: number },
): ResolvedTheme {
  const family = (token: FontFamilyToken) => (platform === 'ios' ? token.ios : token.android);

  return {
    color: { ...theme.color },
    fontFamily: {
      body: family(theme.font.body),
      ui: family(theme.font.ui),
      display: family(theme.font.display),
    },
    fontSize: {
      display: resolveFluid(theme.type.display, viewportWidth),
      title: resolveFluid(theme.type.title, viewportWidth),
      heading: resolveFluid(theme.type.heading, viewportWidth),
      subheading: resolveFluid(theme.type.subheading, viewportWidth),
      lede: resolveFluid(theme.type.lede, viewportWidth),
      body: resolveFluid(theme.type.body, viewportWidth),
      small: resolveFluid(theme.type.small, viewportWidth),
      micro: resolveFluid(theme.type.micro, viewportWidth),
    },
    lineHeight: { ...theme.lineHeight },
    letterSpacingEm: { ...theme.letterSpacing },
    space: {
      xs: theme.space.xs,
      sm: theme.space.sm,
      md: theme.space.md,
      lg: theme.space.lg,
      xl: theme.space.xl,
      xxl: theme.space.xxl,
      section: resolveFluid(theme.space.section, viewportWidth),
      gutter: resolveFluid(theme.space.gutter, viewportWidth),
    },
    radius: { ...theme.radius },
  };
}

/**
 * A fluid token at one width, in points.
 *
 * Deliberately the same piecewise-linear function CSS `clamp()` evaluates:
 * flat at `min` up to `vwMin`, linear between, flat at `max` past `vwMax`.
 * `cssFluid` below emits that curve; this one computes it. The unit test holds
 * them to the same numbers.
 */
export function resolveFluid(value: FluidValue, viewportWidth: number): number {
  if (value.min === value.max) return value.min;
  if (viewportWidth <= value.vwMin) return value.min;
  if (viewportWidth >= value.vwMax) return value.max;

  const progress = (viewportWidth - value.vwMin) / (value.vwMax - value.vwMin);
  return value.min + (value.max - value.min) * progress;
}

/**
 * Letter spacing in em → points, for the font size it applies to.
 *
 * The bridge exists because the two platforms disagree: CSS takes `em` and
 * resolves it against the element's own font size; React Native takes absolute
 * points and cannot.
 */
export function letterSpacingPoints(em: number, fontSizePoints: number): number {
  return em * fontSizePoints;
}

/* -------------------------------------------------------------------------- */
/* CSS emission                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Tokens to CSS custom properties, for a `<style>` element in `<head>`.
 *
 * Emitted as declarations only (no selector) so the caller decides the scope —
 * `:root` for the site, a class for a preview pane.
 *
 * Every value here is built from a number or an already-validated hex string.
 * Nothing from the Firestore document is concatenated in. That is the security
 * property, and `assertSafeValue` on every declaration is the belt to that
 * braces — cheap, and it turns a future refactor that reintroduces raw
 * interpolation into a loud failure instead of a quiet defacement.
 */
export function emitThemeCss(theme: ThemeTokens): string {
  const lines: string[] = [];
  const declare = (name: string, value: string) =>
    lines.push(`  --${name}: ${assertSafeValue(name, value)};`);

  for (const [name, value] of Object.entries(theme.color)) {
    declare(`color-${kebab(name)}`, value);
  }

  for (const [name, family] of Object.entries(theme.font)) {
    declare(`font-${kebab(name)}`, family.webStack.map(cssFontName).join(', '));
  }

  for (const [name, value] of Object.entries(theme.type)) {
    declare(`type-${kebab(name)}`, cssFluid(value));
  }

  for (const [name, value] of Object.entries(theme.lineHeight)) {
    // Unitless, so it also multiplies correctly when inherited by a child with
    // a different font size — which is exactly why line-height is stored as a
    // ratio rather than a length.
    declare(`leading-${kebab(name)}`, round(value));
  }

  for (const [name, value] of Object.entries(theme.letterSpacing)) {
    declare(`tracking-${kebab(name)}`, `${round(value)}em`);
  }

  for (const [name, value] of Object.entries(theme.space)) {
    declare(`space-${kebab(name)}`, typeof value === 'number' ? rem(value) : cssFluid(value));
  }

  for (const [name, value] of Object.entries(theme.radius)) {
    declare(`radius-${kebab(name)}`, `${round(value)}px`);
  }

  declare('measure', `${round(theme.web.measureCh)}ch`);
  declare('shell-width', rem(theme.web.shellWidth));
  declare('backdrop-opacity', round(theme.web.backdropOpacity));
  declare('shadow-sm', cssShadow(theme.web.shadowSm));
  declare('shadow-md', cssShadow(theme.web.shadowMd));
  declare('shadow-lg', cssShadow(theme.web.shadowLg));

  return lines.join('\n');
}

/**
 * `clamp(min, intercept + slope*vw, max)`.
 *
 * The middle term is the line through (`vwMin`, `min`) and (`vwMax`, `max`);
 * `clamp` flattens it outside that range. A constant token emits a bare length
 * instead — `clamp(1rem, 1rem, 1rem)` works but tells a reader inspecting the
 * element nothing.
 */
function cssFluid(value: FluidValue): string {
  if (value.min === value.max) return rem(value.min);

  const slope = ((value.max - value.min) / (value.vwMax - value.vwMin)) * 100;
  const intercept = value.min - ((value.max - value.min) * value.vwMin) / (value.vwMax - value.vwMin);

  return `clamp(${rem(value.min)}, ${rem(intercept)} + ${round(slope)}vw, ${rem(value.max)})`;
}

function cssShadow(value: ThemeShadow): string {
  return `${round(value.x)}px ${round(value.y)}px ${round(value.blur)}px ${round(value.spread)}px ${value.color}`;
}

/**
 * Quote a family name only when it needs it.
 *
 * `serif` and `ui-sans-serif` are keywords and must stay bare — quoting them
 * turns them into a search for a font of that literal name, which no system
 * has, so the fallback silently stops working. Anything with a space gets
 * quoted. `FONT_NAME` has already guaranteed there is no quote inside to
 * escape.
 */
function cssFontName(name: string): string {
  return /\s/.test(name) ? `'${name}'` : name;
}

function rem(points: number): string {
  return `${round(points / ROOT_FONT_SIZE)}rem`;
}

/** Four decimals, without a trailing `.0000`. Keeps the emitted sheet legible. */
function round(value: number): string {
  return String(Number(value.toFixed(4)));
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

/**
 * Is this string safe to inject into a `<style>` element?
 *
 * Exists for exactly one caller: the boot script that restores a **cached**
 * theme from `localStorage` before first paint. Everything else builds its CSS
 * from `emitThemeCss`, which is safe by construction — but a cached string has
 * been outside this code, in storage any script on the origin can write to.
 * Trusting it because "we wrote it" is trusting whatever last wrote to that key.
 *
 * Deliberately an allowlist of the exact grammar `emitThemeCss` emits — a list
 * of `--custom-property: value;` declarations — rather than a denylist of
 * dangerous characters. A denylist has to anticipate every escape; this has to
 * describe one very small language.
 */
export function isSafeThemeCss(css: unknown): css is string {
  if (typeof css !== 'string' || css.length === 0 || css.length > 20_000) return false;

  return css
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .every((line) =>
      // --name: value;  where value is letters, digits, and the punctuation
      // that lengths, colours, comma-separated font stacks, and clamp() need.
      // Note what is absent: {} ; < > \ ( ) beyond a bare clamp/min/max call,
      // and the quote is permitted only around font names.
      /^--[a-z0-9-]+:\s*[a-z0-9\s.,%#'()+/*-]+;$/i.test(line) &&
        !/url\(|@import|expression|javascript:|\/\*/i.test(line),
    );
}

/**
 * Last line of defence, applied to one declaration's value.
 *
 * Checked per value rather than over the assembled sheet, because the sheet
 * legitimately contains the `;` that separates declarations and the parentheses
 * that `clamp()` needs — a blanket ban on those would reject the emitter's own
 * correct output.
 *
 * What a value may never contain:
 *
 *   `;` `}` `{`  end this declaration or open a new rule
 *   `<` `>`      close the `<style>` element
 *   `\`          CSS escapes, which can spell any of the above
 *   `/*`         a comment, to hide the rest of a payload from a reviewer
 *   `url(`       a network fetch; the tracking vector even with no script
 *   `@import`    the same, and it can pull in a whole stylesheet
 *
 * This should be unreachable — every value is emitted from a validated number
 * or hex string. It exists because "should be unreachable" is a property of
 * today's code, and this text lands in a `<style>` element on every page of the
 * site. Throwing fails the build, which is the right outcome: a site that does
 * not deploy beats a site that deploys defaced.
 */
function assertSafeValue(name: string, value: string): string {
  if (/[<>{};\\]|\/\*|url\(|@import/i.test(value)) {
    throw new Error(
      `emitThemeCss produced an unsafe value for --${name}: ${JSON.stringify(value)}. ` +
        'A token is reaching CSS without validation — fix the emitter or the parser, ' +
        'do not relax this check.',
    );
  }
  return value;
}
