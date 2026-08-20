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
import {
  DEFAULT_INTEGRATIONS_CONFIG,
  DEFAULT_PARISH_CONFIG,
  DEFAULT_THEME,
  isAllowedEmbedUrl,
} from '../packages/shared/dist/index.js';
import { toFieldMap } from './lib/firestore-rest.mjs';
import { collectPages } from './lib/content-files.mjs';

const PROJECT = 'spsm-database';
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';

for (const [name, host] of [['Firestore', FIRESTORE], ['Auth', AUTH]]) {
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

/** A sign-in-able account with a role claim. Idempotent across re-runs. */
async function user(email, role, groups = []) {
  await authPost('accounts:signUp?key=fake', {
    email,
    password: 'emulator-only',
    returnSecureToken: true,
  });
  const found = await authPost(`projects/${PROJECT}/accounts:lookup`, { email: [email] });
  const uid = found.body.users?.[0]?.localId;
  if (!uid) throw new Error(`could not create or find ${email}`);
  await authPost(`projects/${PROJECT}/accounts:update`, {
    localId: uid,
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
// The photographs are references, not files: `renditionPath` points into the
// emulator's Storage bucket and nothing puts an image there. The gallery
// therefore renders its layout with broken images, which is the right trade —
// seeding real binaries would make this script slow and large, and the thing
// worth testing locally is the packing, the ordering and the permissions.

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
    order,
    published: true,
    publishAt: null,
    ...audit(),
  });
}

const GROUPS = [
  { id: 'day-1', name: 'Day 1', order: 10 },
  { id: 'day-2', name: 'Day 2', order: 20 },
  { id: 'talent-show', name: 'Talent Show', order: 30 },
];

// Week 1 takes submissions; week 2 does not, so the closed-form path is
// reachable without editing anything.
const programEvents = [
  ['week-1-2027', 'summercamp', 'Summercamp Week 1 2027', GROUPS, true],
  ['week-2-2027', 'summercamp', 'Summercamp Week 2 2027', [], false],
];
for (const [id, programId, title, groups, submissionsOpen] of programEvents) {
  await put(`programEvents/${id}`, {
    programId,
    slug: id,
    title,
    description: `${title} — local test copy.`,
    startAt: day(-30, 9),
    endAt: day(-26, 16),
    timeZone: 'America/New_York',
    groups,
    coverMediaId: null,
    calendarEventId: null,
    submissionsOpen,
    published: true,
    publishAt: null,
    ...audit(),
  });
}

/*
 * Aspect ratios are spread on purpose: a panorama, a portrait and a run of
 * ordinary snapshots are what make auto-layout produce something other than a
 * uniform grid, so a uniform grid on screen means the packer is not running.
 *
 * `m-05` is pinned by hand — it is the fixture that proves a dragged
 * photograph survives a reload rather than being re-packed.
 */
const shots = [
  ['m-01', 'day-1', 3.0, 'approved', { onPage: true, slideshow: true, homepage: true }, null],
  ['m-02', 'day-1', 1.5, 'approved', { onPage: true, slideshow: true, homepage: false }, null],
  ['m-03', 'day-1', 0.7, 'approved', { onPage: true, slideshow: true, homepage: false }, null],
  ['m-04', 'day-2', 1.5, 'approved', { onPage: true, slideshow: true, homepage: false }, null],
  ['m-05', 'day-2', 1.5, 'approved', { onPage: true, slideshow: true, homepage: false },
    { col: 1, row: 1, colSpan: 6, rowSpan: 4 }],
  ['m-06', 'day-2', 1.33, 'approved', { onPage: false, slideshow: true, homepage: false }, null],
  ['m-07', 'talent-show', 1.5, 'approved', { onPage: true, slideshow: true, homepage: true }, null],
  // The approval queue. Three waiting, so bulk selection has something to act on.
  ['m-08', null, 1.5, 'pending', { onPage: false, slideshow: false, homepage: false }, null],
  ['m-09', null, 1.5, 'pending', { onPage: false, slideshow: false, homepage: false }, null],
  ['m-10', null, 0.75, 'pending', { onPage: false, slideshow: false, homepage: false }, null],
];

for (const [id, groupId, aspect, status, placement, layout] of shots) {
  const approved = status === 'approved';
  await put(`galleryMedia/${id}`, {
    programId: 'summercamp',
    programEventId: 'week-1-2027',
    groupId,
    kind: 'photo',
    status,
    sourcePath: `submissions/week-1-2027/${id}.heic`,
    renditionPath: approved ? `galleries/summercamp/week-1-2027/${id}.webp` : null,
    posterPath: null,
    width: Math.round(1200 * (aspect >= 1 ? 1 : aspect)),
    height: Math.round(1200 * (aspect >= 1 ? 1 / aspect : 1)),
    durationSeconds: null,
    caption: approved ? `Local test photograph ${id}` : '',
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

// --- done -------------------------------------------------------------------

console.log(`Seeded the emulators at ${FIRESTORE}:

  ${pages.length} content pages, ${events.length} events, 1 announcement
  ${programs.length} programs, ${programEvents.length} program events, ${shots.length} photographs (3 awaiting approval)
  ${products.length} bookstore products (+1 unpublished draft)
  config/parish, config/integrations, and config/theme
  ${breeze ? 'servantsConfig/schedule (Breeze)' : 'servantsConfig/schedule SKIPPED — set SPSM_BREEZE_EMBED_URL to include it'}

Sign in at /admin or /servants with password  emulator-only

  admin@spsmwayland.org      admin    — everything, including role changes
  staff@spsmwayland.org      staff    — the events admin
  servant@spsmwayland.org    servant  — the schedule only
  father@spsmwayland.org     staff + clergy
  lead@spsmwayland.org       servant  — all of Summercamp, via a program grant
  volunteer@spsmwayland.org  servant  — Summercamp Week 1 only

Now run:  NEXT_PUBLIC_USE_EMULATORS=1 npm run dev`);
