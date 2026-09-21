/**
 * The eight App Clip fallback pages, written from one template.
 *
 * ---------------------------------------------------------------------------
 * `public/c/<slug>.html`, one per experience in
 * `src/clip/experiences.ts` in the SPSM-Connect repo. Committed outputs: run
 * this by hand when a row changes, the way `optimize-assets.mjs` is run.
 *
 * ## Why these are files at all
 *
 * An App Clip invocation URL must resolve to a real page, and **Apple will not
 * follow a redirect from one**. It is also the page that everybody who is not
 * on an iPhone sees — an Android phone, a laptop, anybody who dismisses the
 * card — so it cannot be a stub that says "get the app".
 *
 * They are deliberately thin. Each one names the thing, says the one sentence
 * that makes it worth a tap, and links to the page on this site that already
 * does it and is already maintained. The alternative — eight self-contained
 * pages, the way Taksis's `c/register-vehicle.html` is one — would be a second
 * copy of content Next already renders, kept in step by memory.
 *
 * ## Why they are static HTML rather than Next routes
 *
 * `cleanUrls` and `trailingSlash: false` in `firebase.json` decide what an
 * exported Next route is actually served at, and an invocation URL that is
 * wrong by a slash is a tag that has to be reprinted. A file at
 * `public/c/give.html` is served at `/c/give` and nowhere else, which is a
 * property worth having on something stamped into metal. It is also how the
 * Taksis clip's page works, which is the arrangement this one is copying.
 *
 * ## The colours are baked, and that is a compromise
 *
 * Everything else on this site reads `config/theme` through the custom
 * properties the root layout emits. These pages have no layout and no theme
 * element, so they use `DEFAULT_THEME` from `@spsm/shared` — the same values
 * the app's icons are baked from, for the same reason. A theme change in
 * Firestore does not reach them until this script is re-run, which is the one
 * thing to remember about them.
 * ---------------------------------------------------------------------------
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_THEME } from '@spsm/shared';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'apps/website/public/c');

/**
 * The canonical host, and it is `www.` for a reason worth keeping written down:
 * the apex answers 301 to this host for every path, `.well-known/` included,
 * and **Apple follows no redirect** from an App Clip invocation URL or when
 * fetching the association file. A tag printed without the `www.` opens Safari
 * and never the clip.
 */
const ORIGIN = 'https://www.spsmwayland.org';

/**
 * The Smart App Banner, once SPSM Connect has an App Store id.
 *
 * It cannot be written yet — the app is unreleased — and an `app-id` that is
 * wrong is worse than one that is absent: Safari would offer a stranger's app
 * above the church's own page. `features/apps/stores.ts` carries the same gap
 * and says so. Set this to the ten-digit id and re-run.
 *
 * Taksis's page is the shape to copy:
 *   <meta name="apple-itunes-app" content="app-id=6743824691, app-clip-bundle-id=com.tghaly.taksis.Clip">
 */
const APP_STORE_ID = process.env.SPSM_CONNECT_APP_STORE_ID ?? '';
const CLIP_BUNDLE_ID = 'org.spsm.connect.Clip';

/**
 * The eight, and every field has to match the app's own table.
 *
 * `title` and `blurb` are the card's title and subtitle in App Store Connect;
 * keeping them the same here means somebody who dismissed the card reads the
 * same words on the page it falls back to. The bookstore's `blurb` is the one
 * deliberate exception, and says on the row why. `sitePath` is the page that
 * does the thing — the one this file exists to hand off to.
 */
const EXPERIENCES = [
  {
    slug: 'give',
    title: 'Give',
    blurb: 'Make an offering to the church.',
    body: 'Giving goes through Tithe.ly, the church’s own giving provider — one-off or recurring, by card, Apple Pay or Google Pay.',
    action: 'Go to the giving page',
    sitePath: '/giving',
  },
  {
    slug: 'schedule',
    title: 'This Week',
    blurb: 'Services and events at the church this week.',
    body: 'Liturgies, Vespers, meetings and everything else on the parish calendar, kept by the church office.',
    action: 'See the calendar',
    sitePath: '/calendar',
  },
  {
    slug: 'apps',
    /*
     * "Church", not "parish". The app's table and `ClipDestination.swift` both
     * say `The Church’s Apps`, and this is the App Store Connect title — the
     * words on the card somebody dismissed to arrive here. The site's own prose
     * still says "parish", which is the site's voice and is left alone; a title
     * that has to match three other files is not the place to keep a voice.
     */
    title: 'The Church’s Apps',
    blurb: 'Taksis, Tithe.ly and SPSM Connect.',
    body: 'Three apps, and what each one is for. Two of them are ours; the giving app is Tithe.ly’s.',
    action: 'See the apps',
    sitePath: '/apps',
  },
  {
    slug: 'welcome',
    title: 'Welcome',
    blurb: 'What happens in the liturgy, if you have not been before.',
    body: 'A walk through the service in the order it happens, what the Coptic means, and what nobody minds if you do not do.',
    action: 'Read the welcome',
    sitePath: '/about/welcome-newcomers',
  },
  {
    slug: 'plans',
    title: 'Our Expansion Plans',
    blurb: 'The three buildings designed for 169 Rice Road.',
    body: 'The renderings, the flythrough, the land, and where the work stands today.',
    action: 'See the plans',
    sitePath: '/about/future-plans',
  },
  {
    slug: 'bookstore',
    title: 'The Bookstore',
    /*
     * The one row whose `blurb` is deliberately **not** the App Store Connect
     * subtitle, and it must stay that way.
     *
     * The card reads "See the shelf and buy in the app", because the bookstore
     * is the clip's only handoff — Square's SDK is too large for the 15 MB
     * budget, so the clip cannot take money. Nobody reading *this* page is in
     * that situation: they are on Android, or on a laptop, or they dismissed the
     * card, and the button below sends them to a bookstore that sells to them
     * perfectly well. Repeating the card's words here would tell a shopper who
     * can already buy that they have to install something first.
     *
     * So the rule above holds for seven rows and this sentence is the eighth's
     * answer to the same question, asked of a different reader.
     */
    blurb: 'Icons, books and gifts from the church.',
    body: 'Order here and collect at the church, or have it posted. Payment is taken by Square.',
    action: 'Open the bookstore',
    sitePath: '/bookstore',
  },
  {
    slug: 'forms',
    title: 'Parish Forms',
    blurb: 'Fill in a church form from your phone.',
    body: 'Registrations, requests and the contact form — no account needed for any of them.',
    action: 'See the forms',
    sitePath: '/forms',
  },
  {
    slug: 'photos',
    title: 'Send a Photograph',
    blurb: 'Add a photograph to the parish galleries.',
    body: 'Photographs from parish events go to the ministry they belong to, and somebody from the church looks at everything before it appears.',
    action: 'See the galleries',
    sitePath: '/events',
  },
];

const { color, font, radius } = DEFAULT_THEME;
const bodyStack = font.body.webStack.map(quoteIfNeeded).join(', ');
const uiStack = font.ui.webStack.map(quoteIfNeeded).join(', ');

function quoteIfNeeded(family) {
  return /\s/.test(family) ? `"${family}"` : family;
}

/** The one character that must not reach HTML unescaped, plus the obvious two. */
function escape(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function page({ slug, title, blurb, body, action, sitePath }) {
  const banner = APP_STORE_ID
    ? `\n  <meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}, app-clip-bundle-id=${CLIP_BUNDLE_ID}">`
    : `\n  <!-- No Smart App Banner: SPSM Connect has no App Store id yet. See make-clip-pages.mjs. -->`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(title)} — St. Philopater &amp; St. Mina</title>
  <meta name="description" content="${escape(blurb)}">
  <meta name="theme-color" content="${color.deep}">${banner}
  <link rel="canonical" href="${ORIGIN}${sitePath}">
  <!--
    Written by scripts/make-clip-pages.mjs. Do not edit by hand.

    This page is the fallback for the App Clip experience invoked at
    ${ORIGIN}/c/${slug} — the page anybody sees who is not on an iPhone, or who
    dismissed the App Clip card. The canonical link points at the real page,
    because that is the one worth indexing; this is a doorway.
  -->
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; background: ${color.paper}; }
    body {
      margin: 0;
      min-height: 100svh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      font-family: ${bodyStack};
      color: ${color.ink};
      line-height: 1.6;
    }
    main {
      width: 100%;
      max-width: 32rem;
      background: ${color.paperRaised};
      border: 1px solid ${color.rule};
      border-radius: ${radius.lg}px;
      padding: 2rem 1.5rem;
    }
    .eyebrow {
      font-family: ${uiStack};
      font-size: 0.6875rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: ${color.inkFaint};
      margin: 0 0 0.5rem;
    }
    h1 { font-size: 1.75rem; line-height: 1.2; margin: 0 0 0.75rem; color: ${color.ink}; }
    .lede { font-size: 1.0625rem; color: ${color.inkSoft}; margin: 0 0 1rem; }
    p { margin: 0 0 1.25rem; color: ${color.inkSoft}; }
    a.action {
      display: inline-block;
      font-family: ${uiStack};
      font-size: 1rem;
      font-weight: 600;
      text-decoration: none;
      color: ${color.inkInverse};
      background: ${color.accent};
      border-radius: ${radius.sm}px;
      padding: 0.75rem 1.25rem;
      min-height: 44px;
    }
    a.action:hover, a.action:focus { background: ${color.accentStrong}; }
    footer {
      margin-top: 1.5rem;
      padding-top: 1rem;
      border-top: 1px solid ${color.rule};
      font-family: ${uiStack};
      font-size: 0.8125rem;
      color: ${color.inkFaint};
    }
    footer a { color: ${color.accent}; }
    @media (prefers-reduced-motion: no-preference) { a.action { transition: background 120ms ease; } }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">St. Philopater Mercurius &amp; St. Mina</p>
    <h1>${escape(title)}</h1>
    <p class="lede">${escape(blurb)}</p>
    <p>${escape(body)}</p>
    <a class="action" href="${sitePath}">${escape(action)}</a>
    <footer>
      Coptic Orthodox Church, Wayland, Massachusetts ·
      <a href="/">spsmwayland.org</a>
    </footer>
  </main>
</body>
</html>
`;
}

mkdirSync(out, { recursive: true });

for (const experience of EXPERIENCES) {
  const file = join(out, `${experience.slug}.html`);
  writeFileSync(file, page(experience));
  console.log(`wrote c/${experience.slug}.html  →  ${experience.sitePath}`);
}

console.log(
  APP_STORE_ID
    ? `\nSmart App Banner: app-id=${APP_STORE_ID}`
    : '\nNo Smart App Banner in these pages — set SPSM_CONNECT_APP_STORE_ID once the app is published, and re-run.',
);
