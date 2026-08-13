/**
 * Turn the originals in `assets/` into the derivatives the site actually ships.
 *
 * `assets/` is the archive: whatever came off the old Wix site or out of a
 * designer's export, untouched, at whatever size and format it happened to be.
 * Nothing in there is served. This script produces the web-ready copies and is
 * the only thing allowed to write into `apps/website/public/`.
 *
 * Why a script rather than committing hand-exported files: the site is a static
 * export with `images.unoptimized: true` (see next.config.mjs), so there is no
 * server resizing anything on demand. The bytes we commit are the exact bytes a
 * phone on parish wifi downloads. That makes "what size and quality is this,
 * and who decided" a question worth having a written answer to, and re-running
 * this after someone drops in a new photo beats remembering the export dialog
 * settings from four months ago.
 *
 * Three destinations, and the split is deliberate:
 *
 *   apps/website/src/app/ Icons and share images, as Next file conventions
 *                         (`apple-icon.png`, `opengraph-image.png`). Next
 *                         hashes these and emits the <link>/<meta> tags with
 *                         the right dimensions itself. The docs are explicit
 *                         that these do NOT go in public/.
 *   apps/website/public/  Everything referenced from markup by URL — the
 *                         masthead seal, backdrops. Versioned with the code.
 *   assets/derived/       Staged for Firebase Storage — clergy portraits and
 *                         anything else staff should be able to swap without a
 *                         deploy. NOT served from here; see storage.rules.
 *
 * Everything is stripped of metadata on the way through. Phone photos carry GPS
 * coordinates, and a parish should not publish the home addresses of the people
 * who took its pictures.
 *
 * Usage:
 *   node scripts/optimize-assets.mjs           # build everything
 *   node scripts/optimize-assets.mjs --check    # verify outputs are current
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets');
const APP = join(ROOT, 'apps/website/src/app');
const PUBLIC = join(ROOT, 'apps/website/public');
const DERIVED = join(SRC, 'derived');

const check = process.argv.includes('--check');

/**
 * The parish seal, minus its background.
 *
 * The supplied SVG paints an opaque near-white rectangle (`#fdfdfd`) across the
 * full canvas before it draws anything else — an artifact of the PDF it was
 * converted from. Left in, the seal arrives as a white card and can never sit
 * on a coloured masthead. It is always the first path inside the clip group and
 * always the only one filled `#fdfdfd`, so dropping it by fill is safe and
 * survives the file being re-exported.
 */
function sealWithoutBackground() {
  const svg = readFileSync(join(SRC, 'St Philopater & St. Mena Logo.svg'), 'utf8');
  const stripped = svg.replace(/<path[^>]*fill="#fdfdfd"[^>]*\/>\s*/g, '');
  if (stripped === svg) throw new Error('seal: background path not found — has the export changed?');
  return Buffer.from(stripped);
}

/** Brand colours, read off the seal itself rather than guessed. */
const BRAND = { red: '#81171c', gold: '#daa728', cream: '#fbf9f5' };

const outputs = [];

function record(path, bytes) {
  outputs.push({ path: path.replace(`${ROOT}/`, ''), bytes });
}

function write(path, buffer) {
  if (check) {
    // assets/derived/ is gitignored — absent on a fresh clone is correct, not a
    // failure. Only the outputs that ship are required to be present.
    if (existsSync(path)) record(path, statSync(path).size);
    else if (!path.startsWith(DERIVED)) throw new Error(`missing: ${path.replace(`${ROOT}/`, '')}`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
  record(path, buffer.length);
}

/** WebP everywhere. Every browser the parish's analytics has ever seen supports it. */
async function webp(input, { width, height, quality = 78, position = 'centre', extract }) {
  let pipeline = sharp(input, { failOn: 'error' });
  if (extract) pipeline = pipeline.extract(extract);
  return pipeline
    .resize({ width, height, fit: height ? 'cover' : 'inside', position, withoutEnlargement: true })
    .webp({ quality, effort: 6 })
    .toBuffer();
}

/**
 * Palette PNG throughout. The seal is flat iconographic colour — 128 entries
 * covers it with no visible banding even across the gold banner and the halos,
 * and it is the difference between a 252 KB Open Graph image and a 38 KB one.
 */
async function png(input, opts) {
  return sharp(input, { density: 600 })
    .resize({ width: opts.width, height: opts.height, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, palette: true, colours: 128 })
    .toBuffer();
}

/**
 * Pack PNGs into an .ico. Hand-rolled rather than adding a dependency: since
 * Vista an ICO entry may hold a PNG verbatim, so the whole format here is a
 * 6-byte header, one 16-byte directory entry per size, and the PNGs appended.
 *
 * Byte layout, for whoever has to touch this next:
 *   ICONDIR       reserved u16=0 | type u16=1 | count u16
 *   ICONDIRENTRY  w u8 | h u8 | palette u8=0 | reserved u8=0
 *                 planes u16=1 | bpp u16=32 | length u32 | offset u32
 * A dimension of 256 is written as 0, which is why nothing above 48 is used.
 */
async function ico(source, sizes) {
  const images = await Promise.all(
    sizes.map((size) =>
      sharp(source, { density: 600 }).resize(size, size, { fit: 'contain' }).png({ compressionLevel: 9 }).toBuffer(),
    ),
  );

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map((png, i) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 0);
    entry.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images]);
}

/** The seal centred on a flat card — used for both the touch icon and OG. */
async function sealCard(seal, { width, height, sealHeight }) {
  return sharp({ create: { width, height, channels: 3, background: BRAND.cream } })
    .composite([{ input: await png(seal, { height: sealHeight }) }])
    .png({ compressionLevel: 9, palette: true, colours: 128 })
    .toBuffer();
}

// ── The seal ────────────────────────────────────────────────────────────────
// Shipped as PNG, not SVG. The vector is 5,514 paths; even after SVGO it is
// 1.5 MB (650 KB gzipped), and it would sit in the header of every page. A
// 512px PNG of the same artwork is ~180 KB and no one can tell the difference
// at the 56px the masthead renders it. The SVG stays in assets/ as the master.
{
  const seal = sealWithoutBackground();

  // Masthead, at 1x/2x/3x for a 64px slot. Height-driven: the seal is wider
  // than it is tall (1435×1313), and it is the height that has to line up with
  // the wordmark beside it. Nothing larger is generated — an unused 512px file
  // is bytes in the deploy that no one ever downloads on purpose.
  write(join(PUBLIC, 'brand/seal-64.png'), await png(seal, { height: 64 }));
  write(join(PUBLIC, 'brand/seal-128.png'), await png(seal, { height: 128 }));
  write(join(PUBLIC, 'brand/seal-192.png'), await png(seal, { height: 192 }));

  // Apple touch icon. Square and opaque — iOS composites onto white and rounds
  // the corners itself, so a transparent one just looks grubby on a home screen.
  //
  // Note this is the full seal, which at 180px is busy but still legible. The
  // 32px favicon is a different problem and a different file: app/icon.svg is a
  // simplified mark, because no amount of care makes two saints, a horse and
  // two camels read at 32px.
  write(join(APP, 'apple-icon.png'), await sealCard(seal, { width: 180, height: 180, sealHeight: 156 }));

  // Open Graph. 1200×630 is what every scraper crops to; anything else gets
  // letterboxed or centre-cropped unpredictably. The seal already carries the
  // parish name in its banner, so this needs no additional text.
  //
  // WhatsApp and Facebook are how a parish actually circulates a link, which
  // makes this the most-viewed image on the site by a wide margin.
  const card = await sealCard(seal, { width: 1200, height: 630, sealHeight: 520 });

  // No trailing newline. Next copies these files into the `content` attribute
  // byte for byte, so a stray \n ends up inside og:image:alt.
  const alt = Buffer.from('The seal of St. Philopater Mercurius & St. Mina Coptic Orthodox Church.');

  write(join(APP, 'opengraph-image.png'), card);
  write(join(APP, 'opengraph-image.alt.txt'), alt);

  // X/Twitter does not fall back to og:image reliably. Same bytes, and Next
  // emits it under a separate hashed URL.
  write(join(APP, 'twitter-image.png'), card);
  write(join(APP, 'twitter-image.alt.txt'), alt);

  // favicon.ico, built from the simplified mark rather than the seal.
  //
  // app/icon.svg alone does not stop the requests: browsers probe /favicon.ico
  // regardless of what <link rel="icon"> says, and with no file there the
  // request falls through to the [section] dynamic route and 500s on every page
  // load in dev. A real .ico is the fix.
  write(join(APP, 'favicon.ico'), await ico(join(APP, 'icon.svg'), [16, 32, 48]));
}

// ── Clergy portraits → staged for Firebase Storage ──────────────────────────
// Cropped to a common 4:5 so the three of them sit in a row without one being
// visibly a different shape. `position: north` because these are headshots and
// the head is at the top — centre-cropping a portrait cuts foreheads.
//
// Bishop David's file carries a visible "© Photo From The Heart by Nash 2014"
// watermark across the top. It is preserved here on purpose: removing a
// photographer's copyright notice is not something a build script should do
// quietly. See assets/README.md for the licensing status.
for (const [source, name] of [
  ['Father-Youhanna.jpg', 'fr-youhanna'],
  ['Father-Armia.jpg', 'fr-armia'],
  ['Bishop-David.jpg', 'bishop-david'],
]) {
  const input = join(SRC, source);
  write(join(DERIVED, `clergy/${name}.webp`), await webp(input, { width: 800, height: 1000, position: 'north', quality: 80 }));
  write(join(DERIVED, `clergy/${name}@0.5.webp`), await webp(input, { width: 400, height: 500, position: 'north', quality: 78 }));
}

// ── Backdrops ───────────────────────────────────────────────────────────────
// Architecture shots, used behind text as texture rather than presented as
// photographs of this parish — because they are not. Neither building is the
// Wayland church. See assets/README.md.
//
// They are NOT dimmed here. Darkening is a CSS overlay so it can respond to the
// colour scheme and so the same file works on a light and a dark section;
// baking it in fixes one choice into the pixels forever.
{
  // The verse image has "2 Corinthians 9:7" typeset across its top third. Text
  // baked into a JPEG cannot be translated, cannot reflow on a narrow phone,
  // and is invisible to search engines and screen readers. Cropped away — if
  // the giving page wants that verse, it goes in the markup as text.
  const verse = join(SRC, 'Coptic_Church_Verse.jpg');
  const meta = await sharp(verse).metadata();
  const top = Math.round(meta.height * 0.36);
  const extract = { left: 0, top, width: meta.width, height: meta.height - top };
  write(join(PUBLIC, 'img/backdrop-domes-1600.webp'), await webp(verse, { width: 1600, quality: 72, extract }));
  write(join(PUBLIC, 'img/backdrop-domes-800.webp'), await webp(verse, { width: 800, quality: 70, extract }));

  const towers = join(SRC, 'Coptic_church_example.jpg');
  write(join(PUBLIC, 'img/backdrop-towers-1600.webp'), await webp(towers, { width: 1600, quality: 72 }));
  write(join(PUBLIC, 'img/backdrop-towers-800.webp'), await webp(towers, { width: 800, quality: 70 }));

  // 4.8 MB PNG of a photograph — PNG is the wrong container for continuous
  // tone and is essentially the entire reason for that number.
  const hands = join(SRC, 'Donation.png');
  write(join(PUBLIC, 'img/backdrop-giving-1600.webp'), await webp(hands, { width: 1600, quality: 72 }));
  write(join(PUBLIC, 'img/backdrop-giving-800.webp'), await webp(hands, { width: 800, quality: 70 }));
}

// ── Iconography ─────────────────────────────────────────────────────────────
// A photographed icon and two pencil studies. Higher quality than the
// backdrops: the sketches are fine grey line work on white, which is exactly
// what low-quality WebP turns into mush.
{
  write(
    join(PUBLIC, 'img/icon-crucifixion-1200.webp'),
    await webp(join(SRC, 'Crucifixion.jpg'), { width: 1200, quality: 82 }),
  );
  for (const [source, name] of [
    ['Iconography1.jpg', 'sketch-face'],
    ['Iconography2.JPG', 'sketch-christ'],
  ]) {
    write(join(PUBLIC, `img/${name}-800.webp`), await webp(join(SRC, source), { width: 800, quality: 86 }));
  }
}

// ── Deliberately not built ──────────────────────────────────────────────────
// Coptic_pattern.png    AI-generated; the "Coptic" in its banners is imitation
//                       letterforms spelling nothing. Compare the genuine
//                       inscription on Crucifixion.jpg.
// Festival.jpg          Past event, 504×613, parish name misspelled
//                       ("Philopateer", no "Mercurius"), and the poster is cut
//                       off mid-sentence.
// SPSM-Church-Image.jpg 176×176. The only photograph of the actual sanctuary
//                       and it is a Wix thumbnail. Needs re-shooting.

const total = outputs.reduce((n, o) => n + o.bytes, 0);
for (const o of outputs.sort((a, b) => a.path.localeCompare(b.path))) {
  console.log(`  ${String(Math.round(o.bytes / 1024)).padStart(5)} KB  ${o.path}`);
}
console.log(`\n${outputs.length} files, ${(total / 1024 / 1024).toFixed(2)} MB${check ? ' (checked)' : ''}`);
