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
 * Two destinations, and the split is deliberate:
 *
 *   apps/website/src/app/ Icons and share images, as Next file conventions
 *                         (`apple-icon.png`, `opengraph-image.png`). Next
 *                         hashes these and emits the <link>/<meta> tags with
 *                         the right dimensions itself. The docs are explicit
 *                         that these do NOT go in public/.
 *   apps/website/public/  Everything referenced from markup by URL — the
 *                         masthead seal, the backdrops, the clergy portraits.
 *                         Versioned with the code.
 *
 * There was a third, `assets/derived/`, holding a second copy of each clergy
 * portrait staged for a Firebase Storage upload that never happened. It is
 * gone. Every output now has exactly one home, which is the property that makes
 * "where does this image come from" answerable.
 *
 * Everything is stripped of metadata on the way through. Phone photos carry GPS
 * coordinates, and a parish should not publish the home addresses of the people
 * who took its pictures.
 *
 * Usage:
 *   node scripts/optimize-assets.mjs           # build everything
 *   node scripts/optimize-assets.mjs --check    # verify outputs are current
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets');
const APP = join(ROOT, 'apps/website/src/app');
const PUBLIC = join(ROOT, 'apps/website/public');

const check = process.argv.includes('--check');

/**
 * The parish seal, minus its background.
 *
 * The supplied SVG paints an opaque near-white rectangle (`#fdfdfd`) across the
 * full canvas before it draws anything else — an artifact of the PDF it was
 * converted from. Left in, the seal arrives as a white card and can never sit
 * on a coloured masthead.
 *
 * It is *not* the only path filled `#fdfdfd`, which the earlier version of this
 * assumed: the export uses that same near-white for five small highlights inside
 * the mark, and deleting them by fill punched five transparent holes through the
 * middle of the seal. So the background is identified by geometry instead — it
 * is the one path whose outline reaches the edge of the canvas, everything else
 * being comfortably inside the roundel. That survives a re-export in a way a
 * "first match" rule would not.
 */
function sealWithoutBackground() {
  const svg = readFileSync(join(SRC, 'St Philopater & St. Mena Logo.svg'), 'utf8');
  const canvasWidth = Number(svg.match(/viewBox="0 0 ([\d.]+) [\d.]+"/)?.[1]);
  if (!canvasWidth) throw new Error('seal: no viewBox on the root <svg> — has the export changed?');

  const background = [...svg.matchAll(/<path[^>]*fill="#fdfdfd"[^>]*\/>\s*/g)].find((match) =>
    spansCanvas(match[0], canvasWidth),
  );
  if (!background) throw new Error('seal: background path not found — has the export changed?');

  return Buffer.from(
    svg.slice(0, background.index) + svg.slice(background.index + background[0].length),
  );
}

/**
 * True when a path's coordinates run to the edge of the canvas — i.e. it is the
 * backdrop rather than something drawn on the seal. The widest real detail stops
 * around 1159 of 1436, so there is no ambiguity to resolve here; the numbers are
 * read straight out of the `d` attribute without parsing the path grammar,
 * because the maximum is all this needs and every command's operands are
 * coordinates in this export.
 */
function spansCanvas(path, canvasWidth) {
  const d = path.match(/\sd="([^"]*)"/)?.[1] ?? '';
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  return numbers.length > 0 && Math.max(...numbers) >= canvasWidth;
}

/**
 * The width the seal is rasterised at once, before every output is scaled down
 * from it. Three times the largest thing made from it (the 520px seal on the
 * Open Graph card), and enough resolution for the flood fill below to trace the
 * arch cleanly.
 */
const SEAL_MASTER_WIDTH = 1600;

/**
 * The seal, with the ground inside its arch filled back in.
 *
 * Removing the backdrop is only half the job. The red band is an arch, not a
 * closed ring — it springs from two feet either side of the banner and is open
 * between them — so the area it encloses, the ground the saints stand on, has no
 * fill of its own. It was the page showing through, and once the page is
 * transparent the masthead shows through instead: on the dark footer the saints
 * float on navy with a red arch drawn round them.
 *
 * What is wanted is a mark that is opaque inside its outline and transparent
 * outside it, and the arch is a hand-drawn dome rather than a circle, so its
 * inside cannot be approximated with a shape. It is instead traced from the band
 * itself: render the band alone, flood the region outside it inward from the top
 * and sides, and whatever the flood cannot reach is the inside. The flood is
 * confined to the band's own rows, or it would climb up through the opening at
 * the feet and swallow the very region being looked for.
 *
 * Below the feet the arch gives no boundary to work with, and stopping there
 * left the banner and the animals' legs standing on whatever colour was behind
 * them. So the ground carries on to the foot of the mark, bounded on each row by
 * the artwork's own outermost pixels — under the legs, between them, and behind
 * the banner. Following the outline rather than squaring it off at the arch's
 * width is what keeps the seal a seal instead of a white card: no edge of the
 * ground is ever anywhere the artwork is not.
 */
async function sealOnItsGround(seal) {
  const band = await sharp(bandAlone(seal), { density: 600 })
    .resize({ width: SEAL_MASTER_WIDTH })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = band.info;
  const isBand = new Uint8Array(width * height);
  let springLine = 0;
  for (let p = 0; p < width * height; p++) {
    if (band.data[p * 4 + 3] > 128) {
      isBand[p] = 1;
      springLine = Math.max(springLine, Math.floor(p / width));
    }
  }
  if (springLine < height / 2) throw new Error('seal: the arch band did not render — is it still the largest shape?');

  // Everything the flood reaches is outside the arch. Seeded from the top edge
  // and from both sides, down to the spring line and no further.
  const outside = new Uint8Array(width * height);
  const queue = [];
  for (let x = 0; x < width; x++) queue.push(x);
  for (let y = 0; y <= springLine; y++) queue.push(y * width, y * width + width - 1);
  while (queue.length > 0) {
    const p = queue.pop();
    if (outside[p] === 1 || isBand[p] === 1) continue;
    outside[p] = 1;
    const x = p % width;
    const y = Math.floor(p / width);
    if (x > 0) queue.push(p - 1);
    if (x < width - 1) queue.push(p + 1);
    if (y > 0) queue.push(p - width);
    if (y < springLine) queue.push(p + width);
  }

  // Below the spring line, the artwork bounds itself: the leftmost and rightmost
  // opaque pixel of each row, down to the last row that has any.
  const artwork = await sharp(seal, { density: 600 })
    .resize({ width })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const spans = [];
  let lastRow = springLine;
  for (let y = 0; y < height; y++) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < width; x++) {
      if (artwork.data[(y * width + x) * 4 + 3] > 128) {
        if (first < 0) first = x;
        last = x;
      }
    }
    spans.push([first, last]);
    if (first >= 0) lastRow = Math.max(lastRow, y);
  }

  // Near-white rather than pure white: it is the colour the export used for the
  // backdrop it drew, and the artwork's own highlights are the same value.
  const ground = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const x = p % width;
    const y = Math.floor(p / width);
    const [first, last] = spans[y];
    const inside =
      y <= springLine
        ? outside[p] === 0
        : y <= lastRow && first >= 0 && x >= first && x <= last;
    if (!inside) continue;
    ground[p * 4] = 0xfd;
    ground[p * 4 + 1] = 0xfd;
    ground[p * 4 + 2] = 0xfd;
    ground[p * 4 + 3] = 0xff;
  }

  return sharp(ground, { raw: { width, height, channels: 4 } })
    .composite([
      { input: await sharp(artwork.data, { raw: { width, height, channels: 4 } }).png().toBuffer() },
    ])
    .png()
    .toBuffer();
}

/**
 * The seal's arch band on its own, as a renderable SVG.
 *
 * Picked as the largest filled shape in the mark, which the band is by a wide
 * margin — 925k square units of bounding box against 894k for the whole banner
 * and well under half that for anything else. The clip group is dropped rather
 * than reproduced: it clips to the full canvas, so it does nothing here.
 */
function bandAlone(seal) {
  const svg = seal.toString('utf8');
  let band = null;
  for (const match of svg.matchAll(/<path[^>]*\bfill="#[0-9a-fA-F]{6}"[^>]*\/>/g)) {
    const d = match[0].match(/\sd="([^"]*)"/)?.[1] ?? '';
    const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const xs = numbers.filter((_, i) => i % 2 === 0);
    const ys = numbers.filter((_, i) => i % 2 === 1);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (band === null || area > band.area) band = { area, path: match[0] };
  }
  if (band === null) throw new Error('seal: no filled paths — has the export changed?');

  const head = svg.slice(0, svg.indexOf('<g clip-path'));
  return Buffer.from(`${head}<g>${band.path}</g></svg>`);
}

/** Brand colours, read off the seal itself rather than guessed. */
const BRAND = { red: '#81171c', gold: '#daa728', cream: '#fbf9f5' };

const outputs = [];

function record(path, bytes) {
  outputs.push({ path: path.replace(`${ROOT}/`, ''), bytes });
}

function write(path, buffer) {
  if (check) {
    // Every output ships and is committed now that `assets/derived/` is gone,
    // so a missing one is a real failure rather than a gitignored staging file
    // that a fresh clone is correct not to have.
    if (!existsSync(path)) throw new Error(`missing: ${path.replace(`${ROOT}/`, '')}`);
    record(path, statSync(path).size);
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
 *
 * `input` is the rasterised master from sealOnItsGround, not the SVG: the arch's
 * ground has to be traced from pixels, and re-tracing it per output size would
 * be four flood fills to produce four scalings of the same image.
 */
async function png(input, opts) {
  return sharp(input)
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
 *
 * `background` is not optional here. The seal is 1435×1313, so squaring it pads
 * top and bottom, and sharp's default padding colour is opaque *black* — which
 * shipped a favicon with two black bars across it. Transparent, to match
 * icon.png; the tab bar shows through instead.
 */
async function ico(source, sizes) {
  const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
  const images = await Promise.all(
    sizes.map((size) =>
      sharp(source)
        .resize(size, size, { fit: 'contain', background: TRANSPARENT })
        .png({ compressionLevel: 9 })
        .toBuffer(),
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
  // One high-resolution master, and every output below is a scaling of it. The
  // ground inside the arch is filled here — see sealOnItsGround.
  const seal = await sealOnItsGround(sealWithoutBackground());

  // Masthead, at 1x/2x/3x for a 64px slot. Height-driven: the seal is wider
  // than it is tall (1435×1313), and it is the height that has to line up with
  // the wordmark beside it. Nothing larger is generated — an unused 512px file
  // is bytes in the deploy that no one ever downloads on purpose.
  write(join(PUBLIC, 'brand/seal-64.png'), await png(seal, { height: 64 }));
  write(join(PUBLIC, 'brand/seal-128.png'), await png(seal, { height: 128 }));
  write(join(PUBLIC, 'brand/seal-192.png'), await png(seal, { height: 192 }));

  // Apple touch icon. Square and opaque — iOS composites onto white and rounds
  // the corners itself, so a transparent one just looks grubby on a home screen.
  write(join(APP, 'apple-icon.png'), await sealCard(seal, { width: 180, height: 180, sealHeight: 156 }));

  // The browser-tab icon: the parish seal, as asked for.
  //
  // This replaces a hand-drawn simplified cross that used to live at
  // app/icon.svg. The reason that file existed is still true — two saints, a
  // horse and two camels do not resolve at the 16px a tab actually renders — but
  // the seal is the parish's own mark, and which mark represents the parish is
  // the parish's call, not a legibility optimisation.
  //
  // PNG rather than the SVG master. `assets/`'s vector is 2.8 MB across 5,514
  // paths; as `icon.svg` that is a multi-megabyte request on a site whose whole
  // point is loading fast over church-hall wifi, to fill sixteen pixels. Square
  // and transparent, so it sits correctly on both light and dark tab bars.
  write(join(APP, 'icon.png'), await png(seal, { width: 192, height: 192 }));

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

  // favicon.ico, from the seal, so the legacy path shows the same mark as
  // icon.png rather than a different one.
  //
  // icon.png alone does not stop the requests: browsers probe /favicon.ico
  // regardless of what <link rel="icon"> says, and with no file there the
  // request falls through to the [section] dynamic route and 500s on every page
  // load in dev. A real .ico is the fix.
  write(join(APP, 'favicon.ico'), await ico(seal, [16, 32, 48]));
}

// ── Clergy portraits ────────────────────────────────────────────────────────
//
// Two destinations, for two different jobs.
//
// `public/img/clergy/` is what the site actually shows. The clergy no longer
// have a page of their own — the biographies are disclosures on the homepage —
// so these load with the homepage and must be in the bundle rather than behind
// a Storage round trip on the site's most-visited page. **Named by the content
// slug**, which is the filename in `content/clergy/` minus its order prefix,
// because that is what the renderer has in hand: `<order>-<slug>.md` becomes the
// document id, and `bundledPortraits()` in the website looks for `<slug>.webp`.
// Renaming a markdown file therefore silently drops a portrait, which is why the
// slug is written out here beside the source rather than derived from it.
//
// There used to be a second copy of each of these under `assets/derived/`,
// staged for a Firebase Storage upload. It is gone: the site reads the bundled
// files, nothing ever uploaded the staged ones, and keeping both meant three
// fathers with five files each and no way to tell from the directory which pair
// mattered. `person.portraitPath` still overrides the bundle where it is set —
// that path is for a photograph the parish uploads later, and it can be cut
// from the original in `assets/` when there is one.
//
// Cropped to a common 4:5 so the three of them sit in a row without one being
// visibly a different shape. `position: north` because these are headshots and
// the head is at the top — centre-cropping a portrait cuts foreheads.
//
// Bishop David's file carries a visible "© Photo From The Heart by Nash 2014"
// watermark across the top. It is preserved here on purpose: removing a
// photographer's copyright notice is not something a build script should do
// quietly. **It is now published rather than staged**, so the outstanding
// licence confirmation in assets/README.md is no longer a pre-launch tidy-up —
// it is a third party's notice on a live page.
//
// **The last three have no file yet, and that is not an error.** The deacons
// are named on /about/who-we-are, and the names of the photographs they are
// waiting for are written here so that adding one is dropping a jpg into
// `assets/` and re-running this — no edit to this table, no edit to the page,
// no deploy-day scramble. Until then `bundledPortrait()` finds nothing on disk
// and the roster shows the person's initial instead of a broken image, which
// is the same fallback the homepage has always used for a father with no
// photograph.
//
// So this loop skips a missing source rather than throwing on it. That is a
// deliberate hole in an otherwise strict script, and it is narrow: it applies
// only to this table, it prints every skip, and `--check` still fails on an
// output that was built once and then lost, because a source that exists must
// still produce its two files.
for (const [source, slug] of [
  ['Father-Youhanna.jpg', 'fr-youhanna-gobran'],
  ['Father-Armia.jpg', 'fr-armia-tawfik'],
  ['Bishop-David.jpg', 'bishop-david'],
  ['Deacon-Severus.jpg', 'deacon-severus-ghaly'],
  ['Deacon-Peter.jpg', 'deacon-peter-awadalla'],
  ['Deacon-Kyrillos.jpg', 'deacon-kyrillos-bebawy'],
]) {
  const input = join(SRC, source);

  if (!existsSync(input)) {
    console.log(`  (waiting)  assets/${source} — no portrait for ${slug} yet`);
    continue;
  }

  // Two widths, one image. The card carries the portrait at its full width, so
  // 400 covers a 1× column and 800 the same column on a 2× panel.
  write(
    join(PUBLIC, `img/clergy/${slug}.webp`),
    await webp(input, { width: 400, height: 500, position: 'north', quality: 78 }),
  );
  write(
    join(PUBLIC, `img/clergy/${slug}@2x.webp`),
    await webp(input, { width: 800, height: 1000, position: 'north', quality: 80 }),
  );
}

// ── The homepage photograph ─────────────────────────────────────────────────
//
// THIS ONE IS DIFFERENT FROM EVERY OTHER IMAGE HERE: it is actually this parish.
//
// The sanctuary at Wayland — the iconostasis, the four living creatures above
// it, the Theotokos and Pantocrator icons, a priest at the altar. Until this
// arrived the only shot of this sanctuary was a 176×176 Wix thumbnail, which is
// why the hero was built out of type and ornament instead of a photograph.
//
// Because it is the parish, it may be presented as the parish: captioned, given
// real alt text, and carried at full strength rather than dimmed to texture the
// way `Coptic_church_example.jpg` has to be.
//
// Two things about the source worth knowing:
//
//   - It is a frame from a livestream (5061×2325, and there is a camera rig and
//     a tablet visible at the edges). Downscaling to hero width hides the
//     softness; do not upscale it or use it above ~2400px.
//   - **It contains identifiable people**, including a young deacon serving and
//     congregation in the front rows. The crop below deliberately drops the
//     bottom of the frame — that is composition *and* privacy: it removes most
//     of the seated congregation while tightening onto the iconostasis, which is
//     the part that carries the image anyway.
{
  const home = join(SRC, 'HomeScreen.png');
  const meta = await sharp(home).metadata();

  // Keep the top 84%. Below that is the front row of the congregation.
  const extract = { left: 0, top: 0, width: meta.width, height: Math.round(meta.height * 0.84) };

  // Three widths: the hero is full-bleed, so on a wide desktop it genuinely is
  // 2400 CSS px across on a retina panel. 1000 is the phone case and the one
  // that matters most for how fast the homepage paints.
  write(join(PUBLIC, 'img/home-sanctuary-2400.webp'), await webp(home, { width: 2400, quality: 74, extract }));
  write(join(PUBLIC, 'img/home-sanctuary-1600.webp'), await webp(home, { width: 1600, quality: 74, extract }));
  write(join(PUBLIC, 'img/home-sanctuary-1000.webp'), await webp(home, { width: 1000, quality: 72, extract }));

  /*
   * A second, portrait crop — art direction, not just a smaller file.
   *
   * The landscape frame is 2.6:1. A phone hero is roughly 0.6:1, so
   * `object-fit: cover` throws away about three quarters of the width and what
   * survives is the red curtain behind the altar: no iconostasis, no icons, no
   * altar. An abstract red and blue smear where the photograph should be.
   *
   * No `object-position` fixes that, because the problem is that the subject is
   * wider than the box. So this crop is taken *around the altar* — the priest,
   * the cross, and the Christ mural above — at 3:4, which is a composition that
   * survives a narrow viewport. `<picture>` picks it below 40rem.
   */
  const centreX = Math.round(meta.width * 0.475);
  const portraitHeight = extract.height;
  const portraitWidth = Math.round(portraitHeight * 0.75);
  const portrait = {
    left: Math.max(0, centreX - Math.round(portraitWidth / 2)),
    top: 0,
    width: portraitWidth,
    height: portraitHeight,
  };

  write(join(PUBLIC, 'img/home-sanctuary-portrait-900.webp'), await webp(home, { width: 900, quality: 74, extract: portrait }));
  write(join(PUBLIC, 'img/home-sanctuary-portrait-600.webp'), await webp(home, { width: 600, quality: 72, extract: portrait }));
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

  /*
   * Hero crops of the same two buildings, cut to the hero's own geometry.
   *
   * ---------------------------------------------------------------------
   * Why these exist rather than reusing the `backdrop-*` files above.
   *
   * The hero cross-fades three photographs in one fixed box. The backdrops
   * are their source images' native shapes — the towers shot is 1.52:1
   * against the sanctuary's 2.59:1 — so `object-fit: cover` had to throw
   * away 40% of the towers' height to fill the same frame, and it took the
   * crosses off the top of the building to do it. Three photographs of three
   * different shapes cross-fading in one box also means the subject jumps
   * on every transition.
   *
   * So all three frames are cut to the *same* two aspect ratios the
   * sanctuary already uses: 2.591:1 landscape and 3:4 portrait. Matched
   * geometry is what makes the fade read as one camera rather than as a
   * slideshow, and it means the CSS needs no per-image `object-position`
   * fudging — the crop decision lives here, next to the pixels, where it can
   * be seen.
   *
   * `HERO_LANDSCAPE` must stay in step with the sanctuary crop above.
   * ---------------------------------------------------------------------
   */
  const HERO_LANDSCAPE = 2.591;
  const HERO_PORTRAIT = 0.75;

  /** A centred window of `ratio`, nudged by `focusX`/`focusY` (0–1 of the slack). */
  const window_ = (meta, ratio, focusX = 0.5, focusY = 0.5) => {
    // Fit the largest box of this ratio inside the source, then slide it.
    const byWidth = meta.width / ratio <= meta.height;
    const width = byWidth ? meta.width : Math.round(meta.height * ratio);
    const height = byWidth ? Math.round(meta.width / ratio) : meta.height;
    return {
      left: Math.round((meta.width - width) * focusX),
      top: Math.round((meta.height - height) * focusY),
      width,
      height,
    };
  };

  {
    const meta = await sharp(towers).metadata();
    // `focusY: 0.06` — hard against the top. The crosses and the bell towers
    // are the subject and they are in the top third; a centred crop of a
    // 1.52:1 building shot from below is sky and masonry with the crosses
    // gone. The 0.06 leaves a little sky above them rather than cutting them
    // flush with the frame edge.
    const land = window_(meta, HERO_LANDSCAPE, 0.5, 0.06);
    write(join(PUBLIC, 'img/hero-towers-1600.webp'), await webp(towers, { width: 1600, quality: 74, extract: land }));
    write(join(PUBLIC, 'img/hero-towers-1000.webp'), await webp(towers, { width: 1000, quality: 72, extract: land }));

    // Portrait keeps both towers rather than centring on the gap between
    // them, which is why this is centred horizontally and again pulled up.
    const port = window_(meta, HERO_PORTRAIT, 0.5, 0.04);
    write(join(PUBLIC, 'img/hero-towers-portrait-900.webp'), await webp(towers, { width: 900, quality: 74, extract: port }));
    write(join(PUBLIC, 'img/hero-towers-portrait-600.webp'), await webp(towers, { width: 600, quality: 72, extract: port }));
  }

  /*
   * The second frame: the stained glass and the gold cross, cut out of the
   * verse image.
   *
   * ---------------------------------------------------------------------
   * **This replaces `hero-domes-*`, and the reason is that the hero had two
   * frames that read as the same photograph.**
   *
   * `hero-domes` was very nearly the whole verse image — cream masonry and
   * two domes against pale sky, shot from below. `hero-towers` above is
   * cream masonry and two bell towers against pale sky, shot from below.
   * Different buildings, indistinguishable at a glance and at hero size
   * under the veil, so the cross-fade looked like it was cycling one picture
   * back into itself. That is the complaint this crop answers.
   *
   * The same file has one region that looks like nothing else in `assets/`:
   * the two arched windows at its right, deep blue glass with the figure of
   * Christ in the left one and a gold cross across the right. Sixteen per
   * cent of the frame, and the only strong colour either backdrop holds.
   *
   * Hand-picked rectangles rather than `window_()`, and that is the point.
   * `window_` fits the *largest* box of a ratio and then slides it, which is
   * the right tool when the subject fills the frame — it is what the towers
   * and the sanctuary want. Here the subject is a sixth of the picture, so
   * the largest box is the wrong box however it is nudged, and the numbers
   * below are measured off the pixels:
   *
   *   landscape  1800×695   x 1200–3000, y 820–1515
   *   portrait    800×1067  x 1700–2500, y 700–1767
   *
   * Both ratios still match the sanctuary's, which is what keeps the fade
   * reading as one camera — 1800/695 = 2.590 and 800/1067 = 0.750.
   *
   * `top` is 820 and 700 against a verse crop that starts at 650, so the
   * typeset "2 Corinthians 9:7" is out of both by construction; the
   * assertion below is there so that stays true if anyone moves them.
   *
   * The landscape window is 1800px wide against a 1600px output and the
   * portrait 800 against 800, so neither is upscaled. 800 rather than the
   * 900 the other frames carry because 865×1154 is the largest 3:4 box that
   * fits below the verse text at all, and a file named 900 that is 865 wide
   * is the small version of the bug that killed the old fourth frame.
   * ---------------------------------------------------------------------
   */
  {
    const land = { left: 1200, top: 820, width: 1800, height: 695 };
    const port = { left: 1700, top: 700, width: 800, height: 1067 };
    for (const win of [land, port]) {
      if (win.top < extract.top) throw new Error('hero-glass crop reaches into the verse text');
    }

    write(join(PUBLIC, 'img/hero-glass-1600.webp'), await webp(verse, { width: 1600, quality: 76, extract: land }));
    write(join(PUBLIC, 'img/hero-glass-1000.webp'), await webp(verse, { width: 1000, quality: 74, extract: land }));

    // A touch higher quality than the landscape pair: stained glass is a
    // field of fine dark leading over saturated blue, which is exactly what
    // a low WebP quality smears, and the phone shows it larger relative to
    // the screen.
    write(join(PUBLIC, 'img/hero-glass-portrait-800.webp'), await webp(verse, { width: 800, quality: 80, extract: port }));
    write(join(PUBLIC, 'img/hero-glass-portrait-600.webp'), await webp(verse, { width: 600, quality: 78, extract: port }));
  }

  // 4.8 MB PNG of a photograph — PNG is the wrong container for continuous
  // tone and is essentially the entire reason for that number.
  const hands = join(SRC, 'Donation.png');
  write(join(PUBLIC, 'img/backdrop-giving-1600.webp'), await webp(hands, { width: 1600, quality: 72 }));
  write(join(PUBLIC, 'img/backdrop-giving-800.webp'), await webp(hands, { width: 800, quality: 70 }));

  /*
   * The /giving page's own hero: a dome, its cross, and the bells beside it.
   *
   * Added by Tommy 2026-08-26 as `Donation_backgroudn.png` (his spelling; the
   * file is named as received and only the outputs are renamed). It is a *detail*
   * — a dome against sky — not a photograph of a building, which is the whole
   * reason it can sit at the top of a page when the two stock exteriors cannot.
   * See "no photographs of our own building" in the notes above.
   *
   * Two crops, because the band is a wide strip on a laptop and a tall one on a
   * phone, and `object-fit: cover` on a single square source throws away most
   * of whichever axis is short:
   *
   *   landscape  2.4:1, the window that holds the cross and the whole dome and
   *              nothing below it. `top` is set from the cross: at 430 the
   *              upright clears the edge with room, and at much less the frame
   *              fills with empty sky.
   *   portrait   0.72:1, centred on the dome's axis rather than the frame's —
   *              the dome sits left of centre in the source — and full height,
   *              so the phone gets the bells as well.
   */
  const dome = join(SRC, 'Donation_backgroudn.png');
  const domeLand = { left: 0, top: 430, width: 2821, height: 1175 };
  const domePort = { left: 40, top: 0, width: 1980, height: 2750 };

  write(join(PUBLIC, 'img/hero-giving-1600.webp'), await webp(dome, { width: 1600, quality: 74, extract: domeLand }));
  write(join(PUBLIC, 'img/hero-giving-1000.webp'), await webp(dome, { width: 1000, quality: 72, extract: domeLand }));
  write(join(PUBLIC, 'img/hero-giving-portrait-900.webp'), await webp(dome, { width: 900, quality: 74, extract: domePort }));
  write(join(PUBLIC, 'img/hero-giving-portrait-600.webp'), await webp(dome, { width: 600, quality: 72, extract: domePort }));
}

// ── The Coptic cross ────────────────────────────────────────────────────────
//
// The homepage welcome section's picture, at Tommy's direction: the Coptic
// cross, inscribed Ⲓⲏⲥ Ⲡⲭⲥ / Ⲡ̀ϣⲏⲣⲓ ⲙ̀Ⲫϯ — "Jesus Christ, the Son of God".
//
// This replaced a photograph of a cross on a dome
// (`Coptic_cross_top_church.jpeg`), which is now read by nothing — see
// "Deliberately not built" at the bottom of this file.
//
// Not a photograph, so it is not treated like one:
//
//   - **Lossless.** 360×360 of flat primary colour with hard navy outlines.
//     Lossy WebP puts ringing along every one of those edges, and lossless
//     comes out *smaller* here than quality 92 does (33 KB against 37 KB)
//     because there are only a few dozen distinct colours to encode.
//   - **One size.** The source is 360×360 and `withoutEnlargement` means
//     that is the ceiling. It is shown in a 13rem (208px) column, so 360
//     covers it at 1.7× and there is no second file worth writing.
//
// The white ground is keyed out to alpha, and that is the part worth
// explaining. The supplied PNG is opaque white behind the artwork, which on
// the warm paper of a `.band` would arrive as a white card sitting on the
// page. The alternative already in this repo's vocabulary is
// `mix-blend-mode: multiply` in CSS — which is what the pencil study this
// section briefly used needed — but a blend mode is a property of the
// *context*: it depends on what is painted underneath, so the same file is
// wrong the moment it lands on anything but pale paper. A real alpha channel
// travels with the image, which matters because the mobile app renders these
// on its own surfaces.
//
// `alpha = min(255, (255 - min(r,g,b)) * 4)` rather than a luminance key,
// because luminance would eat the artwork: the yellow fill is (255, 242, 0)
// and reads as *bright*. The minimum channel does not — white is the only
// colour with all three channels high, so it is the only thing that goes
// transparent. The ×4 makes anything below 192 fully opaque and leaves the
// anti-aliased edge pixels partly so, which is what keeps the outlines
// smooth instead of stepped.
//
// This also drops the white *inside* the design — the ring around the centre
// medallion, the gaps between the arabesques — so the band's paper shows
// through the cross rather than the cross sitting on a rectangle of a
// slightly different white. That is the better reading, and it is why this is
// keyed rather than trimmed to its bounding box.
{
  const source = join(SRC, 'coptic_cross_image.png');
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const keyed = Buffer.from(data);
  for (let i = 0; i < keyed.length; i += 4) {
    const ground = Math.min(keyed[i], keyed[i + 1], keyed[i + 2]);
    keyed[i + 3] = Math.min(255, (255 - ground) * 4);
  }

  write(
    join(PUBLIC, 'img/cross-coptic-360.webp'),
    await sharp(keyed, { raw: { width: info.width, height: info.height, channels: 4 } })
      .webp({ lossless: true, effort: 6 })
      .toBuffer(),
  );

  /*
   * The same cross again, small, for the marker on the /contact map.
   *
   * 112 is 2× the 56 CSS pixels the marker is drawn at, so it is sharp on a
   * retina panel and nothing more. Reusing the 360 would be 33 KB of lossless
   * webp to fill a thumbnail, on the one image on that page a visitor is
   * guaranteed to download — the map is the reason they scrolled there.
   *
   * Lossy at 92 rather than lossless, and only here: at this size the
   * arabesques inside the arms are sub-pixel anyway, and the alpha channel is
   * preserved either way, which is the part that matters over map tiles.
   */
  write(
    join(PUBLIC, 'img/cross-coptic-112.webp'),
    await sharp(keyed, { raw: { width: info.width, height: info.height, channels: 4 } })
      .resize({ width: 112, height: 112, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 92, effort: 6 })
      .toBuffer(),
  );
}

// ── Social brand marks ──────────────────────────────────────────────────────
// Instagram, Facebook and YouTube, copied through unchanged.
//
// Not ours, and so not optimised, recoloured, or redrawn. A brand mark is
// recognisable because its outline is fixed; running these through an SVG
// minifier that rounds coordinates is a small, silent way to ship three
// slightly-wrong logos. They are already ~1 KB each.
//
// They are painted with `currentColor` at the CSS `mask-image` that consumes
// them (see `.social-icon`), which is why one flat file per platform serves
// both the footer's resting colour and its gold hover without a second copy.
{
  for (const name of ['instagram', 'facebook', 'youtube']) {
    write(
      join(PUBLIC, `brand/${name}.svg`),
      readFileSync(join(SRC, `brand/${name}.svg`)),
    );
  }
}

// ── App Store and Google Play badges ────────────────────────────────────────
// The two store badges on /giving, copied through byte for byte.
//
// Everything above about the social marks applies harder here, because both
// vendors publish written rules about it. Apple's badge may not be recoloured,
// recomposed, or redrawn, and its wording and proportions are fixed; Google's
// may not be modified and requires clear space around it, which is why the file
// is the *generic web* badge — that padding is part of the artwork.
//
// So: no `sharp`, no re-encoding, no resizing, and the PNG is not converted to
// WebP. Neither is `<img>`-with-`mask-image` like the social marks: these are
// full-colour lockups with type in them, not monochrome glyphs, and painting
// them with `currentColor` would flatten the Play triangle to one colour.
//
// They are 10.8 KB and 4.9 KB. There is nothing here worth optimising and a
// good deal worth not touching.
{
  for (const name of ['app-store-badge.svg', 'google-play-badge.png']) {
    write(join(PUBLIC, `brand/${name}`), readFileSync(join(SRC, `brand/${name}`)));
  }
}

// ── App icons ───────────────────────────────────────────────────────────────
// The two icons on /apps, from each app's own App Store listing at 512×512.
//
// Resized and re-encoded, unlike the two badges above, and the distinction is
// worth stating because it looks inconsistent. A badge is a *lockup with type in
// it* that Apple and Google license for one purpose and publish rules about
// altering; an app icon is the artwork identifying the app you are linking to,
// and showing it smaller is not altering it. What is not done to either: no
// crop, no recolour, no rounding baked into the pixels. The rounded corner is a
// CSS `border-radius` on the element, which is how every store renders these and
// leaves the file itself untouched.
//
// Taksis's icon is the parish's own — Apple lists the seller as
// "ST. PHILOPATER MERCURIUS & ST. MINA COPTIC ORTHODOX CHURCH, INC." — and is
// the sixth-century icon of Christ and St. Menas. Tithe.ly's belongs to Your
// Giving, Inc. and is used to identify their app beside their own store badges.
//
// Two sizes for a 64px slot, 2x and 3x. No 1x: the 128 is 6 KB and a file that
// small is not worth a third variant, and a 1x screen simply takes the 2x.
{
  for (const [source, name] of [
    ['taksis-icon.png', 'taksis'],
    ['tithely-icon.png', 'tithely'],
  ]) {
    for (const size of [128, 192]) {
      write(
        join(PUBLIC, `img/app-${name}-${size}.webp`),
        await webp(join(SRC, `apps/${source}`), { width: size, quality: 88 }),
      );
    }
  }
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

// ── Stock photographs for the forms ─────────────────────────────────────────
// Four licensed stock photographs, one per parish form, added 2026-08-26 at
// Tommy's request after the crest tiles were rejected.
//
// **These are the first images in this repo with a licence anyone recorded.**
// Unsplash License: free for commercial use, no permission needed, attribution
// appreciated but not required. Photo ids are in assets/README.md so the source
// of each one stays traceable — compare the "Unknown, likely stock" rows above
// it, which is exactly the state this is meant not to repeat.
//
// None of them is this parish. They illustrate what a form is *for* — a van, a
// car park, a group meeting, a gathering — and that is the whole job. Anything
// that could be mistaken for a photograph of St Philopater's own building or
// people would be worse than useless; see the note on the backdrops above.
//
// Cropped to 5:2 here rather than in CSS. The card and the form banner both
// want a wide, short frame, and doing it in the pipeline means the phone
// downloads a 5:2 file instead of a 3:2 file it will crop anyway.
{
  for (const name of [
    'stock-parking-lot',
    'stock-passenger-van',
    'stock-small-group',
    'stock-gathering',
    // Added 2026-09-02. `stock-gathering` was doing two jobs — the events
    // request *and* the summer-camp sign-up — and it is an evening social with
    // string lights, which is not what a parish means by summer camp. The camp
    // gets a photograph of children at one; the office gets a telephone and a
    // notepad, replacing the ornamental tile the contact form had.
    'stock-camp',
    'stock-office',
  ]) {
    const source = join(SRC, `stock/${name}.jpg`);
    const meta = await sharp(source).metadata();

    // Centre band at 5:2. `Math.min` guards a source that is already wider.
    const height = Math.min(meta.height, Math.round(meta.width * 0.4));
    const extract = {
      left: 0,
      top: Math.round((meta.height - height) / 2),
      width: meta.width,
      height,
    };

    // 1000 covers a card on a retina phone and the banner on a laptop; 500 is
    // the card at 1x. Nothing here is ever shown large enough to want more.
    write(join(PUBLIC, `img/${name}-1000.webp`), await webp(source, { width: 1000, quality: 74, extract }));
    write(join(PUBLIC, `img/${name}-500.webp`), await webp(source, { width: 500, quality: 72, extract }));
  }
}

// ── The festival tour galleries ─────────────────────────────────────────────
// Twenty-four images for the six stations on /about/welcome-newcomers, added
// 2026-08-29. All of them come from Wikimedia Commons and every one is CC0,
// public domain, CC BY or CC BY-SA — nothing NC, nothing ND, nothing whose
// licence the parish could not honour. `assets/tour/credits.json` holds the
// Commons file name, the permanent description-page URL, the licence and the
// author for each, straight from the API rather than typed out here, and
// `features/tour/stations.ts` renders that list at the foot of the page.
// Deleting an entry from the manifest without deleting it from the credits is
// how attribution silently rots, so both live beside the file.
//
// None of these is this parish. Same rule as the form photographs above: they
// illustrate a censer, an iconostasis, a ney, a deacon's tunic — the things the
// tour is about — and not St Philopater's own building or people.
//
// **No crop, unlike every other group in this file.** These are museum
// photographs of tall icons, manuscript leaves and vestments mixed with wide
// interior shots, and a band cut through the middle of a full-length icon of
// the Archangel is a picture of a torso. `fit: 'inside'` (what `webp` does when
// no `height` is passed) keeps each one whole and lets the grid crop with
// object-fit, where the lightbox can still show the original framing.
//
// Two sizes: 640 is a tile on a retina phone, 1280 the lightbox on a laptop.
// Everything is lazily loaded, and a visitor who never opens station 4 never
// pays for its four pictures.
{
  const tour = JSON.parse(readFileSync(join(SRC, 'tour/credits.json'), 'utf8'));

  for (const name of Object.keys(tour).sort()) {
    const source = join(SRC, `tour/${name}.jpg`);
    write(join(PUBLIC, `img/tour/${name}-1280.webp`), await webp(source, { width: 1280, quality: 76 }));
    write(join(PUBLIC, `img/tour/${name}-640.webp`), await webp(source, { width: 640, quality: 74 }));
  }
}

// ── Our Belief ──────────────────────────────────────────────────────────────
// Eleven pictures for /about/our-belief, added 2026-08-29. All from Wikimedia
// Commons, all public domain or CC BY / CC BY-SA — nothing NC, nothing ND.
// `assets/belief/credits.json` holds the Commons file name, the permanent
// description-page URL, the licence and the author for each, taken from the
// API rather than typed here, and `features/belief/parts.tsx` prints that list
// at the foot of the page. The manifest and the credits are one file for a
// reason: an entry deleted from one and left in the other is how attribution
// rots.
//
// None of them is this church. Same rule as the tour and the form photographs
// above — they illustrate what the Creed says, and the councils that wrote it,
// not St. Philopater Mercurius & St. Mina's own building or people.
//
// **No crop**, for the tour's reason and more so: these are icons, and a band
// cut across an icon of Christ is a picture of a chin. `fit: 'inside'` (what
// `webp` does with no `height`) keeps every one whole and lets the page frame
// them with object-fit where it needs a shape.
//
// Two widths, and the srcset in `features/belief/images.ts` states the *real*
// width of the large file rather than 1280 — `withoutEnlargement` means a
// 1023px original stays 1023px, and a descriptor that claims otherwise makes
// the browser choose wrongly on exactly the screens the second file exists for.
{
  const belief = JSON.parse(readFileSync(join(SRC, 'belief/credits.json'), 'utf8'));

  for (const name of Object.keys(belief).sort()) {
    const source = join(SRC, `belief/${name}.jpg`);
    write(join(PUBLIC, `img/belief/${name}-1280.webp`), await webp(source, { width: 1280, quality: 76 }));
    write(join(PUBLIC, `img/belief/${name}-640.webp`), await webp(source, { width: 640, quality: 74 }));
  }
}

// ── The patron saints ───────────────────────────────────────────────────────
// Seven pictures for /about/patron-saints, added 2026-08-29. Icons, museum
// objects, a church interior and an excavated site — the things the page's
// words are about. Wikimedia Commons again, CC0 or CC BY / CC BY-SA, nothing NC
// and nothing ND; `assets/saints/credits.json` came straight from the Commons
// API and `features/saints/saints.ts` prints it at the foot of the page.
//
// **No crop**, for the tour's reason and one more of its own. Four of these are
// icons, and an icon is a composition: the angel handing down the second sword
// is in the top corner of the Mercurius icon, and a band cut to a pleasant
// aspect ratio is a picture of a man on a horse with the point of the story
// trimmed off. `fit: 'inside'` keeps every one whole and lets CSS decide how
// much of it to show.
//
// Two sizes rather than the tour's, because these are not lightboxed: 1100 is a
// figure beside the prose on a laptop at 2×, 520 a tile in the iconography
// grid. `withoutEnlargement` means the two smallest sources — the icon at 792px
// and the mosaic at 600px — simply stop where they stop rather than being blown
// up into mush, so the pair of files is occasionally one file's worth of pixels
// written twice. That is the right trade for two images out of seven.
{
  const saints = JSON.parse(readFileSync(join(SRC, 'saints/credits.json'), 'utf8'));

  for (const name of Object.keys(saints).sort()) {
    const source = join(SRC, `saints/${name}.jpg`);
    write(join(PUBLIC, `img/saints/${name}-1100.webp`), await webp(source, { width: 1100, quality: 78 }));
    write(join(PUBLIC, `img/saints/${name}-520.webp`), await webp(source, { width: 520, quality: 76 }));
  }
}

// ── Who we are ──────────────────────────────────────────────────────────────
// Seven pictures for /about/who-we-are, added 2026-08-29. The page tells one
// story in three movements — Egypt, the crossing to America, this church — and
// each picture belongs to a movement rather than decorating a heading.
//
// **Every one of these is public domain, CC0 or "no restrictions".** Not a
// coincidence and not a preference for old things: this page shows no credits
// list, so a CC BY or CC BY-SA picture on it would be a licence we are not
// honouring. `assets/who/credits.json` came from the Commons API and the fetch
// refuses any file whose licence is not in that free set, so the rule is
// enforced where the pictures come in rather than remembered at review time.
// Two of the best candidates — the Abbassia cathedral and the church in Jersey
// City — were dropped for exactly this reason. If a credits list ever goes
// back on the page, they are worth going back for.
//
// None of them is this church. The one picture of Wayland on the page is the
// sanctuary, and it is already built above as `img/home-sanctuary-*` — this
// page reuses those files rather than emitting an eighth copy of them.
//
// **No crop**, as with the tour, the belief plates and the saints. Two of these
// are portraits of a man's face and one is a nineteenth-century print with its
// caption still printed under it; a band cut to a pleasant ratio takes the
// caption off and the face in half. `fit: 'inside'` keeps each one whole.
//
// Two widths, and the srcset in `features/who/images.ts` states the *real*
// width of the large file rather than 1280 — `withoutEnlargement` means the
// 1015px portrait of Pope Kyrillos stays 1015px, and a descriptor claiming
// otherwise makes the browser choose it on screens where it is no bigger than
// the small file.
{
  const who = JSON.parse(readFileSync(join(SRC, 'who/credits.json'), 'utf8'));

  for (const name of Object.keys(who).sort()) {
    const source = join(SRC, `who/${name}.jpg`);
    write(join(PUBLIC, `img/who/${name}-1280.webp`), await webp(source, { width: 1280, quality: 76 }));
    write(join(PUBLIC, `img/who/${name}-640.webp`), await webp(source, { width: 640, quality: 74 }));
  }
}

// ── The new church ──────────────────────────────────────────────────────────
// Ten pictures for /about/future-plans, added 2026-09-01. **The first set on
// this site that is not a photograph and not an icon: it is a building that
// does not exist yet**, drawn by Dewing Schmid Kearns for the church.
//
// Eight are single frames lifted out of the March 2026 flythrough animation and
// two are sheets out of the December 2025 permit set, rendered from the PDF at
// 1.6× with the title block cropped away — the only alteration either drawing
// gets. Everything upstream of `assets/future/` lives outside the repository;
// see the note there and in `assets/README.md`. `credits.json` records which
// document and which timestamp each one came from, because "is this still what
// the building looks like" is the question that will be asked about this page
// and the answer has to be checkable.
//
// **Nothing here is free-licensed**, unlike the tour, the belief plates, the
// saints and the who-we-are set. It is work the parish paid for. That is why
// `features/future/parts.tsx` prints a visible line naming the architects
// rather than a hidden credits drawer: with Commons material the licence is the
// obligation, and here the obligation is not misleading anybody about who drew
// it or how settled it is.
//
// **No crop and no `height`**, as everywhere else. Every source is 16:9 already
// — 1920×1080 for the frames, 4042×2468 for the sheets — and CSS decides the
// window. 1600 rather than the 1280 the other sets use: the site plan is a line
// drawing whose street names have to survive, and a 1280 copy of it turns
// "TURKEY HILL ROAD" into grey fur. Quality 80 for the same reason — thin black
// lines on white are exactly what WebP spends its bits worst on.
//
// The source files are PNG, not the JPEG the other sets take: these came off a
// video decoder and a PDF renderer rather than a camera, and re-encoding them
// through JPEG first would add generation loss for nothing.
{
  const all = JSON.parse(readFileSync(join(SRC, 'future/credits.json'), 'utf8'));
  // `gallery-` is the prefix, and it is load-bearing rather than a naming
  // habit: the two sets get different outputs — the plates a 1600 and an 800,
  // the gallery a 1600 and a cropped 480 thumbnail — so something has to tell
  // them apart, and a prefix in one file beats a second credits list.
  const entries = Object.entries(all);
  const future = Object.fromEntries(entries.filter(([k]) => !k.startsWith('gallery-')));
  const gallery = Object.fromEntries(entries.filter(([k]) => k.startsWith('gallery-')));

  for (const name of Object.keys(future).sort()) {
    const source = join(SRC, `future/${name}.png`);
    write(join(PUBLIC, `img/future/${name}-1600.webp`), await webp(source, { width: 1600, quality: 80 }));
    write(join(PUBLIC, `img/future/${name}-800.webp`), await webp(source, { width: 800, quality: 76 }));
  }

  // The gallery on the same page — ten more frames from the flythrough, shown
  // as a grid of thumbnails that open full size in a dialog.
  //
  // **Three widths, not two, and the small one is a real crop.** The ten
  // pictures in the set above are each read at something near their emitted
  // size; a gallery thumbnail is 320px in a grid and a 1600px file behind it is
  // 100 KB spent on a picture the size of a playing card. So: 480 for the grid,
  // 1600 for the dialog, and nothing in between — a reader who opens one has
  // asked for it, and the 1600 arrives then.
  //
  // The thumbnail is the only cropped output in this whole block. Everything
  // else on this page is `fit: 'inside'` because a drawing must not lose its
  // margins; a grid of ten wants one shape, and 3:2 out of the flythrough's
  // 16:9 keeps the building and drops sky. `position: 'attention'` picks the
  // window by entropy rather than taking the centre, which matters here because
  // half these frames put the church off to one side.
  for (const name of Object.keys(gallery).sort()) {
    const source = join(SRC, `future/${name}.png`);
    write(
      join(PUBLIC, `img/future/${name}-1600.webp`),
      await webp(source, { width: 1600, quality: 80 }),
    );
    write(
      join(PUBLIC, `img/future/${name}-480.webp`),
      await webp(source, { width: 480, height: 320, quality: 74, position: 'attention' }),
    );
  }
}

// ── The consultants' marks ──────────────────────────────────────────────────
// The logos of the firms working on the new church, for the credentials band at
// the foot of /about/future-plans. **Third-party trademarks, resized and
// converted and not otherwise touched** — no crop, no recolour, no redraw. Same
// treatment and same reasoning as the app icons on /apps; see assets/README.md.
//
// **Optional, and the page is built to be complete without them.** This block
// is skipped entirely if `assets/future/logos/` is absent, and
// `features/future/logos.ts` lists the directory at build time rather than
// emitting a path per firm — so a firm with no mark renders as its name and a
// missing file is never a broken image. Two of the nine (Code Red and Dillis &
// Roy) may never have one.
//
// Whatever is dropped in gets used: the filename minus its extension is the
// `slug` in `features/future/plan.ts`, so adding a mark is a file and a rebuild
// rather than a code change. PNG or SVG in, WebP out.
//
// 240 and 480 rather than the 800/1600 above: these are shown at 120px tall in
// a row and 480 covers that to 2× on any screen. `fit: 'inside'` with no height
// keeps each mark whole — these are wordmarks of wildly different proportions,
// from MDM's long single line to dsk's square, and a cover crop to a common
// ratio would cut the words off. The row's CSS does the aligning.
//
// **A leading underscore means "not a logo".** `scripts/slice-logo-sheet.mjs`
// leaves the composite sheet it cut the marks out of in this directory as
// `_sheet.png` — renamed rather than deleted, because it is the only copy of
// the artwork and the crop boxes may need adjusting against it later. Without
// this skip that composite would be published as a tenth mark and the band
// would show all seven logos again in one box.
if (existsSync(join(SRC, 'future/logos'))) {
  const logos = readdirSync(join(SRC, 'future/logos'))
    .filter((file) => /\.(png|jpe?g|svg|webp)$/i.test(file) && !file.startsWith('_'))
    .sort();

  for (const file of logos) {
    const slug = file.replace(/\.[^.]+$/, '');
    const source = join(SRC, `future/logos/${file}`);
    write(join(PUBLIC, `img/future/logos/${slug}-240.webp`), await webp(source, { width: 240, quality: 86 }));
    write(join(PUBLIC, `img/future/logos/${slug}-480.webp`), await webp(source, { width: 480, quality: 84 }));
  }
}

// ── Deliberately not built ──────────────────────────────────────────────────
// public/video/future-flythrough-720.mp4
//                       Not an image, so not this script's job, and it is
//                       committed rather than regenerated: 720p CRF 28 out of
//                       a 538 MB 1080p master that is **not** in the
//                       repository. The command is recorded in
//                       assets/README.md. If the flythrough is ever re-cut,
//                       re-run it by hand and re-pull the eight stills above
//                       — their timestamps are in assets/future/credits.json.
// assets/Future Plans/  The three documents this page was written from: the
//                       flythrough master, the June 2025 renderings, and the
//                       33-sheet December 2025 permit set. 607 MB between
//                       them, gitignored. See assets/README.md.
// Coptic_cross_top_church.jpeg
//                       381×524, which is too small for anything this site
//                       still asks for. It had two jobs and has lost both:
//                       the hero's fourth frame, where a 2.591:1 window cut
//                       from a 524px-tall portrait was a 147px strip of
//                       crossbar upscaled four-fold and blurred to hide it,
//                       and the welcome section, now `coptic_cross_image.png`
//                       above. Keep it — a full-size original of the same
//                       shot would be genuinely useful — but nothing reads it
//                       today. See assets/README.md.
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
