/**
 * Push the markdown in `content/` into the Firestore `content` collection.
 *
 * The repo is authoritative for these pages, which is the opposite of
 * `config/*`. Those documents hold facts about a real parish that staff edit in
 * the console, so seed-config refuses to clobber them. These are prose that
 * lives in git, gets reviewed in a PR, and has a history — so this script
 * overwrites by default. It still shows you what it is about to change and
 * still requires `--write`, because "overwrites by default" and "overwrites
 * without telling you" are different things.
 *
 * Layout:
 *
 *   content/<section>/<order>-<slug>.md
 *   content/about/10-who-we-are.md   ->  section 'about', order 10, id 'who-we-are'
 *
 * Section comes from the directory and is validated against CONTENT_SECTIONS.
 * That check is the whole reason this script exists rather than people typing
 * into the console: `getContentPages` queries `where('section','==',…)`, so a
 * typo does not error — the page silently vanishes from the site, and nothing
 * anywhere says why.
 *
 * The slug is the document id, so re-running updates in place instead of
 * accumulating duplicates.
 *
 * Front matter is `key: value` lines between `---` fences. Dotted keys nest, so
 * the format stays dependency-free rather than pulling in a YAML parser for
 * what is a flat list of strings:
 *
 *   ---
 *   title: Who We Are
 *   published: true
 *   seo.description: A Coptic Orthodox parish in Wayland, Massachusetts.
 *   person.name: Fr. Youhanna
 *   person.rank: Priest
 *   ---
 *
 * Usage:
 *   node scripts/seed-content.mjs              # dry run: show every change
 *   node scripts/seed-content.mjs -- --write   # apply
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { CONTENT_SECTIONS } from '../packages/shared/dist/index.js';
import { accessToken, documentUrl, fromFirestore, toFieldMap } from './lib/firestore-rest.mjs';

process.loadEnvFile('.env');

const write = process.argv.includes('--write');
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const ROOT = 'content';

if (!project) {
  console.error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set. Is .env present?');
  process.exit(1);
}

const authHeader = { Authorization: `Bearer ${accessToken()}` };

// ---------------------------------------------------------------------------

/** Split front matter from body. Returns null if the file has no front matter. */
function splitFrontMatter(raw, file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    throw new Error(`${file}: no front matter. Expected a --- fenced block at the top.`);
  }
  return { frontMatter: match[1], body: match[2].trim() };
}

/**
 * `key: value` lines into a nested object, splitting dotted keys.
 *
 * Values are strings except for the three shapes that have to survive the trip
 * as themselves: `true`/`false`, integers, and the literal `null`. Everything
 * else stays a string, deliberately — guessing types out of prose is how a
 * title of "2024" becomes a number.
 */
function parseFrontMatter(text, file) {
  const out = {};

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const at = line.indexOf(':');
    if (at === -1) {
      throw new Error(`${file}:${index + 1}: expected "key: value", got: ${line}`);
    }

    const key = line.slice(0, at).trim();
    const raw = line.slice(at + 1).trim();

    let value = raw;
    if (raw === 'true') value = true;
    else if (raw === 'false') value = false;
    else if (raw === 'null' || raw === '') value = null;
    else if (/^-?\d+$/.test(raw)) value = Number(raw);

    // Dotted keys nest: `seo.description` -> { seo: { description } }.
    const path = key.split('.');
    let cursor = out;
    for (const segment of path.slice(0, -1)) {
      cursor[segment] ??= {};
      cursor = cursor[segment];
    }
    cursor[path.at(-1)] = value;
  }

  return out;
}

/** `10-who-we-are.md` -> { order: 10, slug: 'who-we-are' }. */
function parseFilename(file) {
  const name = basename(file, '.md');
  const match = /^(\d+)-(.+)$/.exec(name);
  if (!match) {
    throw new Error(
      `${file}: filename must be <order>-<slug>.md, e.g. 10-who-we-are.md. ` +
        `Order drives nav position; slug becomes the document id and the URL.`,
    );
  }
  return { order: Number(match[1]), slug: match[2] };
}

/** Every markdown file under content/, as a ContentPage-shaped document. */
function collectPages() {
  let sections;
  try {
    sections = readdirSync(ROOT).filter((d) => statSync(join(ROOT, d)).isDirectory());
  } catch {
    console.error(`No ${ROOT}/ directory. See ${ROOT}/README.md for the layout.`);
    process.exit(1);
  }

  const pages = [];

  for (const section of sections) {
    if (!CONTENT_SECTIONS.includes(section)) {
      throw new Error(
        `${ROOT}/${section}/ is not a known section. Expected one of: ` +
          `${CONTENT_SECTIONS.join(', ')}. A section the site does not query for ` +
          `renders nowhere, and nothing reports it.`,
      );
    }

    const files = readdirSync(join(ROOT, section)).filter((f) => f.endsWith('.md'));

    for (const file of files) {
      const path = join(ROOT, section, file);
      const { order, slug } = parseFilename(file);
      const { frontMatter, body } = splitFrontMatter(readFileSync(path, 'utf8'), path);
      const meta = parseFrontMatter(frontMatter, path);

      if (!meta.title) throw new Error(`${path}: front matter needs a "title".`);
      if (!body) throw new Error(`${path}: the body is empty.`);

      pages.push({
        path,
        slug,
        document: {
          slug,
          title: String(meta.title),
          body,
          order,
          section,

          // `published` defaults to false: a file existing in the repo is not
          // the same as the parish having approved it for the website.
          published: meta.published === true,

          // Always null. `publishAt` is an instruction to a scheduled Function
          // that does not exist yet, and a future publishAt on a published
          // document is an inconsistent state that `withoutEmbargoed` reports
          // at build time. See docs/decisions.md #10.
          publishAt: null,

          person: meta.person
            ? {
                name: String(meta.person.name ?? ''),
                rank: String(meta.person.rank ?? ''),
                portraitPath: meta.person.portraitPath ?? null,
                email: meta.person.email ?? null,
              }
            : null,

          seo: {
            description: meta.seo?.description ?? null,
            ogImagePath: meta.seo?.ogImagePath ?? null,
          },

          updatedAt: new Date(),
          updatedBy: null,
        },
      });
    }
  }

  return pages.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Fields that differ between what is in Firestore and what the repo says. */
function changedFields(before, after) {
  if (!before) return ['(new document)'];

  const changed = [];
  for (const key of Object.keys(after)) {
    // `updatedAt` is set on every write and `createdAt` is carried over from
    // `before`; reporting either would mark every page as changed on every run.
    if (key === 'updatedAt' || key === 'createdAt') continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
  }
  return changed;
}

// ---------------------------------------------------------------------------

let pages;
try {
  pages = collectPages();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (pages.length === 0) {
  console.error(`No markdown found under ${ROOT}/. See ${ROOT}/README.md.`);
  process.exit(1);
}

let exitCode = 0;
let toWrite = 0;

for (const { path, slug, document } of pages) {
  const url = documentUrl(project, `content/${slug}`);
  const existing = await fetch(url, { headers: authHeader });

  let before = null;
  if (existing.ok) {
    before = fromFirestore((await existing.json()).fields ?? {});
  } else if (existing.status !== 404) {
    console.error(`content/${slug}: read failed, HTTP ${existing.status}`);
    exitCode = 1;
    continue;
  }

  // Preserved across re-runs, because this is when the page first existed, not
  // when the script last touched it. PATCH would leave an omitted field alone,
  // but a new document has to get one from somewhere.
  document.createdAt = before?.createdAt instanceof Date ? before.createdAt : new Date();

  const changed = changedFields(before, document);
  const state = document.published ? 'published' : 'draft';

  if (changed.length === 0) {
    console.log(`  = content/${slug}  (${state}, unchanged)`);
    continue;
  }

  toWrite += 1;
  console.log(`  ${before ? '~' : '+'} content/${slug}  (${state}) — ${changed.join(', ')}`);
  console.log(`      from ${path}`);

  if (!write) continue;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFieldMap(document) }),
  });

  if (!res.ok) {
    console.error(`      write failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    exitCode = 1;
  }
}

console.log('');
if (!write) {
  console.log(
    toWrite === 0
      ? 'Everything is already up to date.'
      : `Dry run — ${toWrite} document(s) would change. Re-run with --write to apply.`,
  );
} else {
  console.log(`Wrote ${toWrite} document(s).`);
  if (toWrite > 0) {
    console.log('The site shows them at the next build. See the rebuild hook, or deploy by hand.');
  }
}

process.exitCode = exitCode;
