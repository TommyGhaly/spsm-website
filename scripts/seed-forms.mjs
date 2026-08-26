/**
 * Create the parish's forms, once.
 *
 * ---------------------------------------------------------------------------
 * Does not overwrite. Same rule as `seed-programs.mjs`, for the same reason.
 *
 * A form is edited by staff in the drawer on /forms — questions reordered,
 * options renamed, a notification address added, a registration closed. None of
 * that comes back here, so clobbering on a re-run would quietly undo somebody's
 * afternoon. Missing forms are created; existing ones are reported and left
 * exactly as they are.
 * ---------------------------------------------------------------------------
 *
 * Four forms, and the vehicle one is the odd one out.
 *
 *   vehicle-registration  — `kind: 'vehicle'`, rendered by a hand-written
 *                           component, writes to the Taksis project rather than
 *                           to us. Published, because it replaces the form at
 *                           /parking that people already use.
 *   van-request           — the three Breeze forms, rebuilt natively with their
 *   new-service-request      conditional fields intact. Created **unpublished**:
 *   events-request          each is still live in Breeze, and publishing one
 *                           here means the office has two places to look until
 *                           somebody decides to take the Breeze one down. That
 *                           is a decision for the parish, made per form, not
 *                           something a seed script should make for them.
 *
 * The definitions themselves are in `lib/form-definitions.mjs`, shared with the
 * emulator seeder so the local /forms and the real one cannot disagree about
 * which questions a form asks.
 *
 * Usage:
 *   node scripts/seed-forms.mjs              # dry run
 *   node scripts/seed-forms.mjs -- --write   # apply
 */
import { accessToken, documentUrl, toFieldMap } from './lib/firestore-rest.mjs';
import { seedForms } from './lib/form-definitions.mjs';

process.loadEnvFile('.env');

const write = process.argv.includes('--write');
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!project) {
  console.error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set. Is .env present?');
  process.exit(1);
}

const authHeader = { Authorization: `Bearer ${accessToken()}` };

/* ------------------------------------------------------------------------ */

const FORMS = seedForms();

/* ------------------------------------------------------------------------ */

let existing = 0;
let created = 0;
let exitCode = 0;

console.log(write ? 'Writing forms…' : 'Dry run — nothing will be written.');
console.log('');

for (const form of FORMS) {
  const url = documentUrl(project, `forms/${form.slug}`);
  const res = await fetch(url, { headers: authHeader });

  if (res.ok) {
    existing += 1;
    console.log(`  = forms/${form.slug}  — already there, left alone`);
    continue;
  }

  if (res.status !== 404) {
    console.error(`  ! forms/${form.slug}: read failed, HTTP ${res.status}`);
    exitCode = 1;
    continue;
  }

  const document = {
    ...form,
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedBy: null,
  };

  created += 1;
  const state = document.published ? 'published' : 'unpublished';
  console.log(
    `  + forms/${form.slug}  — "${form.title}" (${state}, ${form.fields.length} questions)`,
  );

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
  console.log('');
  console.log('Next, on /forms while signed in as staff — "Forms & submissions":');
  console.log('  1. Add a notification address to each form, or nobody is told when one arrives.');
  console.log('  2. Publish the three rebuilt Breeze forms once you are ready to take');
  console.log('     the Breeze originals down. Until then they are drafts, and the');
  console.log('     Breeze versions keep working.');
}

process.exitCode = exitCode;
