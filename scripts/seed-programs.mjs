/**
 * Create the parish's five standing programs, once.
 *
 * **This script does not overwrite, and that is the whole difference between it
 * and `seed-content`.** Those pages are prose that lives in git, gets reviewed
 * in a PR, and is pushed out from the repo. A program is not: a superadmin
 * renames it, rewrites its description, and picks its cover photograph from the
 * admin screen, and none of that comes back here. Clobbering on a re-run would
 * quietly undo somebody's afternoon.
 *
 * So: missing programs are created, existing ones are reported and left exactly
 * as they are. Re-running is safe and does nothing.
 *
 * The three descriptions that already exist come from `content/ministries/*.md`
 * — unpublished drafts written against the old Wix copy, which is where their
 * text should end up rather than being retyped here and drifting. Summercamp
 * and Iconography have no draft, and get a placeholder that says so out loud.
 *
 * Every program is created **unpublished**. A program with no photographs in it
 * is not something to put in front of a visitor, and publishing is a decision
 * somebody should make on purpose once there is a gallery worth seeing.
 *
 * Usage:
 *   node scripts/seed-programs.mjs              # dry run
 *   node scripts/seed-programs.mjs -- --write   # apply
 */
import { readFileSync, existsSync } from 'node:fs';
import { accessToken, documentUrl, fromFirestore, toFieldMap } from './lib/firestore-rest.mjs';

process.loadEnvFile('.env');

const write = process.argv.includes('--write');
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!project) {
  console.error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set. Is .env present?');
  process.exit(1);
}

const authHeader = { Authorization: `Bearer ${accessToken()}` };

/**
 * Pull the prose out of a ministries draft, minus its front matter.
 *
 * The `REPLACE —` notes in those files are kept rather than stripped. They are
 * accurate — the old site really did say nothing more than the day it meets —
 * and an administrator who opens the editor and finds a note telling them what
 * is missing is better served than one who finds two thin sentences that look
 * finished.
 */
function draftBody(file) {
  const path = `content/ministries/${file}`;
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  return match ? match[1].trim() : null;
}

const NO_DRAFT = (name) =>
  `REPLACE — ${name} had no page on the old site, so there is nothing to carry ` +
  `across. Worth saying before this is published: what it is, who it is for, ` +
  `when it runs, and who to ask.`;

/**
 * The five, in the order they should appear.
 *
 * Slugs match the anchors in the `/projects-7-*` redirects in firebase.json —
 * those are the only surviving addresses of these ministries from the Wix site,
 * and re-pointing them at the new program URLs is a one-line change only while
 * the slugs agree.
 */
const PROGRAMS = [
  {
    slug: 'summercamp',
    name: 'Summercamp',
    description: draftBody('40-summercamp.md') ?? NO_DRAFT('Summercamp'),
    order: 10,
  },
  {
    slug: 'st-simon-for-seniors',
    name: 'St. Simon for Seniors',
    description: draftBody('30-st-simon-for-seniors.md') ?? NO_DRAFT('St. Simon for Seniors'),
    order: 20,
  },
  {
    slug: 'college-and-young-professionals',
    name: 'College and Young Professionals',
    description:
      draftBody('10-college-and-young-professionals.md') ??
      NO_DRAFT('College and Young Professionals'),
    order: 30,
  },
  {
    slug: 'mother-of-mercy',
    name: 'Mother of Mercy',
    description: draftBody('20-mother-of-mercy.md') ?? NO_DRAFT('Mother of Mercy'),
    order: 40,
  },
  {
    // "Optionally iconography class", per the parish. Seeded because a program
    // that exists and is unpublished costs nothing and can be switched on in a
    // second; one that does not exist needs this script run again.
    slug: 'iconography',
    name: 'Iconography Class',
    description: draftBody('50-iconography.md') ?? NO_DRAFT('the iconography class'),
    order: 50,
  },
];

// ---------------------------------------------------------------------------

let created = 0;
let existing = 0;
let exitCode = 0;

for (const program of PROGRAMS) {
  const url = documentUrl(project, `programs/${program.slug}`);
  const res = await fetch(url, { headers: authHeader });

  if (res.ok) {
    const before = fromFirestore((await res.json()).fields ?? {});
    existing += 1;
    console.log(`  = programs/${program.slug}  — already exists ("${before.name}"), left alone`);
    continue;
  }

  if (res.status !== 404) {
    console.error(`  ! programs/${program.slug}: read failed, HTTP ${res.status}`);
    exitCode = 1;
    continue;
  }

  const document = {
    ...program,
    coverMediaId: null,
    published: false,
    publishAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedBy: null,
  };

  created += 1;
  const sourced = program.description.startsWith('REPLACE —') ? 'placeholder text' : 'draft prose';
  console.log(`  + programs/${program.slug}  — "${program.name}" (unpublished, ${sourced})`);

  if (!write) continue;

  const put = await fetch(url, {
    method: 'PATCH',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFieldMap(document) }),
  });

  if (!put.ok) {
    console.error(`      write failed: HTTP ${put.status} ${(await put.text()).slice(0, 300)}`);
    exitCode = 1;
  }
}

console.log('');
console.log(`${existing} already there, ${created} to create.`);

if (created > 0 && !write) {
  console.log('Dry run. Re-run with --write to apply.');
} else if (created > 0) {
  console.log('Created. All five are unpublished — publish each one from /admin once it has a gallery.');
}

process.exitCode = exitCode;
