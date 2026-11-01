/**
 * Bring the camp photo archive into the Summercamp gallery, once.
 *
 * The archive is years of camp photographs on the parish's shared drive. This
 * script reads them from a local copy of that folder (sync it with the drive's
 * desktop app first — nothing here talks to Microsoft or Google), files each one
 * under the right year and week, creates any year or week level that does not
 * exist yet, and publishes a web rendition of it to the gallery.
 *
 * ## Where a photograph goes, in order of trust
 *
 *  1. **The folder it is in.** A path like `2023/Week 2/IMG_0042.jpg` is a
 *     person's decision and beats anything a camera clock says. A year is any
 *     path segment containing `20xx`; a week is any segment containing
 *     `week 2`, `Week_2`, `week-2`.
 *  2. **Its capture date, against the week dates in `camp-weeks.json`.** EXIF
 *     `DateTimeOriginal`, compared as the plain calendar date the camera wrote.
 *  3. **The year alone**, from the folder or the date, when no week matches. The
 *     photograph is filed on the year level itself, which still shows it.
 *  4. **Nowhere.** No folder hint and no capture date: listed in the report and
 *     skipped, never guessed at.
 *
 * Run `--suggest` before you have the week dates: it groups the archive's
 * capture dates into runs separated by quiet days and prints a starting
 * `camp-weeks.json` to correct.
 *
 * ## What it writes, and why it skips the review queue
 *
 * Exactly what an approved submission ends up as — a WebP under `galleries/` and
 * a `galleryMedia` document with `status: 'approved'` pointing at it — produced
 * the same way `onGalleryMediaCreated` produces one: EXIF orientation applied,
 * every other bit of metadata stripped (GPS included; these are other people's
 * children), long edge capped at `PHOTO_MAX_EDGE`, quality `PHOTO_QUALITY`.
 *
 * It does not go through `submissions/`. That path exists to quarantine
 * strangers' uploads, and routing the parish's own archive through it would mean
 * an administrator clicking "approve" fifteen thousand times. Writing straight to
 * `galleries/` with your gcloud credentials is the same trust the approval
 * Function has, held by the person running this.
 *
 * Originals are not uploaded. The shared drive stays the archive; the bucket
 * only ever holds what the website serves.
 *
 * New levels are created **unpublished**. Look at them on the site in edit mode,
 * then publish each year when it is right.
 *
 * ## Idempotence
 *
 * A photograph's id is a hash of its bytes, so a re-run skips everything it
 * already imported, and the same photo sitting in two folders is imported once.
 * A level is matched by its parent and slug before one is created, so a year
 * somebody already made by hand in the editor is reused, not duplicated.
 *
 * Videos are listed and skipped — the gallery has no video transcode yet (see
 * the note on `onGalleryMediaCreated`).
 *
 * Usage:
 *   npm run import:camp -- <folder> --suggest          # propose week dates
 *   npm run import:camp -- <folder>                    # dry run, prints the plan
 *   npm run import:camp -- <folder> --write            # apply
 *   npm run import:camp -- <folder> --weeks other.json # a different weeks file
 *   npm run import:camp -- <folder> --folders scripts/camp-folders.json
 *                                     # only these subfolders (the real photos)
 *
 * Below a week, photographs are split into weekday pages ("Monday"): by capture
 * date when it falls inside that week, else by a day folder's name.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import sharp from 'sharp';
import { COLLECTIONS, PHOTO_MAX_EDGE, PHOTO_QUALITY } from '@spsm/shared';
import {
  accessToken,
  documentUrl,
  fromFirestore,
  toFieldMap,
} from './lib/firestore-rest.mjs';

process.loadEnvFile('.env');

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const write = args.includes('--write');
const suggest = args.includes('--suggest');
const weeksFile = flagValue('--weeks') ?? 'scripts/camp-weeks.json';
const foldersFile = flagValue('--folders');
const programId = flagValue('--program') ?? 'summercamp';
const root = args.find(
  (arg, i) => !arg.startsWith('--') && !args[i - 1]?.match(/^--(weeks|folders|program)$/),
);

const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

if (!root || !existsSync(root)) {
  console.error('Pass the synced camp folder: npm run import:camp -- "/path/to/Camp Photos"');
  process.exit(1);
}
if (!project || !bucket) {
  console.error('NEXT_PUBLIC_FIREBASE_PROJECT_ID / _STORAGE_BUCKET are not set. Is .env present?');
  process.exit(1);
}

function flagValue(name) {
  const at = args.indexOf(name);
  return at === -1 ? null : args[at + 1];
}

const PHOTO_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'tif', 'tiff']);
const VIDEO_EXTENSIONS = new Set(['mov', 'mp4', 'm4v', 'avi', '3gp']);

/** A URL-safe slug, matching `slugifyName` in the website's adminData. */
function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ---- reading the archive ----------------------------------------------------

/** Every file under `dir`, skipping dotfiles and macOS `._` resource forks. */
function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

/**
 * `DateTimeOriginal` out of a raw EXIF block, as `YYYY-MM-DD HH:MM:SS`.
 *
 * A real parse of the TIFF structure rather than a regex for the first date in
 * the buffer: IFD0 carries `DateTime`, which is when the file was last *edited*,
 * and a photo somebody cropped in 2024 would otherwise be filed under 2024.
 * Falls back to `DateTimeDigitized`, and never to that IFD0 `DateTime`: a photo
 * with no capture date is placed by its folder or reported, which beats being
 * quietly filed under the year somebody last opened it in an editor.
 */
function exifDate(exif) {
  if (!exif) return null;
  const start = exif.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? 6 : 0;
  const tiff = exif.subarray(start);
  if (tiff.length < 8) return null;
  const little = tiff.toString('latin1', 0, 2) === 'II';
  const u16 = (at) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));

  /** tag → value offset for one IFD. */
  const readIfd = (offset) => {
    const tags = new Map();
    if (offset + 2 > tiff.length) return tags;
    const count = u16(offset);
    for (let i = 0; i < count; i += 1) {
      const entry = offset + 2 + i * 12;
      if (entry + 12 > tiff.length) break;
      tags.set(u16(entry), { count: u32(entry + 4), value: u32(entry + 8) });
    }
    return tags;
  };
  const ascii = (tag) => {
    if (!tag || tag.value + 19 > tiff.length) return null;
    const text = tiff.toString('latin1', tag.value, tag.value + 19);
    const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(text);
    // Cameras with no clock set write zeros. That is no date, not year 0.
    if (!match || match[1] === '0000') return null;
    return `${match[1]}-${match[2]}-${match[3]} ${match[4]}`;
  };

  try {
    const ifd0 = readIfd(u32(4));
    const exifIfd = ifd0.has(0x8769) ? readIfd(ifd0.get(0x8769).value) : new Map();
    return ascii(exifIfd.get(0x9003)) ?? ascii(exifIfd.get(0x9004));
  } catch {
    return null;
  }
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Year, week and weekday named by the folders a file sits in, if any.
 *
 * A day folder is written every way the archive has it: `1Monday`, `3 Wednesday`,
 * `Friday`, and `Day 2` — which is counted from Monday, because camp runs Monday
 * to Friday and that is how the 2025 folders' dates line up.
 */
function folderHints(path) {
  const segments = relative(root, path).split(sep).slice(0, -1);
  let year = null;
  let week = null;
  let day = null;
  for (const segment of segments) {
    const y = /\b(20\d{2})\b/.exec(segment);
    if (y) year = y[1];
    const w = /\bweek[\s_-]*(\d+)\b/i.exec(segment);
    if (w) week = Number(w[1]);
    const named = /(sun|mon|tues|wednes|thurs|fri|satur)day/i.exec(segment);
    if (named) day = WEEKDAYS.findIndex((d) => d.toLowerCase().startsWith(named[1].toLowerCase()));
    const numbered = /^day[\s_-]*([1-7])$/i.exec(segment.trim());
    if (numbered) day = Number(numbered[1]) % 7;
  }
  return { year, week, day };
}

/** Weekday index of a `YYYY-MM-DD…` capture date. */
const weekdayOf = (date) => new Date(`${date.slice(0, 10)}T12:00:00Z`).getUTCDay();

const scratch = mkdtempSync(join(tmpdir(), 'camp-import-'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));

/**
 * Bytes sharp can decode.
 *
 * The prebuilt sharp has no HEVC decoder, so an iPhone HEIC fails to open. macOS
 * ships one, and `sips` converts through it at full quality; the EXIF block
 * comes across with it, so the capture date survives the detour.
 */
async function decodable(path, bytes) {
  try {
    await sharp(bytes).stats();
    return bytes;
  } catch (error) {
    if (process.platform !== 'darwin') throw error;
    const out = join(scratch, `${createHash('sha1').update(path).digest('hex')}.jpg`);
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '100', path, '--out', out], {
      stdio: 'ignore',
    });
    const converted = readFileSync(out);
    rmSync(out);
    return converted;
  }
}

// ---- the weeks file ---------------------------------------------------------

/**
 * `camp-weeks.json`, normalised.
 *
 *   { "2023": [ { "title": "Week 1", "start": "2023-07-09", "end": "2023-07-15" } ] }
 *
 * `start` and `end` are inclusive calendar dates. Missing file means "no dates
 * yet": folders and years still work, weeks only come from folder names.
 */
function loadWeeks() {
  if (!existsSync(weeksFile)) return {};
  const raw = JSON.parse(readFileSync(weeksFile, 'utf8'));
  const years = {};
  for (const [year, weeks] of Object.entries(raw)) {
    if (!/^20\d{2}$/.test(year)) continue;
    years[year] = weeks.map((week, index) => ({
      title: week.title ?? `Week ${index + 1}`,
      slug: slugify(week.title ?? `Week ${index + 1}`),
      start: week.start ?? null,
      end: week.end ?? week.start ?? null,
    }));
  }
  return years;
}

/** The level a photograph belongs to, as `{ year, week }` titles, or null. */
function place(hints, date, weeks) {
  const dateYear = date?.slice(0, 4) ?? null;
  const year = hints.year ?? dateYear;
  if (!year) return null;

  const configured = weeks[year] ?? [];
  if (hints.week) {
    const slug = `week-${hints.week}`;
    const known = configured.find((week) => week.slug === slug);
    return { year, week: known ?? { title: `Week ${hints.week}`, slug, start: null, end: null } };
  }
  // A capture date only places a photo in a week of *its own* year: a folder
  // saying 2023 beats a camera clock that was never set and thinks it is 2019.
  if (date && dateYear === year) {
    const day = date.slice(0, 10);
    const week = configured.find((w) => w.start && w.start <= day && day <= w.end);
    if (week) return { year, week };
  }
  return { year, week: null };
}

// ---- pass 1: read every file ------------------------------------------------

/*
 * `--folders camp-folders.json`: a list of folders under the root to import,
 * and nothing else. The parish's camp library also holds every curriculum kit
 * ever bought — clip art, posters, logos — in folders whose names say 2022 and
 * 2023 just as loudly as the photographs do, so "everything under the root"
 * would publish the clip art as camp photos.
 */
const included = foldersFile ? JSON.parse(readFileSync(foldersFile, 'utf8')) : null;
const files = included
  ? included.flatMap((folder) => {
      if (!existsSync(join(root, folder))) {
        console.error(`Listed in ${foldersFile} but not found: ${folder}`);
        process.exit(1);
      }
      return walk(join(root, folder));
    })
  : walk(root);
const photos = [];
const videos = [];
const others = [];

for (const path of files) {
  const extension = path.split('.').pop().toLowerCase();
  if (PHOTO_EXTENSIONS.has(extension)) photos.push(path);
  else if (VIDEO_EXTENSIONS.has(extension)) videos.push(path);
  else others.push(path);
}

console.log(
  `${photos.length} photographs, ${videos.length} videos (skipped), ` +
    `${others.length} other files (skipped) under ${root}.`,
);

/** Run `task` over `items`, `limit` at a time. */
async function pool(items, limit, task) {
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      await task(items[index], index);
      done += 1;
      if (done % 200 === 0) console.log(`  … ${done}/${items.length}`);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
}

const read = [];
const empty = [];
await pool(photos, 8, async (path) => {
  const bytes = readFileSync(path);
  /*
   * A file that is all zero bytes. 89 of 2024's photographs are exactly this —
   * the right size, a real name, and nothing in them — so they are counted and
   * named rather than left to fail one at a time inside sharp.
   */
  if (bytes.every((byte) => byte === 0)) {
    empty.push(path);
    return;
  }
  const id = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  let date = null;
  try {
    date = exifDate((await sharp(bytes).metadata()).exif);
  } catch {
    // Not decodable by sharp (HEIC). The date comes out in pass 3, after `sips`;
    // until then it can only be placed by its folder.
    if (path.match(/\.hei[cf]$/i) && process.platform === 'darwin') {
      try {
        date = exifDate((await sharp(await decodable(path, bytes)).metadata()).exif);
      } catch {}
    }
  }
  read.push({ path, id, date, hints: folderHints(path) });
});

// ---- --suggest: propose week dates, then stop -------------------------------

if (suggest) {
  const byYear = new Map();
  for (const photo of read) {
    if (!photo.date) continue;
    const year = photo.hints.year ?? photo.date.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, new Map());
    const days = byYear.get(year);
    const day = photo.date.slice(0, 10);
    days.set(day, (days.get(day) ?? 0) + 1);
  }

  /*
   * A run of days with photographs, broken by more than one empty day. Camp
   * weeks are usually back to back with a weekend between them, which is exactly
   * the gap this splits on. It will be wrong sometimes — a quiet Wednesday splits
   * a week in two — which is why it prints a draft to correct, not a file.
   */
  const skeleton = {};
  for (const [year, days] of [...byYear].sort()) {
    const sorted = [...days.keys()].sort();
    const runs = [];
    for (const day of sorted) {
      const last = runs.at(-1);
      const gap = last ? (Date.parse(day) - Date.parse(last.end)) / 86_400_000 : Infinity;
      if (gap <= 2) {
        last.end = day;
        last.count += days.get(day);
      } else {
        runs.push({ start: day, end: day, count: days.get(day) });
      }
    }
    console.log(`\n${year}`);
    for (const run of runs) console.log(`  ${run.start} → ${run.end}   ${run.count} photos`);
    skeleton[year] = runs
      .filter((run) => run.count >= 10)
      .map((run, i) => ({ title: `Week ${i + 1}`, start: run.start, end: run.end }));
  }
  const undated = read.filter((photo) => !photo.date).length;
  console.log(`\n${undated} photographs have no capture date and can only be placed by folder.`);
  console.log(`\nA starting ${weeksFile} (runs under 10 photos left out — check them):\n`);
  console.log(JSON.stringify(skeleton, null, 2));
  process.exit(0);
}

// ---- pass 2: plan -----------------------------------------------------------

const weeks = loadWeeks();
const authHeader = () => ({ Authorization: `Bearer ${token()}` });

/**
 * A gcloud token, refreshed every 40 minutes. They last an hour, and a full
 * archive takes longer than that to upload.
 */
let cachedToken = null;
let tokenAt = 0;
function token() {
  if (!cachedToken || Date.now() - tokenAt > 40 * 60_000) {
    cachedToken = accessToken();
    tokenAt = Date.now();
  }
  return cachedToken;
}

/** Every document in one collection, following the page tokens. */
async function listAll(collection) {
  const found = [];
  let pageToken = '';

  for (;;) {
    const url = new URL(documentUrl(project, collection));
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url, { headers: authHeader() });
    if (!response.ok) {
      throw new Error(`Could not list ${collection}: ${response.status} ${await response.text()}`);
    }
    const body = await response.json();
    for (const document of body.documents ?? []) {
      found.push({
        id: document.name.split('/').pop(),
        ...fromFirestore(document.fields ?? {}),
      });
    }
    pageToken = body.nextPageToken ?? '';
    if (!pageToken) return found;
  }
}

async function createDocument(collection, id, body) {
  const url = new URL(documentUrl(project, collection));
  url.searchParams.set('documentId', id);
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFieldMap(body) }),
  });
  if (!response.ok) {
    throw new Error(`Could not create ${collection}/${id}: ${await response.text()}`);
  }
}

/**
 * One object, with the cache header the approval Function sets — see the note
 * on `onGalleryMediaReviewed`. Multipart because a `media` upload cannot carry
 * metadata, and without it Storage serves `private, max-age=0`.
 */
async function upload(path, bytes) {
  const url = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o`);
  url.searchParams.set('uploadType', 'multipart');
  const boundary = `camp-${Date.now()}`;
  const metadata = JSON.stringify({
    name: path,
    contentType: 'image/webp',
    cacheControl: 'public, max-age=31536000, immutable',
  });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: image/webp\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!response.ok) throw new Error(`Could not upload ${path}: ${await response.text()}`);
}

const programResponse = await fetch(documentUrl(project, `programs/${programId}`), {
  headers: authHeader(),
});
if (!programResponse.ok) {
  console.error(`programs/${programId} does not exist. Run: node scripts/seed-programs.mjs -- --write`);
  process.exit(1);
}

const levels = (await listAll(COLLECTIONS.programEvents)).filter((e) => e.programId === programId);
const existingMedia = new Set((await listAll(COLLECTIONS.galleryMedia)).map((m) => m.id));

/** The calendar date `YYYY-MM-DD` as a Date at local midnight, or null. */
const day = (value, endOfDay = false) =>
  value ? new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}`) : null;

/** A level to create, unpublished and closed. Same shape as the tree migration's. */
function newLevel({ parentId, slug, title, order, startAt, endAt }) {
  return {
    programId,
    parentId,
    slug,
    title,
    description: '',
    startAt,
    endAt,
    timeZone: 'America/New_York',
    order,
    featuredMediaIds: [],
    coverMediaId: null,
    calendarEventId: null,
    submissionsOpen: false,
    published: false,
    publishAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedBy: null,
  };
}

const toCreate = new Map(); // id → level body

/**
 * An existing level under `parentId` that is the one we mean.
 *
 * By slug *or* by title, because levels made in the editor do not follow one
 * pattern: 2021's slug is `summer-camp-2021` where the later years' are bare,
 * and 2026's Week 1 has the slug `weeks`. Matching on slug alone created a
 * second 2021 and a second Week 1 in the dry run against the live tree.
 */
function findLevel(parentId, matches) {
  const all = [...levels, ...[...toCreate].map(([id, level]) => ({ id, ...level }))];
  return all.find((level) => (level.parentId ?? null) === parentId && matches(level))?.id;
}

function yearLevel(year) {
  const existing = findLevel(
    null,
    (level) => level.slug === year || slugify(level.slug).endsWith(`-${year}`) || slugify(level.title ?? '').endsWith(`-${year}`) || level.title === year,
  );
  if (existing) return existing;
  const id = `${programId}-${year}`;
  const configured = weeks[year] ?? [];
  const starts = configured.map((w) => w.start).filter(Boolean).sort();
  const ends = configured.map((w) => w.end).filter(Boolean).sort();
  toCreate.set(
    id,
    newLevel({
      parentId: null,
      slug: year,
      title: `Summer Camp ${year}`,
      // Newest camp first, continuing what the editor already has: 2026 is 10,
      // 2021 is 60, so 2020 lands at 70.
      order: (2027 - Number(year)) * 10,
      startAt: day(starts[0]),
      endAt: day(ends.at(-1), true),
    }),
  );
  return id;
}

function weekLevel(yearId, year, week) {
  const existing = findLevel(
    yearId,
    (level) => level.slug === week.slug || slugify(level.title ?? '') === week.slug,
  );
  if (existing) return existing;
  const id = `${yearId}-${week.slug}`;
  const number = Number(/\d+/.exec(week.slug)?.[0] ?? 99);
  toCreate.set(
    id,
    newLevel({
      parentId: yearId,
      slug: week.slug,
      title: week.title,
      order: number * 10,
      startAt: day(week.start),
      endAt: day(week.end, true),
    }),
  );
  return id;
}

/** A weekday page under a week: "Monday", ordered Monday first. */
function dayLevel(weekId, weekday) {
  const title = WEEKDAYS[weekday];
  const slug = title.toLowerCase();
  const existing = findLevel(
    weekId,
    (level) => level.slug === slug || slugify(level.title ?? '') === slug,
  );
  if (existing) return existing;
  const id = `${weekId}-${slug}`;
  toCreate.set(
    id,
    newLevel({
      parentId: weekId,
      slug,
      title,
      order: (((weekday + 6) % 7) + 1) * 10,
      startAt: null,
      endAt: null,
    }),
  );
  return id;
}

const plan = new Map(); // levelId → photos
const unplaced = [];
const seen = new Set();
let duplicates = 0;
let already = 0;

const placed = [];
for (const photo of read.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))) {
  if (seen.has(photo.id)) {
    duplicates += 1;
    continue;
  }
  seen.add(photo.id);
  if (existingMedia.has(photo.id)) {
    already += 1;
    continue;
  }
  const where = place(photo.hints, photo.date, weeks);
  if (!where) {
    unplaced.push(photo.path);
    continue;
  }
  const yearId = yearLevel(where.year);
  const weekId = where.week ? weekLevel(yearId, where.year, where.week) : null;
  placed.push({ photo, yearId, weekId });
}

/*
 * Which day, decided per week once every photo in it is known.
 *
 * The capture date beats the folder here — the opposite of the year and week —
 * because a day folder is where somebody dropped a card's worth of photos, and
 * 2024's "3 Wednesday" holds Monday's and Tuesday's too. But only a date inside
 * the week counts: that same folder has one photo from a May afternoon, from a
 * card that was not wiped. "Inside the week" is within four days of the date
 * most of the week's photos share, which needs no week dates from anybody.
 */
const weekDates = new Map();
for (const { photo, weekId } of placed) {
  if (!weekId || !photo.date) continue;
  if (!weekDates.has(weekId)) weekDates.set(weekId, new Map());
  const days = weekDates.get(weekId);
  const date = photo.date.slice(0, 10);
  days.set(date, (days.get(date) ?? 0) + 1);
}
const typicalDay = new Map(
  [...weekDates].map(([weekId, days]) => [
    weekId,
    Date.parse([...days].sort((a, b) => b[1] - a[1])[0][0]),
  ]),
);

for (const { photo, yearId, weekId } of placed) {
  let levelId = weekId ?? yearId;
  if (weekId) {
    const typical = typicalDay.get(weekId);
    const inWeek =
      photo.date &&
      typical &&
      Math.abs(Date.parse(photo.date.slice(0, 10)) - typical) <= 4 * 86_400_000;
    const weekday = inWeek ? weekdayOf(photo.date) : photo.hints.day;
    if (weekday !== null && weekday !== undefined) levelId = dayLevel(weekId, weekday);
  }
  if (!plan.has(levelId)) plan.set(levelId, []);
  plan.get(levelId).push(photo);
}

const titleOf = (id) => {
  const level = toCreate.get(id) ?? levels.find((l) => l.id === id);
  const parent = level?.parentId ? titleOf(level.parentId) + ' › ' : '';
  return parent + (level?.title ?? id);
};

console.log('');
for (const [id] of toCreate) console.log(`  + level  ${titleOf(id).padEnd(28)} programEvents/${id}`);
for (const [id, items] of [...plan].sort(([a], [b]) => titleOf(a).localeCompare(titleOf(b)))) {
  console.log(`  → ${String(items.length).padStart(5)} photos to ${titleOf(id)}`);
}
if (empty.length > 0) {
  console.log(`\n  ${empty.length} files are empty (all zero bytes) — skipped:`);
  for (const path of empty.slice(0, 5)) console.log(`      ${relative(root, path)}`);
  if (empty.length > 5) console.log(`      … and ${empty.length - 5} more`);
}
if (unplaced.length > 0) {
  console.log(`\n  ${unplaced.length} with no year in their folder and no capture date — skipped:`);
  for (const path of unplaced.slice(0, 15)) console.log(`      ${relative(root, path)}`);
  if (unplaced.length > 15) console.log(`      … and ${unplaced.length - 15} more`);
}

const total = [...plan.values()].reduce((sum, items) => sum + items.length, 0);
console.log(
  `\n${toCreate.size} levels to create, ${total} photographs to import` +
    (already ? `, ${already} already imported` : '') +
    (duplicates ? `, ${duplicates} duplicate copies ignored` : '') +
    '.',
);

if (!write) {
  console.log('\nDry run. Re-run with --write to apply.');
  process.exit(0);
}

// ---- pass 3: write ----------------------------------------------------------

// Parents before children, so a day never points at a week that is not there.
const depth = (id) => (toCreate.get(id)?.parentId ? 1 + depth(toCreate.get(id).parentId) : 0);
for (const [id, body] of [...toCreate].sort(([a], [b]) => depth(a) - depth(b))) {
  await createDocument(COLLECTIONS.programEvents, id, body);
}

const jobs = [...plan].flatMap(([levelId, items]) =>
  items.map((photo, index) => ({ ...photo, levelId, order: (index + 1) * 10 })),
);
const failed = [];

await pool(jobs, 4, async (job) => {
  try {
    const original = await decodable(job.path, readFileSync(job.path));
    // See `onGalleryMediaCreated` for why `.rotate()` and the metadata strip matter.
    const { data, info } = await sharp(original)
      .rotate()
      .resize({ width: PHOTO_MAX_EDGE, height: PHOTO_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: PHOTO_QUALITY })
      .toBuffer({ resolveWithObject: true });

    const renditionPath = `galleries/${job.levelId}/${job.id}.webp`;
    await upload(renditionPath, data);

    const taken = job.date ? new Date(job.date.replace(' ', 'T')) : new Date();
    await createDocument(COLLECTIONS.galleryMedia, job.id, {
      programId,
      programEventId: job.levelId,
      groupId: null,
      kind: 'photo',
      status: 'approved',
      // Required, and there is no submission behind this one: the rendition is
      // the only file. The prune script only ever deletes under `submissions/`.
      sourcePath: renditionPath,
      sourceUploaded: true,
      renditionPath,
      previewPath: null,
      posterPath: null,
      width: info.width,
      height: info.height,
      durationSeconds: null,
      caption: '',
      focal: { x: 0.5, y: 0.5 },
      // What `onGalleryMediaReviewed` sets on approval.
      placement: { onPage: true, slideshow: true, homepage: false },
      layout: null,
      order: job.order,
      submittedAt: taken,
      reviewedAt: new Date(),
      reviewedBy: null,
      autoApproveBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      updatedBy: null,
    });
  } catch (error) {
    failed.push(`${relative(root, job.path)}: ${error.message.split('\n')[0]}`);
  }
});

console.log(`\nImported ${jobs.length - failed.length} of ${jobs.length}.`);
if (failed.length > 0) {
  console.log(`${failed.length} failed — re-running retries only these:`);
  for (const line of failed) console.log(`  ${line}`);
  process.exitCode = 1;
}
console.log('New levels are unpublished, so their photos stay hidden until you publish each one from its page in edit mode.');
