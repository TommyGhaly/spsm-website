/**
 * Fill the emulators with enough to click around the whole site.
 *
 * Local development only. It writes through the emulator's admin bypass and
 * refuses to run against anything that is not localhost, because every safety
 * rail in `firestore.rules` is off in this path.
 *
 * Why this exists: `npm run dev` reads the real Firestore, which is right for
 * the public pages and useless for anything behind sign-in — the admin and the
 * servants schedule both need a signed-in user with a role, and against the
 * real project the only way to get one is to be a member of the parish Entra
 * directory. Against the emulators you can be anyone, and Delete is not
 * something you did to the parish.
 *
 * Everything it writes is real: the same markdown `npm run content` pushes, the
 * committed config defaults, and events shaped the way the admin writes them.
 *
 * The content pages are forced to `published: true` here even though the
 * committed files say false. They are drafts awaiting the parish's review, and
 * the point of this script is to see them rendered.
 *
 * Usage:
 *   firebase emulators:start --only auth,firestore --project spsm-database
 *   node scripts/seed-emulator.mjs
 *   NEXT_PUBLIC_USE_EMULATORS=1 npm run dev
 *
 * Optional: SPSM_BREEZE_EMBED_URL=... to populate the servants schedule. It is
 * a bearer credential, so it is never committed — see docs/integrations.md.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_INTEGRATIONS_CONFIG,
  DEFAULT_PARISH_CONFIG,
  DEFAULT_THEME,
  isAllowedEmbedUrl,
} from '../packages/shared/dist/index.js';
import { toFieldMap } from './lib/firestore-rest.mjs';
import { collectPages } from './lib/content-files.mjs';
import { seedForms } from './lib/form-definitions.mjs';
import { webpSize } from './lib/webp-size.mjs';

const PROJECT = 'spsm-database';
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const STORAGE = process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199';

/**
 * The bucket the website resolves at runtime, so the objects written here are
 * the ones its `<img src>` asks for. A different default would upload happily
 * and render nothing, which is the failure this whole change is undoing.
 */
const BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? `${PROJECT}.firebasestorage.app`;

/** Where the gallery photographs come from. Already in the repo, already webp. */
const IMAGE_DIR = fileURLToPath(new URL('../apps/website/public/img', import.meta.url));

for (const [name, host] of [['Firestore', FIRESTORE], ['Auth', AUTH], ['Storage', STORAGE]]) {
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) {
    console.error(`Refusing to run: ${name} host ${host} is not localhost.`);
    process.exit(1);
  }
}

const docUrl = (path) =>
  `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;

async function put(path, data) {
  const res = await fetch(docUrl(path), {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFieldMap(data) }),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

async function authPost(path, body) {
  const res = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, body: await res.json() };
}

/**
 * Put an object in the Storage emulator.
 *
 * `Bearer owner` is the emulator's admin bypass, the same one `put` uses for
 * Firestore — and it is required rather than convenient: `storage.rules` allows
 * nobody to write `galleries/` from a client, and quite rightly, since approval
 * is what moves bytes there in production. This script is standing in for the
 * transcode Function, not for a user.
 */
async function uploadBytes(path, bytes, contentType) {
  const url = `http://${STORAGE}/v0/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(path)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': contentType },
    body: bytes,
  });
  if (!res.ok) {
    throw new Error(`upload ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  /*
   * A second call, because the emulator drops the `Content-Type` header on a
   * media upload and files everything as `application/octet-stream`. A browser
   * sniffs an image and shows it anyway, so this looks harmless — and then
   * `<video>` refuses to play an octet-stream, which reads as a bug in the
   * player rather than in the fixture.
   */
  const patch = await fetch(
    `http://${STORAGE}/v0/b/${BUCKET}/o/${encodeURIComponent(path)}`,
    {
      method: 'PATCH',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType }),
    },
  );
  if (!patch.ok) throw new Error(`content type for ${path}: HTTP ${patch.status}`);
}

async function upload(path, file, contentType) {
  return uploadBytes(path, readFileSync(file), contentType);
}

/**
 * A few seconds of moving colour, as mp4.
 *
 * Generated because a committed video is the one binary that would make this
 * repo unpleasant to clone, and because the thing being tested is the player and
 * the slide timing rather than any particular footage. Returns null when
 * `ffmpeg` is not installed — the seeded document then has a poster and no clip,
 * which is a real state (a transcode still running) and worth being able to see.
 */
async function makeClip(seconds) {
  const out = join(tmpdir(), `spsm-seed-clip-${seconds}s.mp4`);
  try {
    execFileSync(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i',
       `testsrc=size=960x540:rate=24:duration=${seconds}`,
       '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
      { stdio: 'ignore' },
    );
    return readFileSync(out);
  } catch {
    return null;
  }
}

/**
 * Captions, because they are the alt text and an empty one is an accessibility
 * hole you cannot see. Anything unlisted falls back to its id.
 */
const CAPTIONS = {
  'm-01': 'The domes at dusk, from the car park',
  'm-16': 'The sanctuary from the back',
  'm-17': 'Light across the whole east wall',
  'm-18': 'A single window, close',
  'm-19': 'The nave, end to end',
  'm-20': 'Looking up at the north tower',
  'm-21': 'A study in charcoal',
  'm-22': 'The towers against the field',
  'm-02': 'The crucifixion icon in the north aisle',
  'm-03': 'Afternoon light through the glass',
  'm-04': 'Packing the food parcels',
  'm-05': 'The bell towers from the field',
  'm-06': 'The sanctuary, before the Liturgy',
  'm-07': 'A face, in progress',
  'm-11': 'Christ, sketched in charcoal',
  'm-12': 'The towers, looking up',
  'm-13': 'Glass, end to end',
  'm-14': 'The Coptic cross',
};

/**
 * A sign-in-able account with a role claim. Idempotent across re-runs.
 *
 * Created **twice over**, with a password and as a `microsoft.com` identity,
 * because the two sign-in paths look for different things and only one of them
 * is the path the website actually uses.
 *
 * `signIn()` in lib/authStore.ts always calls `signInWithMicrosoft`, emulators
 * or not. Against the Auth emulator that opens its IdP widget, which lists
 * federated accounts only — so with password accounts alone the widget said
 * "No Microsoft.com accounts exist in the Auth Emulator" and local sign-in was
 * a dead end. The federated identity below is what puts the parish's test
 * accounts in that list, one click each.
 *
 * The password is kept because `signInWithEmulatorAccount` still uses it, and
 * because it is the only way in if the widget is ever unavailable.
 */
async function user(email, role, groups = []) {
  await authPost('accounts:signUp?key=fake', {
    email,
    password: 'emulator-only',
    returnSecureToken: true,
  });

  /*
   * Attach a microsoft.com identity to the same address.
   *
   * The emulator accepts an unsigned JSON object where a real provider would
   * send a signed JWT — that is the whole point of it — so `sub` can simply be
   * derived from the address and stays stable across re-runs, which is what
   * makes this idempotent rather than piling up an account per seed.
   */
  const idToken = JSON.stringify({
    sub: `microsoft-${email.split('@')[0]}`,
    email,
    email_verified: true,
    name: email.split('@')[0],
  });
  await authPost('accounts:signInWithIdp?key=fake', {
    postBody: `id_token=${encodeURIComponent(idToken)}&providerId=microsoft.com`,
    requestUri: 'http://localhost',
    returnIdpCredential: true,
    returnSecureToken: true,
  });

  const found = await authPost(`projects/${PROJECT}/accounts:lookup`, { email: [email] });
  const uid = found.body.users?.[0]?.localId;
  if (!uid) throw new Error(`could not create or find ${email}`);
  /*
   * Claims and password in one update, and the password is not redundant.
   *
   * Attaching the microsoft.com identity above leaves the account holding that
   * provider and no password hash — the `accounts:signUp` call earlier is
   * superseded rather than merged with. Setting it here restores the
   * email/password path that `signInWithEmulatorAccount` uses, so both ways in
   * work: the IdP widget lists the account, and the website signs into it
   * directly without a popup.
   */
  await authPost(`projects/${PROJECT}/accounts:update`, {
    localId: uid,
    password: 'emulator-only',
    customAttributes: JSON.stringify({ role, groups }),
  });
  return uid;
}

const audit = (uid = null) => ({ createdAt: new Date(), updatedAt: new Date(), updatedBy: uid });

// --- accounts ---------------------------------------------------------------

/*
 * The last two exist to make the program-gallery permission model testable at
 * all. It is the one axis on this site that cannot be exercised by changing a
 * role: a grant is a list of ids on a member document, and "the youth servant
 * can reach Summercamp but not St. Simon" is invisible until you sign in as
 * somebody holding exactly that.
 */
const accounts = [
  ['admin@spsmwayland.org', 'admin', [], null],
  ['staff@spsmwayland.org', 'staff', [], null],
  ['servant@spsmwayland.org', 'servant', [], null],
  ['father@spsmwayland.org', 'staff', ['clergy'], null],
  // Holds a whole program: every camp, this year and every year.
  ['lead@spsmwayland.org', 'servant', [], { programs: ['summercamp'], events: [] }],
  // Helps with one week. Must not inherit week 2 — see the rules tests.
  ['volunteer@spsmwayland.org', 'servant', [], { programs: [], events: ['week-1-2027'] }],
];
for (const [email, role, groups, programAdmin] of accounts) {
  const uid = await user(email, role, groups);
  await put(`members/${uid}`, {
    displayName: email.split('@')[0],
    email,
    phone: null,
    photoPath: null,
    roleMirror: role,
    groupsMirror: groups,
    authProvider: 'microsoft',
    notificationPrefs: { announcements: true, prayerTeam: false, orderUpdates: false },
    programAdmin: programAdmin ?? { programs: [], events: [] },
    ...audit(),
  });
}

// --- configuration ----------------------------------------------------------

await put('config/integrations', DEFAULT_INTEGRATIONS_CONFIG);
await put('config/parish', {
  ...DEFAULT_PARISH_CONFIG,
  // The address and service times were confirmed by the parish on 2026-08-18
  // and are now published in `config/parish`, so these match production rather
  // than standing in for it.
  //
  // The phone still does not. It differs between two old Wix pages (…3750 on
  // /contact-us, …3570 on /team-3), the parish has not said which is right, and
  // `config/parish.phone` is deliberately still empty — so the number below is
  // local test data and must not be copied into production.
  address: { line1: '169 Rice Rd', line2: '', city: 'Wayland', state: 'MA', postalCode: '01778' },
  phone: '(508) 739-3750',
  email: 'info@spsmwayland.org',
  officeHours: 'Tuesday to Friday, 9:00 AM – 3:00 PM',
  serviceTimes: [
    { name: 'Matins & Divine Liturgy', day: 'Sunday', time: '8:00 – 11:30 AM' },
    { name: 'Vespers', day: 'Saturday', time: '6:00 PM' },
    { name: 'Midweek Liturgy', day: 'Wednesday', time: '8:00 – 10:00 AM' },
  ],
  // `social` is deliberately not overridden here: the accounts in
  // DEFAULT_PARISH_CONFIG came from the parish and are correct, so the emulator
  // should exercise exactly what production renders.
  notes: 'Local emulator data. The phone here is unverified; the address and service times match production.',
});

// The design tokens the site reads at build time. Seeded with the committed
// defaults, so the emulator renders identically to a fresh clone — and so that
// editing a value here is the way to check a theme change end to end without
// touching the real project.
await put('config/theme', DEFAULT_THEME);

const breeze = process.env.SPSM_BREEZE_EMBED_URL;
if (breeze && isAllowedEmbedUrl(breeze)) {
  await put('servantsConfig/schedule', {
    embedUrl: breeze,
    note: 'Updated weekly from Breeze.',
    manageUrl: '',
    updatedAt: new Date(),
  });
}

// --- forms ------------------------------------------------------------------

/*
 * The parish's forms, from the same definitions `seed-forms.mjs` writes to the
 * real project.
 *
 * Imported rather than retyped, deliberately. Two copies of a form definition
 * is how the local /forms and the real one start disagreeing about which
 * questions a form asks — which is precisely the sort of difference nobody
 * notices until a conditional field behaves one way on a laptop and another way
 * on Sunday.
 *
 * Everything is published here, including the three Breeze rebuilds that are
 * drafts in production. Locally the point is to be able to open them.
 */
const forms = seedForms();
for (const form of forms) {
  await put(`forms/${form.slug}`, { ...form, published: true, ...audit() });
}

// --- content ----------------------------------------------------------------

const pages = collectPages();
for (const { slug, document } of pages) {
  await put(`content/${slug}`, { ...document, published: true, createdAt: new Date() });
}

// --- events -----------------------------------------------------------------

const day = (offsetDays, hour) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d;
};

const events = [
  {
    slug: 'egyptian-coptic-festival',
    title: 'Egyptian Coptic Festival',
    summary: 'Three days of food, music, and tours of the church. Everyone welcome.',
    body: '## Come and see\n\nEgyptian food, live music, and tours of the church.\n\n- Friday evening: opening and vespers\n- Saturday: all day, with activities for children\n- Sunday: after the Divine Liturgy\n\nParking is available on site.',
    startAt: day(9, 17),
    endAt: day(11, 20),
    category: 'festival',
    tags: ['festival', 'outreach'],
    location: { name: 'The church grounds', address: '169 Rice Rd, Wayland, MA', meetingUrl: null },
  },
  {
    slug: 'iconography-class',
    title: 'Iconography Class',
    summary: 'An introduction to writing icons in the Coptic tradition.',
    body: 'A six-week introduction to the Coptic iconographic tradition. No previous experience is needed and materials are provided.',
    startAt: day(16, 19),
    endAt: day(16, 21),
    category: 'class',
    tags: ['youth'],
    location: { name: 'The church hall', address: null, meetingUrl: null },
  },
  {
    slug: 'summer-camp',
    title: 'Summer Camp',
    summary: 'A week away for the youth of the parish.',
    body: 'A week of prayer, teaching, sport, and time away together.\n\nRegistration opens in the spring.',
    startAt: day(40, 9),
    endAt: day(45, 16),
    category: 'camp',
    tags: ['youth'],
    location: { name: 'To be announced', address: null, meetingUrl: null },
  },
];

for (const e of events) {
  await put(`events/${e.slug}`, {
    ...e,
    allDay: false,
    timeZone: 'America/New_York',
    heroImagePath: null,
    audience: 'parish',
    registration: null,
    recurrence: null,
    published: true,
    publishAt: null,
    ...audit(),
  });
}

// --- announcements ----------------------------------------------------------

await put('announcements/welcome-back', {
  title: 'Sunday school resumes',
  body: 'Sunday school classes resume this week for all age groups, following the Divine Liturgy.',
  expiresAt: null,
  pinned: true,
  pushedAt: null,
  linkUrl: null,
  published: true,
  publishAt: null,
  ...audit(),
});

// --- bookstore --------------------------------------------------------------
//
// Absent from this script until the galleries moved local development onto the
// emulators. Before that `npm run dev` read the real Firestore, so the shop was
// always full and nobody noticed it was never seeded; the moment local dev
// stopped talking to production, the bookstore went empty and looked broken.
//
// Titles and prices mirror the parish's real Square catalog so the shelf reads
// like the real one. `imagePaths` is empty, exactly as in production — the
// covers are hotlinked from Square rather than stored, so there is nothing to
// seed and the shelf falls back to its placeholder here just as it does live.
//
// `squareCatalogObjectId` is null throughout: these are local fixtures, and
// giving them plausible Square ids would invite `npm run catalog` to believe it
// had already mirrored them.
const usd = (cents) => ({ amount: cents, currency: 'USD' });

const products = [
  ['holy-bible', 'Holy Bible', 1500, 12, 'Bibles'],
  ['come-and-see', 'Come and See', 800, 4, 'Books'],
  ['the-angelic-life', 'The Angelic Life', 900, 6, 'Books'],
  ['be-prepared-book-fr-daoud-lamei', 'Be Prepared — Fr. Daoud Lamei', 500, 0, 'Books'],
  ['the-hidden-treasure', 'The Hidden Treasure', 1200, null, 'Books'],
  ['icon-st-mina', 'Icon of St. Mina', 2500, 3, 'Icons'],
];

for (const [slug, name, cents, stockCount, category] of products) {
  await put(`products/${slug}`, {
    slug,
    name,
    description: `${name} — local test copy, not the parish's words.`,
    price: usd(cents),
    imagePaths: [],
    squareCatalogObjectId: null,
    squareVariationId: null,
    syncedAt: null,
    // 0 is sold out; null is "not tracked". Both are seeded because the shelf
    // renders them differently and only one of them is the interesting case.
    stockCount,
    category,
    published: true,
    publishAt: null,
    ...audit(),
  });
}

// One draft, so "published is the switch" is visible locally: this must never
// appear on the shelf.
await put('products/unreleased-title', {
  slug: 'unreleased-title',
  name: 'Not For Sale Yet',
  description: 'Unpublished. If this shows on the shelf, the published filter is broken.',
  price: usd(999),
  imagePaths: [],
  squareCatalogObjectId: null,
  squareVariationId: null,
  syncedAt: null,
  stockCount: null,
  category: 'Books',
  published: false,
  publishAt: null,
  ...audit(),
});

// --- program galleries ------------------------------------------------------
//
// Enough of a tree to exercise all three presentation levels (group, event,
// program) and both grant shapes, without pretending to be a real camp.
//
// The photographs are **real bytes**, and that changed. They used to be
// references only — `renditionPath` pointed into the emulator's bucket and
// nothing ever put an object there, so every gallery rendered as a lattice of
// broken-image icons. That was defended as a fair trade ("seeding binaries
// would make this script slow and large"), and it was the wrong one: the whole
// point of the gallery is the arrangement of the pictures, and you cannot judge
// an arrangement of torn-page icons. Nobody could tell a packing bug from a
// missing file.
//
// Nothing new is committed to get them. The files are the site's own webp
// images from apps/website/public/img, re-uploaded under `galleries/` — a few
// hundred kilobytes, already in the repo, and varied enough in shape (a
// panorama, two portraits, several landscapes) to make the packer produce
// something other than a uniform grid. `width`/`height` are read off the files
// rather than invented, so the layout you see locally is the layout the real
// aspect ratios produce.

const programs = [
  ['summercamp', 'Summercamp', 10],
  ['st-simon-for-seniors', 'St. Simon for Seniors', 20],
  ['college-and-young-professionals', 'College and Young Professionals', 30],
  ['mother-of-mercy', 'Mother of Mercy', 40],
  ['iconography', 'Iconography Class', 50],
];
for (const [slug, name, order] of programs) {
  await put(`programs/${slug}`, {
    slug,
    name,
    description: `${name} — local test copy, not the parish's words.`,
    coverMediaId: null,
    featuredMediaIds: [],
    /*
     * Summercamp gets a sideways rail with its title beside it; the rest keep the
     * default grid. Two arrangements across five ministries, so the local site
     * shows both what an administrator has styled and what an untouched one looks
     * like.
     */
    ...(slug === 'summercamp'
      ? {
          sectionLayout: {
            display: 'rail',
            scale: 'large',
            drift: true,
            title: { scale: 'display', placement: 'beside', align: 'start' },
            caption: { scale: 'small', placement: 'below', align: 'start' },
          },
        }
      : {}),
    order,
    published: true,
    publishAt: null,
    ...audit(),
  });
}

/*
 * The tree under Summercamp, five levels deep.
 *
 * `[id, parentId, title, order, submissionsOpen, layout]`. This is the fixture
 * for the thing the section is actually for — **a level summarises everything
 * beneath it** — and it cannot be exercised at two levels. Summercamp has to
 * reach past 2027 and past Week 1 to find Day 2's photographs, and "The hike"
 * has to be a page of its own that Day 2 then summarises.
 *
 * So: ministry → year → week → day → part. Anything shallower and a bug in the
 * spread across children, or in the trail resolution, or in the subtree counts,
 * simply does not render locally.
 *
 * `order` matters at exactly one level here and that is the point of seeding it:
 * the days carry 10/20/30, because "Day 2 after Day 1" is not something a date
 * or an alphabet can express. The years and weeks carry 0 and fall back to their
 * dates, which is what every document written before `order` existed does.
 *
 * The layouts are spread on purpose. `SectionLayout` is the other half of the
 * redesign — every level arranges itself — and a seed where all of them are the
 * default proves only that the default works. One grid, one sideways rail with
 * its title on the pictures, one drifting column with its title beside it, and
 * two with no layout at all so `resolveSectionLayout` is exercised too.
 */
const GRID_LAYOUT = {
  display: 'grid',
  scale: 'medium',
  drift: true,
  title: { scale: 'medium', placement: 'above', align: 'start' },
  caption: { scale: 'small', placement: 'over', align: 'start' },
};
const RAIL_LAYOUT = {
  display: 'rail',
  scale: 'large',
  drift: true,
  title: { scale: 'large', placement: 'over', align: 'start' },
  caption: { scale: 'small', placement: 'hidden', align: 'start' },
};
const COLUMN_LAYOUT = {
  display: 'column',
  scale: 'medium',
  drift: true,
  title: { scale: 'large', placement: 'beside', align: 'start' },
  caption: { scale: 'small', placement: 'below', align: 'start' },
};

const nodes = [
  // The year. A branch with nothing filed on it directly — its page is nothing
  // but a summary of the two weeks, which is the case that used to be impossible.
  ['sc-2027', null, 'Summercamp 2027', 0, false, GRID_LAYOUT],

  // Week 1 takes submissions; week 2 does not, so the closed-form path is
  // reachable without editing anything.
  /*
   * Week 1 is the side-by-side fixture: a half-width grid with a half-width
   * upright wheel beside it, which is the arrangement `SectionLayout.width` was
   * added for. Seeded rather than left to be dragged, because the two widths
   * sharing a row is the thing worth being able to look at locally without
   * signing in.
   */
  ['week-1-2027', 'sc-2027', 'Week 1', 0, true, { ...GRID_LAYOUT, width: 'half' }],
  ['day-1', 'week-1-2027', 'Day 1', 10, true, GRID_LAYOUT],
  ['day-2', 'week-1-2027', 'Day 2', 20, true, RAIL_LAYOUT],
  // The fifth level. Its parent summarises it, and its parent's parent
  // summarises that — which is the whole claim this fixture exists to check.
  ['the-hike', 'day-2', 'The hike', 10, true, COLUMN_LAYOUT],
  ['talent-show', 'week-1-2027', 'Talent Show', 30, true, COLUMN_LAYOUT],

  // A different set of names under week 2, deliberately: two weeks sharing one
  // list would hide the case where a picker has to name a level by its whole
  // trail rather than by its own title.
  ['week-2-2027', 'sc-2027', 'Week 2', 0, false, null],
  ['chapel', 'week-2-2027', 'Chapel', 10, false, null],
];

for (const [id, parentId, title, order, submissionsOpen, sectionLayout] of nodes) {
  await put(`programEvents/${id}`, {
    programId: 'summercamp',
    parentId,
    slug: id,
    title,
    description: `${title} — local test copy.`,
    startAt: day(-30, 9),
    endAt: day(-26, 16),
    timeZone: 'America/New_York',
    order,
    // Left empty everywhere except the year, below: an uncurated level is the
    // ordinary state and the automatic spread is the code path worth seeing.
    featuredMediaIds: [],
    ...(sectionLayout ? { sectionLayout } : {}),
    /*
     * Week 1 carries a second block, so the multi-block path renders locally.
     *
     * A page is one set of photographs and a list of ways to show it: the grid
     * above and this wheel draw the *same* set. `showAllPictures` below makes that
     * set every approved photograph in the week — its own, its three days', and
     * the hike inside Day 2 — which is the combination worth seeing locally,
     * because a capped grid and an uncapped wheel of the same set is exactly what
     * the two together are for.
     *
     * An **upright** wheel at half width, so it lands beside the half-width grid
     * above rather than under it. That pairing is what `width` exists for, and a
     * seed that never produces it means nobody sees the case until they drag one.
     */
    ...(id === 'week-1-2027'
      ? {
          bands: [
            {
              id: 'band-everything',
              title: 'The same photographs, turning',
              layout: {
                display: 'column',
                scale: 'large',
                width: 'half',
                drift: true,
                title: { scale: 'small', placement: 'above', align: 'start' },
                caption: { scale: 'small', placement: 'hidden', align: 'start' },
              },
            },
          ],
        }
      : {}),
    // Week 1 shows everything beneath it rather than a selection, so the wheel it
    // carries has something worth turning through.
    ...(id === 'week-1-2027' ? { showAllPictures: true } : {}),
    coverMediaId: null,
    calendarEventId: null,
    submissionsOpen,
    published: true,
    publishAt: null,
    ...audit(),
  });
}

/*
 * The photographs, as `[id, node, file, status, placement, layout]`.
 *
 * One node id, not an event and a group: filing a photograph is a pointer at a
 * level of the tree now, at whatever depth that level sits.
 *
 * Shapes are spread on purpose: a panorama, two portraits and a run of ordinary
 * landscapes are what make auto-layout produce something other than a uniform
 * grid, so a uniform grid on screen means the packer is not running. The files
 * are the site's own images — no new binaries — and their real dimensions are
 * read off disk below.
 *
 * `m-05` is pinned by hand: it is the fixture that proves a dragged photograph
 * survives a reload rather than being re-packed.
 *
 * The distribution is the fixture, not padding. Every case the summaries have to
 * get right is here:
 *
 *  - **Photographs at five different depths**, so `/events/summercamp` has to
 *    spread its page across two weeks it cannot see directly, and Day 2 has to
 *    reach into The hike.
 *  - **`m-14` filed on Week 2 itself**, which is a branch. It appears in Week
 *    2's own "Also from here" block — the case that used to be "Also from this
 *    gathering", and the reason it exists is that an unfiled submission is
 *    otherwise invisible on the only page that could show it.
 *  - **Two weeks with different names underneath**, so the picker has to name a
 *    level by its whole trail rather than by its own title.
 *  - **Three pending**, on Week 1, so bulk selection in the approval queue has
 *    something to act on.
 */
const ON_PAGE = { onPage: true, slideshow: true, homepage: false };
const SHOWCASE = { onPage: true, slideshow: true, homepage: true };
const SLIDESHOW_ONLY = { onPage: false, slideshow: true, homepage: false };
const NOWHERE = { onPage: false, slideshow: false, homepage: false };

const shots = [
  // Week 1 — Day 1
  ['m-01', 'day-1', 'backdrop-domes-1600', 'approved', SHOWCASE, null],
  ['m-02', 'day-1', 'icon-crucifixion-1200', 'approved', ON_PAGE, null],
  ['m-03', 'day-1', 'hero-glass-portrait-600', 'approved', ON_PAGE, null],
  // Week 1 — Day 2
  ['m-04', 'day-2', 'backdrop-giving-1600', 'approved', ON_PAGE, null],
  ['m-05', 'day-2', 'backdrop-towers-1600', 'approved', ON_PAGE,
    { col: 1, row: 1, colSpan: 6, rowSpan: 4 }],
  ['m-06', 'day-2', 'home-sanctuary-1600', 'approved', SLIDESHOW_ONLY, null],
  /*
   * Five more in Day 2, and the reason is the rail rather than the photographs.
   *
   * Day 2 is seeded as a sideways rail, and with two pictures in it a rail does
   * not overflow — so it renders as a static row, `copies` stays at 1, and the
   * drift and the loop, which are the whole feature, cannot be seen locally at
   * all. Seven pictures at `scale: large` is comfortably wider than a laptop.
   */
  ['m-16', 'day-2', 'home-sanctuary-1000', 'approved', ON_PAGE, null],
  ['m-17', 'day-2', 'hero-glass-1000', 'approved', ON_PAGE, null],
  ['m-18', 'day-2', 'hero-glass-portrait-800', 'approved', ON_PAGE, null],
  ['m-19', 'day-2', 'home-sanctuary-2400', 'approved', ON_PAGE, null],
  ['m-20', 'day-2', 'hero-towers-portrait-600', 'approved', ON_PAGE, null],
  // The fifth level, inside Day 2. Day 2's page summarises these alongside its
  // own, which is what a level one step from the bottom has to do.
  ['m-23', 'the-hike', 'backdrop-towers-800', 'approved', SHOWCASE, null],
  ['m-24', 'the-hike', 'hero-towers-1000', 'approved', ON_PAGE, null],
  // Week 1 — Talent Show
  ['m-07', 'talent-show', 'sketch-face-800', 'approved', SHOWCASE, null],
  ['m-11', 'talent-show', 'sketch-christ-800', 'approved', ON_PAGE, null],
  ['m-21', 'talent-show', 'home-sanctuary-portrait-900', 'approved', ON_PAGE, null],
  ['m-22', 'talent-show', 'hero-glass-1600', 'approved', ON_PAGE, null],
  // Week 2, so the ministry's spread has a second week to reach.
  ['m-12', 'chapel', 'hero-towers-portrait-900', 'approved', ON_PAGE, null],
  ['m-13', 'chapel', 'hero-glass-1000', 'approved', ON_PAGE, null],
  // Filed on Week 2 itself rather than inside it: the "Also from here" case.
  ['m-14', 'week-2-2027', 'cross-coptic-360', 'approved', ON_PAGE, null],
  // The approval queue. Three waiting, so bulk selection has something to act on.
  ['m-08', 'week-1-2027', 'backdrop-domes-800', 'pending', NOWHERE, null],
  ['m-09', 'week-1-2027', 'hero-towers-1000', 'pending', NOWHERE, null],
  ['m-10', 'week-1-2027', 'home-sanctuary-portrait-600', 'pending', NOWHERE, null],
];

/**
 * One clip, so the video path is reachable at all.
 *
 * Its poster is a real image and its `renditionPath` is a real mp4 — generated
 * here rather than committed, because a checked-in video is the one binary that
 * would make this repo unpleasant to clone. `ffmpeg` writes it if it is
 * installed; without it the document is still seeded and the poster still
 * renders, which is exactly the state a transcode-in-progress produces and worth
 * being able to see.
 */
const CLIP = {
  id: 'm-15',
  node: 'talent-show',
  poster: 'sketch-christ-800',
  seconds: 6,
};

let uploaded = 0;
let clipBytes = null;

for (const [id, node, file, status, placement, layout] of shots) {
  const approved = status === 'approved';
  const source = `${IMAGE_DIR}/${file}.webp`;
  const { width, height } = webpSize(source);

  /*
   * Only an approved photograph gets a public object, and that is the quarantine
   * modelled rather than a shortcut: `renditionPath` is null until approval, and
   * the bytes live under `submissions/` — unreadable to the public — until then.
   * `previewPath` is what the approval queue displays, which is why a pending
   * item needs one or the queue shows three grey boxes.
   */
  const rendition = approved ? `galleries/summercamp/${node}/${id}.webp` : null;
  const preview = approved ? null : `submissions/${node}/${id}-preview.webp`;

  if (rendition) await upload(rendition, source, 'image/webp');
  if (preview) await upload(preview, source, 'image/webp');
  uploaded += 1;

  await put(`galleryMedia/${id}`, {
    programId: 'summercamp',
    programEventId: node,
    // Legacy, and written null on purpose: filing is `programEventId` now. See
    // the note on `GalleryMedia.groupId`.
    groupId: null,
    kind: 'photo',
    status,
    sourcePath: `submissions/${node}/${id}.heic`,
    renditionPath: rendition,
    posterPath: null,
    previewPath: preview,
    width,
    height,
    durationSeconds: null,
    caption: approved ? CAPTIONS[id] ?? `Local test photograph ${id}` : '',
    focal: { x: 0.5, y: 0.5 },
    placement,
    layout,
    order: Number(id.slice(2)) * 10,
    submittedAt: day(-20, 12),
    reviewedAt: approved ? day(-19, 9) : null,
    reviewedBy: approved ? 'seed' : null,
    ...audit(),
  });
}

{
  const poster = `${IMAGE_DIR}/${CLIP.poster}.webp`;
  const { width, height } = webpSize(poster);
  const posterPath = `galleries/summercamp/${CLIP.node}/${CLIP.id}-poster.webp`;
  const clipPath = `galleries/summercamp/${CLIP.node}/${CLIP.id}.mp4`;

  await upload(posterPath, poster, 'image/webp');
  clipBytes = await makeClip(CLIP.seconds);
  if (clipBytes) await uploadBytes(clipPath, clipBytes, 'video/mp4');

  await put(`galleryMedia/${CLIP.id}`, {
    programId: 'summercamp',
    programEventId: CLIP.node,
    groupId: null,
    kind: 'video',
    status: 'approved',
    sourcePath: `submissions/${CLIP.node}/${CLIP.id}.mov`,
    renditionPath: clipPath,
    posterPath,
    previewPath: null,
    width,
    height,
    durationSeconds: CLIP.seconds,
    caption: 'A clip, so the video path is reachable',
    focal: { x: 0.5, y: 0.5 },
    placement: ON_PAGE,
    layout: null,
    order: 150,
    submittedAt: day(-20, 12),
    reviewedAt: day(-19, 9),
    reviewedBy: 'seed',
    ...audit(),
  });
}

// --- done -------------------------------------------------------------------

console.log(`Seeded the emulators at ${FIRESTORE}:

  ${pages.length} content pages, ${events.length} events, 1 announcement
  ${programs.length} programs, ${nodes.length} levels beneath them (Summercamp is 5 deep)
  ${shots.length} photographs + 1 clip, with real bytes in the Storage emulator (3 awaiting approval)${
    clipBytes ? '' : '\n  the clip has no video file — install ffmpeg to seed one'
  }
  ${products.length} bookstore products (+1 unpublished draft)
  ${forms.length} forms at /forms (all published locally; three are drafts in production)
  config/parish, config/integrations, and config/theme
  ${breeze ? 'servantsConfig/schedule (Breeze)' : 'servantsConfig/schedule SKIPPED — set SPSM_BREEZE_EMBED_URL to include it'}

Sign in from the masthead: "Sign in with Microsoft" lists these in the
emulator's IdP widget. (Password  emulator-only  also works where a form asks.)

  admin@spsmwayland.org      admin    — everything, including role changes
  staff@spsmwayland.org      staff    — the events admin
  servant@spsmwayland.org    servant  — the schedule only
  father@spsmwayland.org     staff + clergy
  lead@spsmwayland.org       servant  — all of Summercamp, via a program grant
  volunteer@spsmwayland.org  servant  — Summercamp Week 1 only

Now run:  NEXT_PUBLIC_USE_EMULATORS=1 npm run dev`);
