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

const accounts = [
  ['admin@spsmwayland.org', 'admin', []],
  ['staff@spsmwayland.org', 'staff', []],
  ['servant@spsmwayland.org', 'servant', []],
  ['father@spsmwayland.org', 'staff', ['clergy']],
];
for (const [email, role, groups] of accounts) {
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
    ...audit(),
  });
}

// --- configuration ----------------------------------------------------------

await put('config/integrations', DEFAULT_INTEGRATIONS_CONFIG);
await put('config/parish', {
  ...DEFAULT_PARISH_CONFIG,
  // From the current Wix contact page. The phone differs between two Wix pages
  // (…3750 on /contact-us, …3570 on /team-3) and the parish has not said which
  // is right, so this is local test data rather than a fact to publish.
  address: { line1: '169 Rice Rd', line2: '', city: 'Wayland', state: 'MA', postalCode: '01778' },
  phone: '(508) 739-3750',
  email: 'info@spsmwayland.org',
  officeHours: 'Tuesday to Friday, 9:00 AM – 3:00 PM',
  serviceTimes: [
    { name: 'Matins & Divine Liturgy', day: 'Sunday', time: '8:00 – 11:30 AM' },
    { name: 'Vespers', day: 'Saturday', time: '6:00 PM' },
    { name: 'Midweek Liturgy', day: 'Wednesday', time: '8:00 – 10:00 AM' },
  ],
  // `social` is deliberately not overridden here. Unlike the address and phone
  // above — which are unverified scrapes from the old Wix pages and so must not
  // masquerade as real — the accounts in DEFAULT_PARISH_CONFIG came from the
  // parish and are correct, so the emulator should exercise exactly what
  // production renders.
  notes: 'Local emulator data — not the parish’s published details.',
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

// --- done -------------------------------------------------------------------

console.log(`Seeded the emulators at ${FIRESTORE}:

  ${pages.length} content pages, ${events.length} events, 1 announcement
  config/parish, config/integrations, and config/theme
  ${breeze ? 'servantsConfig/schedule (Breeze)' : 'servantsConfig/schedule SKIPPED — set SPSM_BREEZE_EMBED_URL to include it'}

Sign in at /admin or /servants with password  emulator-only

  admin@spsmwayland.org      admin    — everything, including role changes
  staff@spsmwayland.org      staff    — the events admin
  servant@spsmwayland.org    servant  — the schedule only
  father@spsmwayland.org     staff + clergy

Now run:  NEXT_PUBLIC_USE_EMULATORS=1 npm run dev`);
