/**
 * Fill the emulators with enough to click around the whole site.
 *
 * Local development only. It writes through the emulator's admin bypass and
 * refuses to run against anything that is not localhost, because every safety
 * rail in `firestore.rules` is off in this path.
 *
 * Why this exists: `npm run dev` reads the real Firestore, which is right for
 * the public pages and useless for anything behind sign-in — the admin and the
 * servants schedule both need a signed-in user with an allocation, and against
 * the real project the only way to get one is to be a member of the parish
 * Entra directory. Against the emulators you can be anyone, and Delete is not
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
 * Optional, for the calendar:
 *   SPSM_BREEZE_PARISH_EMBED_URL=...  the public church calendar
 *   SPSM_BREEZE_EMBED_URL=...         the servants calendar
 * Both are bearer credentials, so neither is ever committed — see
 * docs/integrations.md. Note that seeding these only helps if the *Functions*
 * emulator is running too: /calendar reads them through `/api/calendar`, never
 * directly.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_SCREENS,
  DEFAULT_INTEGRATIONS_CONFIG,
  DEFAULT_PARISH_CONFIG,
  DEFAULT_THEME,
  campFinanceDocId,
  formFinanceDocId,
  isAllowedEmbedUrl,
  rollupCampFinance,
  rollupFormFinance,
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
 * A sign-in-able account. Idempotent across re-runs.
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
async function user(email, superadmin, screens) {
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
  /*
   * Both claims. `screens` is the mirror `storage.rules` reads — see
   * packages/shared/src/claims.ts — and it is written here rather than left to
   * `mirrorGrantsToClaims`, because that trigger only runs when the Functions
   * emulator is up and this script is routinely used without it. Seeding it by
   * hand means picture uploads work locally either way; the trigger keeps it
   * right afterwards.
   */
  await authPost(`projects/${PROJECT}/accounts:update`, {
    localId: uid,
    password: 'emulator-only',
    customAttributes: JSON.stringify({ superadmin, screens }),
  });
  return uid;
}

/** A complete screen map with the named areas granted. */
function screenMap(granted) {
  return Object.fromEntries(ADMIN_SCREENS.map((s) => [s, granted.includes(s)]));
}

const audit = (uid = null) => ({ createdAt: new Date(), updatedAt: new Date(), updatedBy: uid });

// --- accounts ---------------------------------------------------------------

/*
 * Six accounts, and between them they cover the whole model.
 *
 * There are no roles any more, so every one of these is "signed in, plus what
 * they were allocated" — which means the fixtures have to *be* the allocations
 * rather than four rungs of a ladder. What each account is for:
 *
 *   admin@      the one `superadmin` claim. The only account that can open
 *               /access, and the only one that reaches anything it was not
 *               explicitly given.
 *   staff@      the everyday development identity: every delegable area at
 *               once, plus the camp's ministry. Not a tier — it is ten ticked
 *               boxes, and the point of it is that it looks exactly like a
 *               person who was given ten boxes, because that is now all it is.
 *   camp@       the camp's back office and nothing else: the `camp` flag, no
 *               `finance`, no program grant. The fixture for the split made on
 *               2 Sep 2026 — it is the only way to see /admin/camp as a
 *               registrar, which is the screen with the money taken out of it,
 *               and to check that the camp's gallery and event pages stay
 *               closed to somebody holding children's medical notes.
 *   treasurer@  `finance` narrowed to the camp: the other half of that split.
 *               Sees the camp's totals on /admin/finance and cannot open a
 *               registration.
 *   servant@    signed in and allocated nothing. The most important fixture on
 *               this list: it is what almost every account in the parish will
 *               be, and the only thing it can reach is the servants' rota.
 *   father@     one area. Proves that a single flag opens its own screen and
 *               nothing beside it, which was untestable while `staff` existed.
 *   lead@       a whole program, and no screen at all. Since the camp became a
 *               screen flag this is also the fixture that proves the camp's
 *               *ministry* — its page, its gatherings, its photographs — opens
 *               none of its paperwork.
 *   volunteer@  one *event* inside a program. Must not inherit week 2 — see the
 *               rules tests.
 *
 * The last two are the program-gallery axis, which cannot be exercised any
 * other way: a grant is a list of ids on a member document, and "the youth
 * servant can reach Summercamp but not St. Simon" is invisible until you sign
 * in as somebody holding exactly that.
 */

// Everything /access can hand out. `members` and `config` are deliberately not
// here — they are the superadmin's, and the allocation screen does not offer
// them. See packages/shared/src/screens.ts.
const EVERY_AREA = [
  'events', 'bulletin', 'bookstore', 'camp', 'forms', 'finance',
  'parking', 'servants', 'content', 'theme',
];

const accounts = [
  ['admin@spsmwayland.org', true, [], null],
  ['staff@spsmwayland.org', false, EVERY_AREA, { programs: ['summercamp'], events: [] }],
  ['servant@spsmwayland.org', false, [], null],
  ['father@spsmwayland.org', false, ['content'], null],
  /*
   * The two halves of the camp, one account each.
   *
   * `camp@` runs the camp and is not the treasurer: /admin/camp opens, the
   * "Still owed" tile and the owed column are gone, and the editor offers one
   * box for taking a payment instead of a ledger. `treasurer@` is the reverse —
   * the camp's figures on /admin/finance and a permission error on any
   * registration. Neither can be simulated by ticking boxes on `staff@`, which
   * holds both.
   */
  ['camp@spsmwayland.org', false, ['camp'], null],
  ['treasurer@spsmwayland.org', false, ['finance'], null, { bookstore: false, camp: true, forms: false }],
  // Holds a whole program: every camp, this year and every year.
  ['lead@spsmwayland.org', false, [], { programs: ['summercamp'], events: [] }],
  // Helps with one week. Must not inherit week 2 — see the rules tests.
  ['volunteer@spsmwayland.org', false, [], { programs: [], events: ['week-1-2027'] }],
];
for (const [email, superadmin, screens, programAdmin, financeScopes] of accounts) {
  const uid = await user(email, superadmin, screens);
  await put(`members/${uid}`, {
    displayName: email.split('@')[0],
    email,
    phone: null,
    photoPath: null,
    // A display copy of the claim, for the allocation list at /access. Decides
    // nothing — rules read the token.
    superadminMirror: superadmin,
    authProvider: 'microsoft',
    notificationPrefs: { announcements: true, orderUpdates: false },
    /*
     * The authoritative map, and the thing this whole seed exists to make
     * clickable. `firestore.rules` reads it with a `get()` on every check, so
     * an account whose document lacks it can do nothing at all — which used to
     * be survivable, because the `staff` tier answered first.
     */
    screenAdmin: screenMap(screens),
    programAdmin: programAdmin ?? { programs: [], events: [] },
    /*
     * Which part of the church's money, and **only** written when a fixture
     * says so.
     *
     * An absent map reads as all three — see `FINANCE_SOURCES` in
     * packages/shared/src/screens.ts, and the grandfathering it exists for. So
     * writing `{bookstore:false,camp:false,forms:false}` for every account
     * would make the *unnarrowed* case, which is every real treasurer in the
     * parish, the one shape this seed could not produce.
     */
    ...(financeScopes ? { financeScopes } : {}),
    ...audit(),
  });
}

// --- configuration ----------------------------------------------------------

await put('config/integrations', DEFAULT_INTEGRATIONS_CONFIG);
await put('config/parish', {
  ...DEFAULT_PARISH_CONFIG,
  // The address and service times were confirmed by the parish on 2026-08-18
  // and are published in `config/parish`, so these match production rather than
  // standing in for it. The three liturgies are all called "Divine Liturgy" and
  // the midweek one is Tuesday — corrected here and in production on 2026-09-02,
  // because this file said Wednesday and had a Vespers that is not a fixture.
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
    { name: 'Divine Liturgy', day: 'Sunday', time: '8:00 – 11:30 AM' },
    { name: 'Divine Liturgy', day: 'Tuesday', time: '7:00 – 9:15 AM' },
    { name: 'Divine Liturgy', day: 'Saturday', time: '8:00 – 10:00 AM' },
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

/*
 * Summer camp: a season, a fee, and a waiver to agree to.
 *
 * Seeded with *real* values rather than the committed defaults, which are
 * deliberately empty — a fee of zero and no waiver text is the right production
 * default (see `defaultCampConfig`) and the wrong local one, because both of
 * those branches disable half the registration screen. `lead@spsmwayland.org`
 * already holds the `summercamp` program grant, so signing in as them is what
 * opens the drawer.
 *
 * The waiver text below is placeholder prose. The parish's own has not been
 * written yet, and this must not be mistaken for it.
 */
await put('config/camp', {
  programId: 'summercamp',
  season: '2027',
  baseCents: 17500,
  // The servants' shirt money, and the reason the sign-up form's card step is
  // reachable locally at all. Zero is the production default and it switches
  // the whole step off — which is a state worth being able to see, but not the
  // one to develop the form against. See `CampConfig.servantChargeCents`.
  servantChargeCents: 2000,
  servantChargeLabel: 'Servant shirt',
  weeks: 2,
  // Real dates, because every camp screen now shows a day as a date and the
  // fallback wording ("Week 1 · Mon") is what you get with these blank — which
  // is a state worth being able to see, but not the default one to develop
  // against. Two consecutive Mondays in June 2027.
  weekStarts: ['2027-06-21', '2027-06-28'],
  // What the sign-up form offers: a list per week — the second week's camp is
  // not the first's — and a list per half of the camp, because elementary and
  // middle school do not run the same stations. Keyed `w1_elementary` because
  // Firestore has no array of arrays and a field path cannot hold a hyphen;
  // see `CampConfig.weekRoles`.
  //
  // Week two's middle school is deliberately the odd one out — a trip instead
  // of the pool — so a local sign-up form that showed one list for both halves
  // would be visibly wrong rather than plausibly right. Leaving a list out is
  // legal and shows the standard suggestions, which is a state worth being able
  // to see but not the one to develop against.
  //
  // These are also the **stations** on the groups board: it draws one card per
  // role in this list, minus the crew wish — see `campStationRoles`. That is
  // why `w2_middle` is deliberately left saying `Group servant`, the spelling
  // this vocabulary used before 2 Sep 2026: it is the fixture that proves
  // `isCampCrewWish` still reads a stored answer, and without it nothing local
  // exercises that path.
  weekRoles: {
    w1_elementary: ['Crew leader', 'Arts and crafts', 'Story time', 'Kitchen', 'Music'],
    w1_middle: ['Crew leader', 'Sports', 'Bible study', 'Kitchen', 'Music'],
    w2_elementary: ['Crew leader', 'Arts and crafts', 'Water play', 'Kitchen', 'Photography'],
    w2_middle: ['Group servant', 'Sports', 'Trip chaperone', 'Kitchen', 'Photography'],
  },
  waiverVersion: 'local-placeholder',
  waiverText:
    'PLACEHOLDER — not the parish waiver. Local emulator text so the consent ' +
    'control can be exercised.\n\n' +
    'I give permission for my child to take part in the activities of the camp, ' +
    'and I authorise the camp to obtain emergency medical treatment if I cannot ' +
    'be reached.',
  note: '',
  // Open, matching the default. The public half of /forms/summer-camp — a
  // servant signing themselves up — is only reachable when this is true, and
  // seeding it false would make the local site look like the feature is broken.
  servantSignUp: true,
  // Open, likewise. Closed would make the New family button on
  // /admin/camp/registrations read as broken on a fresh local site.
  familyRegistration: true,
});

/*
 * A season's worth of camp registrations.
 *
 * Without these both camp screens are unusable locally, and in different ways:
 * the registration form at /forms/summer-camp opens on an empty list, and the
 * allocation board at /admin/camp/groups has literally nothing to arrange —
 * a drag-and-drop screen with no chips in it cannot be looked at, let alone
 * worked on. Neither can be filled by hand in any reasonable time, and the real
 * project's registrations are real children's medical notes.
 *
 * Deterministic on purpose. A linear congruential generator with a fixed seed
 * rather than `Math.random`, so re-seeding twice gives the same forty families —
 * which is what lets "that child was in group 2 a minute ago" be a real
 * observation rather than a coincidence, and what makes a screenshot from
 * yesterday comparable to one from today.
 *
 * The names are Coptic given names on ten surnames, which is what the parish's
 * own roster looks like; the repetition is deliberate, because two children
 * called Zaki in different groups is exactly the case a roster has to handle.
 */
{
  /*
   * Split by sex, and the split is not decoration.
   *
   * The groups board's balance reading is arithmetic over a stored `gender`
   * field, and a seed that picked the name and the sex independently produced a
   * board full of "Angela · B" and "Paul · G" — which reads as the feature
   * being broken, every time, to anybody looking at it. So the name is drawn
   * from whichever list the sex chose. See `nameFor`.
   */
  const FIRST_MALE = ['Peter','Youssef','Mina','George','Kirollos','Abanoub','Philopater','Bishoy','Mark','Karas','Antonious','David','Fady','Joseph','Simon','Andrew','Michael','Daniel','Samuel','Paul'];
  const FIRST_FEMALE = ['Mariam','Anne','Sara','Marina','Veronica','Monica','Christine','Nardine','Verena','Sandra','Angela','Marianne','Nourhan','Rita','Demiana','Martha','Salma','Hana','Yostina','Irene'];
  const FIRST = [...FIRST_MALE, ...FIRST_FEMALE];

  /** A first name that agrees with the sex. Unrecorded draws from the lot. */
  const nameFor = (gender) =>
    pick(gender === 'male' ? FIRST_MALE : gender === 'female' ? FIRST_FEMALE : FIRST);
  const LAST = ['Guirguis','Awadalla','Hanna','Basilious','Ibrahim','Shenouda','Zaki','Malak','Rizk','Tadros'];
  // K to 8th, which is the camp. Pre-K was dropped on 30 Aug 2026 and seeding
  // it would keep producing children no panel is eligible to hold.
  const GRADES = ['k','1','2','3','4','5','6','7','8'];
  const CHILD_SIZES = ['YXS','YS','YM','YL','YXL','AS','AM'];
  const ADULT_SIZES = ['AS','AM','AL','AXL'];
  // Servants from 15 to 45, so the allocation board has real ages to show and
  // the teenage half of the roster is visible at a glance.
  const SERVANT_BIRTH_YEARS = [1982, 1990, 1996, 2001, 2005, 2008, 2010, 2011, 2012];
  // What a servant asked for. Half of these have to *match a station's name* or
  // the satisfaction meter on the groups board reads zero everywhere — so these
  // are the roles above, plus one crew wish and one ('Crafts') that matches
  // nothing, which is the case the meter has to show as a miss.
  const ROLES = ['Sports','Crafts','Kitchen','Music','Crew leader','Photography'];
  const WEEK_ONE = ['w1-mon','w1-tue','w1-wed','w1-thu','w1-fri'];

  let state = 7;
  const rand = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (list) => list[Math.floor(rand() * list.length)];

  /*
   * Kept so the finance rollup below can be computed from the same
   * registrations rather than from made-up figures. See `seedFinance`.
   */
  const registered = [];

  /*
   * What a family has been charged and what they have paid.
   *
   * Deliberately uneven. Every family paid in full would make the finance
   * screen's "still owed" column permanently zero and its by-method breakdown a
   * single bar — which is exactly the state in which nobody notices that the
   * arithmetic is wrong. So: most have paid, some part-paid, a couple not at
   * all, one refunded, and the methods are spread across the list the camp
   * actually uses.
   */
  const METHODS = ['cash', 'check', 'zelle', 'square'];
  const RATE = 17500;

  /*
   * Payment dates are relative to today, not fixed to the season's own summer.
   *
   * The finance screen opens on the current month, and a seed whose every
   * payment landed in June 2027 would show a treasurer three zeroes on a laptop
   * — which is indistinguishable from the rollup being broken, and is the one
   * state this seed exists to avoid. Money arrives when it arrives; dating it
   * near now is no less true than dating it in a summer that has not happened.
   */
  const monthsBack = (count, dayOfMonth) => {
    const now = new Date();
    const when = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - count, 1));
    const day = String(1 + (dayOfMonth % 27)).padStart(2, '0');
    return `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, '0')}-${day}`;
  };
  function familyBilling(index, kids) {
    const due = RATE * kids; // One week each, which is what the seed gives them.
    const payments = [];
    const how = index % 7;

    if (how !== 3 && how !== 6) {
      payments.push({
        id: `pay-${index}-1`,
        // Every seventh family has paid half; the rest paid in full.
        amountCents: how === 5 ? Math.round(due / 2) : due,
        method: METHODS[index % METHODS.length],
        reference: `seed-${index}`,
        receivedOn: monthsBack(index % 3, index),
        note: '',
        recordedByUid: 'seed',
        recordedAt: new Date(),
      });
    }
    // One family was refunded a week, recorded as a negative line rather than
    // by deleting the payment — which is the shape the real ledger uses.
    if (how === 1 && index > 7) {
      payments.push({
        id: `pay-${index}-2`,
        amountCents: -RATE,
        method: METHODS[index % METHODS.length],
        reference: `seed-refund-${index}`,
        receivedOn: monthsBack(0, index + 4),
        note: 'Withdrew after week one.',
        recordedByUid: 'seed',
        recordedAt: new Date(),
      });
    }

    return { baseCents: RATE, discounts: [], payments };
  }

  for (let f = 0; f < 24; f += 1) {
    const surname = LAST[f % LAST.length];
    const children = [];
    for (let c = 0, kids = 1 + Math.floor(rand() * 2.6); c < kids; c += 1) {
      const gender = rand() < 0.12 ? '' : rand() < 0.5 ? 'male' : 'female';
      children.push({
        id: `child-${f}-${c}`,
        firstName: nameFor(gender),
        lastName: surname,
        dateOfBirth: '',
        grade: pick(GRADES),
        /*
         * Boys and girls, and a few with nothing recorded.
         *
         * The same argument as the allergies below: the groups board's whole
         * balance reading is arithmetic over this field, and a seed where
         * everybody is a boy makes the tally look right while proving nothing.
         * The one-in-eight blank is the state of every registration taken
         * before the field existed, which is what the loud `?` on a chip is
         * there for.
         */
        gender,
        shirtSize: pick(CHILD_SIZES),
        days: WEEK_ONE,
        // Roughly one child in six, which is about right for a parish camp and
        // is what makes the allergy mark on the allocation board testable.
        allergies: rand() < 0.18 ? 'Peanuts & tree nuts' : '',
        medicalNotes: rand() < 0.1 ? 'Inhaler — morning and evening' : '',
        groupName: '',
        note: '',
      });
    }

    await put(`campRegistrations/reg-seed-${f}`, {
      programId: 'summercamp',
      season: '2027',
      kind: 'family',
      status: 'registered',
      contact: {
        name: `${pick(FIRST)} ${surname}`,
        email: `${surname.toLowerCase()}@example.org`,
        phone: `508-555-01${String(f).padStart(2, '0')}`,
        altName: '', altPhone: '',
        address: '169 Rice Rd, Wayland MA 01778',
      },
      emergency: { name: `${pick(FIRST)} ${pick(LAST)}`, phone: `508-555-02${String(f).padStart(2, '0')}`, relationship: 'Aunt' },
      children,
      servant: null,
      waiver: {
        version: 'local-placeholder', agreed: true,
        signedName: `${surname} parent`, signedRelationship: 'Parent',
        signedAt: new Date(), signedByUid: 'seed',
      },
      billing: familyBilling(f, children.length),
      note: '',
      takenByUid: 'seed',
      ...audit(),
    });

    registered.push({
      kind: 'family',
      status: 'registered',
      children,
      billing: familyBilling(f, children.length),
    });
  }

  for (let n = 0; n < 14; n += 1) {
    // Alternating rather than random, so the half's servant balance is a number
    // a test can be written against. Two of the fourteen are left unrecorded,
    // for the same reason a few of the children are.
    const gender = n % 7 === 3 ? '' : n % 2 ? 'female' : 'male';
    await put(`campRegistrations/reg-seed-s${n}`, {
      programId: 'summercamp',
      season: '2027',
      kind: 'servant',
      status: 'registered',
      contact: {
        // Agreeing with the sex below — see `nameFor`.
        name: `${nameFor(gender)} ${pick(LAST)}`,
        email: `servant${n}@example.org`,
        phone: `508-555-03${String(n).padStart(2, '0')}`,
        altName: '', altPhone: '', address: '',
      },
      emergency: { name: 'Parent', phone: '508-555-0400', relationship: 'Parent' },
      children: [],
      servant: {
        uid: null,
        dateOfBirth: `${SERVANT_BIRTH_YEARS[n % SERVANT_BIRTH_YEARS.length]}-0${1 + (n % 9)}-1${n % 10}`,
        gender,
        sections: n % 3 === 0 ? ['elementary', 'middle-school'] : n % 2 ? ['elementary'] : ['middle-school'],
        // Per week and per half of the camp, as the form now asks it — see
        // `campWeekRoleKey`. Only the halves in `sections` above get a key,
        // because a wish filed under a half somebody is not serving is exactly
        // what the sectioned keys exist to stop. Everybody seeded here comes in
        // week one only, so a `w2` key would be an answer about a week they are
        // not coming to, which the form would flag.
        desiredRolesByWeek: Object.fromEntries(
          (n % 3 === 0
            ? ['elementary', 'middle']
            : n % 2
              ? ['elementary']
              : ['middle']
          ).map((half) => [`w1_${half}`, [pick(ROLES)]]),
        ),
        assignedRoles: [],
        shirtSize: pick(ADULT_SIZES),
        days: WEEK_ONE,
        availability: n % 3 === 0 ? 'Mornings only' : n % 2 ? 'Can drive on the Friday' : '',
        // Not everybody, so the "not cleared" mark on the board has something
        // to mark.
        cleared: rand() < 0.7,
        clearedNote: '',
      },
      waiver: {
        version: 'local-placeholder', agreed: true,
        signedName: 'Self', signedRelationship: 'Self',
        signedAt: new Date(), signedByUid: 'seed',
      },
      billing: { baseCents: 0, discounts: [], payments: [] },
      note: '',
      takenByUid: 'seed',
      ...audit(),
    });

    registered.push({
      kind: 'servant',
      status: 'registered',
      children: [],
      billing: { baseCents: 0, discounts: [], payments: [] },
    });
  }

  /*
   * The finance rollup, computed here rather than hardcoded.
   *
   * In production these documents are written hourly by
   * `functions/src/finance.ts`, because the collection they summarise holds
   * children's medical notes and no browser may read it. Locally the Functions
   * emulator is usually not running — and pointing it at the emulated Firestore
   * takes care it does not always get — so /admin/finance would open on
   * "nothing has been added up yet" for ever.
   *
   * Run through the *same* pure function the Function uses, so what is seeded
   * here is what production would compute from these registrations. Hardcoding
   * plausible-looking totals would make the screen developable and its
   * arithmetic untestable at the same time.
   */
  await put(
    `financeRollups/${campFinanceDocId('summercamp', '2027')}`,
    {
      ...rollupCampFinance({ programId: 'summercamp', season: '2027', registrations: registered }),
      computedAt: new Date(),
    },
  );
}

/*
 * The two Breeze calendars. Read only by the `calendar` Function, never by a
 * browser — which is why seeding this alone does nothing visible unless the
 * Functions emulator is up as well.
 */
const breezeServants = process.env.SPSM_BREEZE_EMBED_URL;
const breezeParish = process.env.SPSM_BREEZE_PARISH_EMBED_URL;
const keep = (url) => (url && isAllowedEmbedUrl(url) ? url : '');

if (keep(breezeServants) || keep(breezeParish)) {
  await put('servantsConfig/schedule', {
    embedUrl: keep(breezeServants),
    parishEmbedUrl: keep(breezeParish),
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

/*
 * One paid form, locally only.
 *
 * No form the parish has written charges for anything, so without this the
 * payment half of the builder and the whole "Forms that charge" table on
 * /admin/finance are unreachable on a laptop — and an untried screen is one
 * that is discovered to be wrong by the treasurer. The same licence this script
 * already takes with `published: true` above: locally the point is to be able
 * to look at the thing.
 *
 * `van-request` is chosen because it is the least load-bearing of the five. It
 * is *not* payment-enabled in `seed-forms.mjs`, so nothing about the real
 * project changes.
 */
await put(`forms/van-request`, {
  ...forms.find((form) => form.slug === 'van-request'),
  published: true,
  payment: { enabled: true, baseCents: 4000, label: 'Van hire — fuel and cleaning' },
  ...audit(),
});

/*
 * And what it has taken, through the same pure function the hourly rollup uses.
 *
 * Not a hardcoded total, for the reason the camp's rollup above gives: a
 * plausible-looking number seeded by hand makes the screen developable and its
 * arithmetic untestable in the same stroke. The submissions themselves are not
 * seeded — they would be forty documents of invented answers, and the finance
 * screen is deliberately unable to read one.
 */
/** `YYYY-MM`, this month or an earlier one. See the note on `monthsBack`. */
function seedMonth(count) {
  const now = new Date();
  const when = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - count, 1));
  return `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, '0')}`;
}

await put(`financeRollups/${formFinanceDocId('van-request')}`, {
  ...rollupFormFinance({
    form: { id: 'van-request', slug: 'van-request', title: 'Van request' },
    submissions: [
      { totalCents: 4000, paymentId: 'sq-seed-1', month: seedMonth(1) },
      { totalCents: 4000, paymentId: 'sq-seed-2', month: seedMonth(1) },
      { totalCents: 4000, paymentId: 'sq-seed-3', month: seedMonth(0) },
      // One the charge never completed for — the case worth being able to see.
      { totalCents: 4000, paymentId: null, month: seedMonth(0) },
    ],
  }),
  computedAt: new Date(),
});

/*
 * A month of the bookstore, so the top band on /admin/finance has all three of
 * its lines rather than two and a zero.
 *
 * Written the way `functions/src/stats.ts` writes it — same doc id, same
 * `totals` shape — because the finance screen reads that document directly and
 * a differently-shaped local copy would hide a mismatch until production.
 */
{
  const month = new Date().toISOString().slice(0, 7);
  await put(`bookstoreStats/month-${month}`, {
    period: 'month',
    key: month,
    products: {},
    searches: {},
    zeroResultSearches: {},
    totals: {
      views: 412, details: 96, cartAdds: 34, cartRemoves: 6, checkoutStarts: 19,
      visitors: 180, orders: 14, unitsSold: 21, revenue: 38_400, refunded: 2_500,
      refundedOrders: 1, shippedOrders: 5, pickupOrders: 9, repeatBuyers: 3,
    },
    computedAt: new Date(),
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
    // A seeded photograph is a parishioner's, never an administrator's own —
    // the pending ones exist so the review queue has something in it.
    autoApproveBy: null,
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
    autoApproveBy: null,
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
  config/parish, config/integrations, config/theme, and config/camp
  ${breezeParish || breezeServants ? 'servantsConfig/schedule (Breeze)' : 'servantsConfig/schedule SKIPPED — set SPSM_BREEZE_PARISH_EMBED_URL and/or SPSM_BREEZE_EMBED_URL to include it'}

Sign in from the masthead: "Sign in with Microsoft" lists these in the
emulator's IdP widget. (Password  emulator-only  also works where a form asks.)

  admin@spsmwayland.org      superadmin — everything, and the only one who can
                                          allocate at /access
  staff@spsmwayland.org      every area — including the camp, plus its ministry
  servant@spsmwayland.org    nothing    — the servants' rota, and that is all
  father@spsmwayland.org     content    — one area, to see that one flag opens
                                          one screen
  camp@spsmwayland.org       the camp   — registrations, groups, register. No
                                          money on screen, and no gallery
  treasurer@spsmwayland.org  finance    — the camp's totals only. Cannot open a
                                          registration
  lead@spsmwayland.org       Summercamp as a ministry: its page, gatherings and
                             photographs — and none of its paperwork
  volunteer@spsmwayland.org  Summercamp Week 1 only

Now run:  NEXT_PUBLIC_USE_EMULATORS=1 npm run dev`);
