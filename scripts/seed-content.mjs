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
import { accessToken, documentUrl, fromFirestore, toFieldMap } from './lib/firestore-rest.mjs';
import { collectPages } from './lib/content-files.mjs';

process.loadEnvFile('.env');

const write = process.argv.includes('--write');
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!project) {
  console.error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set. Is .env present?');
  process.exit(1);
}

const authHeader = { Authorization: `Bearer ${accessToken()}` };

// ---------------------------------------------------------------------------

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
  console.error('No markdown found under content/. See content/README.md.');
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
