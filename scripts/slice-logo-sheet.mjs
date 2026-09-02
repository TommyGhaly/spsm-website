#!/usr/bin/env node
/**
 * Cut the consultants' logo sheet into one file per firm.
 *
 * ---------------------------------------------------------------------------
 * The marks for the credentials band on /about/future-plans arrived as **one
 * composite image** — seven logos laid out on a white ground, two rows. This
 * cuts it into the seven files `scripts/optimize-assets.mjs` expects in
 * `assets/future/logos/`, named after the `slug` in
 * `apps/website/src/features/future/plan.ts`.
 *
 * Run once, by hand, and throw the composite away. `npm run logos` finds the
 * sheet three ways, in this order, and the first that works wins:
 *
 *   1. **A path given on the command line.** Always wins if present.
 *   2. **The macOS clipboard** — an image on it, or a file copied in Finder.
 *   3. **Any unrecognised image sitting in `assets/future/logos/`.** Drag the
 *      file into that folder under any name at all and run `npm run logos`.
 *
 * Three routes rather than one because getting this one image into the repo
 * failed twice, differently. First "save it as `_sheet.png`" — the file was
 * never saved. Then the clipboard, which worked, until copying the script's own
 * error message to report it back overwrote the image. Route 3 is the one that
 * survives both: a file dragged into a folder stays there, and nothing about
 * telling somebody it worked can destroy it.
 *
 * A sheet found by route 3 is renamed `_sheet.<ext>` once it has been cut up,
 * so that `optimize-assets.mjs` — which builds every image in that directory —
 * does not also publish the composite as a tenth logo. That skip is why the
 * underscore means something; see the note there.
 *
 * **Why not just crop tightly and be done.** The boxes below are *fractions of
 * the sheet*, not pixels, so they survive whatever resolution the file arrives
 * at — and they are deliberately generous, because each crop is then handed to
 * sharp's `trim()`, which walks in from the edges and removes everything
 * matching the corner pixel. So the boxes only have to isolate one logo from
 * its neighbours; `trim()` finds the actual ink. A box that is 20% too big is
 * fine. A box that clips a descender is not, which is why they err large.
 *
 * `threshold: 12` on the trim rather than the default: these are JPEG-ish
 * whites with compression noise around the type, and a zero threshold trims
 * nothing at all off a "white" that is actually 253,253,254.
 *
 * The output is PNG with an alpha channel and the white flooded out is *not*
 * removed — these marks are drawn for white paper and the band gives each one a
 * white card for that reason. Knocking the background out would leave dark type
 * on a dusty-rose ground, which is worse and is also an alteration of somebody
 * else's trademark.
 *
 * Nothing else is done to them: no recolour, no redraw, no rounding. See
 * `assets/future/logos/README.md`.
 * ---------------------------------------------------------------------------
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets/future/logos');

/**
 * The firms on the sheet, in reading order: four across the top row, three
 * across the bottom.
 *
 * **Order, not coordinates**, and that is the whole design of this script. The
 * first version carried seven hand-estimated `[left, top, right, bottom]`
 * fractions read off a picture of the sheet. Guessing coordinates from a
 * screenshot was never going to survive the real file, and it did not: the
 * boxes were out by enough to be worth measuring instead.
 *
 * So the boxes are measured from the image and this list only says which mark
 * is which. Change it if a different sheet ever arrives with the firms in a
 * different arrangement; there are no pixel numbers left to keep in step with
 * anything.
 */
const ORDER = [
  ['dsk', 'goddard-consulting', 'crowley-cottrell', 'oak-consulting-group'],
  ['mdm', 'buro-happold', 'foley-buhl-roberts'],
];

/** Anything darker than this on a 0–255 grey channel counts as ink. The sheet's
    ground is pure white; JPEG ringing around type lands in the 246–254 band,
    which is why this is not 254. */
const INK = 245;

/** Blank rows that still belong to the same row of logos. Measured: the gap
    between the dsk block and the word "architects" under it is five rows, and
    the gap between the two rows of the sheet is 142. Anything in between would
    be a sheet laid out differently enough to want looking at. */
const ROW_GAP = 40;

/** Blank columns that still belong to the same mark. Measured on the delivered
    sheet: the letter-spacing inside "a r c h i t e c t s" opens gaps of 18–20px,
    and the tightest gap between two different marks — Goddard to Crowley — is
    30. There is not a lot of room here, which is why both numbers are written
    down rather than left as a magic constant. */
const COL_GAP = 25;

/** Padding left around each detected block before `trim()` takes over, so a
    faint edge pixel just outside the threshold is not shaved off. */
const PAD = 4;

/**
 * Find the marks on the sheet by projection.
 *
 * Rows first: sum ink per row, split on runs of blank rows longer than
 * `ROW_GAP`. Then columns within each row band, split on runs of blank columns
 * longer than `COL_GAP`. Two passes of the same one-dimensional idea, which is
 * enough because the sheet is a grid — a connected-component labeller would
 * handle a scattered layout and is not worth it for this.
 *
 * Row-merging has to happen *before* the column pass, and that ordering is the
 * subtle part: over the top band alone, "architects" is eight separate blocks
 * with 20px gaps; merged with the solid red square above it, the whole dsk mark
 * is one unbroken column run.
 */
async function findBlocks(file) {
  const { data, info } = await sharp(file)
    .flatten({ background: '#fff' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: W, height: H } = info;
  const ink = (x, y) => data[y * W + x] < INK;

  const runs = (length, hasInk, gap) => {
    const out = [];
    let start = null;
    let blank = 0;
    for (let i = 0; i < length; i++) {
      if (hasInk(i)) {
        if (start === null) start = i;
        blank = 0;
      } else if (start !== null) {
        blank++;
        if (blank > gap) {
          out.push([start, i - blank + 1]);
          start = null;
          blank = 0;
        }
      }
    }
    if (start !== null) out.push([start, length]);
    return out;
  };

  const rowHasInk = (y) => {
    for (let x = 0; x < W; x++) if (ink(x, y)) return true;
    return false;
  };

  return runs(H, rowHasInk, ROW_GAP).map(([y0, y1]) => {
    const colHasInk = (x) => {
      for (let y = y0; y < y1; y++) if (ink(x, y)) return true;
      return false;
    };
    return { y0, y1, blocks: runs(W, colHasInk, COL_GAP) };
  });
}

/** The nine firm slugs, so an image that is not one of them can be recognised/** The nine firm slugs, so an image that is not one of them can be recognised
    as the composite sheet rather than a finished mark. Kept in step with
    `TEAM` in `apps/website/src/features/future/plan.ts` by hand — a nine-entry
    list is not worth importing TypeScript into a build script for. */
const SLUGS = new Set(ORDER.flat());

const IMAGE = /\.(png|jpe?g|webp|tiff?|gif)$/i;

/**
 * A composite sheet somebody dropped into `assets/future/logos/` under whatever
 * name it arrived with.
 *
 * Any image in that directory whose stem is not one of the nine slugs and does
 * not already start with `_`. If there is more than one, refuse rather than
 * guess — cutting the wrong picture into seven logos is a mess to notice.
 */
function fromLogoDir() {
  if (!existsSync(OUT)) return null;
  const strays = readdirSync(OUT).filter(
    (f) => IMAGE.test(f) && !f.startsWith('_') && !SLUGS.has(f.replace(/\.[^.]+$/, '')),
  );
  if (strays.length === 0) return null;
  if (strays.length > 1) {
    console.error(
      `More than one unrecognised image in assets/future/logos/:\n  ${strays.join('\n  ')}\n` +
        'Leave only the composite sheet there, or pass its path directly.',
    );
    process.exit(1);
  }
  return join(OUT, strays[0]);
}

/**
 * Write whatever image is on the macOS clipboard to a temporary PNG.
 *
 * `«class PNGf»` is the pasteboard's PNG flavour and macOS will convert to it
 * from any of the others it is holding — TIFF, JPEG, Photoshop, whatever the
 * image was copied as. `set eof fh to 0` truncates first, because `write` to an
 * existing longer file leaves the tail of the old one behind and produces a
 * PNG that decodes and then has garbage after it.
 *
 * Throws with a readable message rather than AppleScript's `-1728` if there is
 * no image on the clipboard, because that is the likely case and the error has
 * to say what to do about it.
 */
function fromClipboard() {
  const out = join(tmpdir(), `spsm-logo-sheet-${process.pid}.png`);
  const script = [
    'on run argv',
    '  set outFile to POSIX file (item 1 of argv)',
    '  set fh to open for access outFile with write permission',
    '  set eof fh to 0',
    '  write (the clipboard as \u00abclass PNGf\u00bb) to fh',
    '  close access fh',
    'end run',
  ].join('\n');

  try {
    execFileSync('osascript', ['-e', script, out], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch {
    /*
     * Not an image on the pasteboard — but a file copied in Finder is a `furl`,
     * and that is a perfectly good way to hand over a sheet. Try it before
     * giving up.
     */
    try {
      const path = execFileSync(
        'osascript',
        ['-e', 'POSIX path of (the clipboard as \u00abclass furl\u00bb)'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ).trim();
      if (path && IMAGE.test(path) && existsSync(path)) return path;
    } catch {
      /* Neither an image nor a file. Fall through to null. */
    }
    return null;
  }

  if (!existsSync(out) || statSync(out).size === 0) return null;
  return out;
}

const args = process.argv.slice(2);
const untrimmed = args.includes('--boxes');
const given = args.find((a) => !a.startsWith('--'));

let sheetPath = given;
let temporary = false;

let stray = null;

if (sheetPath) {
  if (!existsSync(sheetPath)) {
    console.error(`no such file: ${sheetPath}`);
    process.exit(1);
  }
} else {
  const clipped = process.platform === 'darwin' ? fromClipboard() : null;
  if (clipped) {
    sheetPath = clipped;
    // Only the PNG we wrote ourselves is ours to delete; a Finder file is the
    // user's and stays where it is.
    temporary = clipped.startsWith(tmpdir());
    console.log('Read the sheet off the clipboard.');
  } else {
    stray = fromLogoDir();
    if (stray) {
      sheetPath = stray;
      console.log(`Read the sheet from ${stray.replace(`${ROOT}/`, '')}.`);
    }
  }
}

if (!sheetPath) {
  console.error(
    'No logo sheet found. Any one of these works:\n\n' +
      '  1. Drag the image into assets/future/logos/ under any name,\n' +
      '     then run this again. (Most reliable — nothing can wipe it.)\n' +
      '  2. Copy the image, then run this again.\n' +
      '  3. node scripts/slice-logo-sheet.mjs path/to/sheet.png\n',
  );
  process.exit(1);
}

const meta = await sharp(sheetPath).metadata();
console.log(`Sheet is ${meta.width}\u00d7${meta.height}.\n`);
mkdirSync(OUT, { recursive: true });

const rows = await findBlocks(sheetPath);

/*
 * Refuse rather than guess. A sheet that does not come apart into the rows and
 * columns `ORDER` describes would otherwise be cut into seven pictures of the
 * wrong things and silently published — and a logo row is exactly the sort of
 * thing nobody looks at closely again. The message prints what was actually
 * found, because the fix is either ORDER or one of the two gap constants and
 * the numbers say which.
 */
const shape = rows.map((r) => r.blocks.length);
const want = ORDER.map((r) => r.length);
if (shape.length !== want.length || shape.some((n, i) => n !== want[i])) {
  console.error(
    `Expected ${want.join(' + ')} marks in ${want.length} rows; found ${shape.join(' + ')}.\n\n` +
      rows
        .map(
          (r, i) =>
            `  row ${i + 1} (y ${r.y0}\u2013${r.y1}): ` +
            r.blocks.map(([a, b]) => `${a}\u2013${b}`).join(', '),
        )
        .join('\n') +
      '\n\nIf the sheet is laid out differently, update ORDER. If two marks ran\n' +
      'together or one split in half, COL_GAP or ROW_GAP is the number to move.',
  );
  process.exit(1);
}

for (const [rowIndex, row] of rows.entries()) {
  for (const [colIndex, [x0, x1]] of row.blocks.entries()) {
    const slug = ORDER[rowIndex][colIndex];

    const left = Math.max(0, x0 - PAD);
    const top = Math.max(0, row.y0 - PAD);
    const width = Math.min(meta.width - left, x1 - x0 + PAD * 2);
    const height = Math.min(meta.height - top, row.y1 - row.y0 + PAD * 2);

    /*
     * **Two sharp passes, and they cannot be one.** sharp applies operations in
     * its own fixed order rather than the order they are called, and `trim`
     * comes *before* `extract` in that order — so `sharp(f).extract(box).trim()`
     * trims the whole sheet's white margin away first and then extracts `box`
     * from the shifted image. Every crop lands somewhere it was not asked for,
     * and the last one runs off the right edge and dies with
     * `extract_area: bad extract area`, which is what sent me looking for a bad
     * box when the boxes were fine. Crop to a buffer, then trim the buffer.
     */
    const cropped = await sharp(sheetPath)
      .flatten({ background: '#fff' })
      .extract({ left, top, width, height })
      .png()
      .toBuffer();

    let pipeline = sharp(cropped);
    if (!untrimmed) pipeline = pipeline.trim({ threshold: 12 });

    const file = join(OUT, `${slug}.png`);
    const info = await pipeline.png().toFile(file);
    console.log(
      `  ${String(info.width).padStart(5)}\u00d7${String(info.height).padEnd(5)} ${slug}.png`,
    );
  }
}

if (temporary) rmSync(sheetPath, { force: true });

/*
 * Rename a sheet found in the logos directory so `optimize-assets.mjs` does not
 * build the composite as a tenth mark. Renamed rather than deleted: it is the
 * only copy of the artwork we have, and the boxes above may need adjusting
 * against it.
 */
if (stray) {
  const kept = join(OUT, `_sheet${extname(stray)}`);
  renameSync(stray, kept);
  console.log(`\nKept the composite as ${kept.replace(`${ROOT}/`, '')} \u2014 the leading`);
  console.log('underscore is what stops `npm run assets` publishing it as a logo.');
}

console.log(
  `\n${ORDER.flat().length} marks written to assets/future/logos/.` +
    (untrimmed ? ' (untrimmed \u2014 check the boxes, then re-run without --boxes)' : '') +
    '\nRun `npm run assets` to build them.',
);
