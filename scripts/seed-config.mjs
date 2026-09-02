/**
 * Create or inspect the documents in the `config` collection.
 *
 * Writing to `config` needs the `admin` custom claim, and no user has one yet,
 * so this goes in over the Firestore REST API with your own gcloud credentials
 * — which bypass security rules the same way the Admin SDK does. That avoids
 * making you set up Application Default Credentials just to write a document.
 *
 * Prerequisite: `gcloud auth login` (already done if `gcloud` works elsewhere).
 *
 * `--write` never clobbers a document that already exists. These are edited by
 * hand in the Firebase console, and a seed script that overwrites the parish's
 * real phone number with a blank default would be a genuinely bad afternoon.
 * Use `--force` to overwrite deliberately.
 *
 * `--only=<id>` narrows it to one document, and is the safe way to push a theme
 * change: `--force` on its own overwrites all three, so re-publishing the design
 * tokens would take the parish's real address and phone number down with them.
 *
 * Usage:
 *   npm run config                  # show what is there now
 *   npm run config -- --write       # create anything missing
 *   npm run config -- --write --force --only=theme
 */
import {
  DEFAULT_INTEGRATIONS_CONFIG,
  DEFAULT_PARISH_CONFIG,
  DEFAULT_THEME,
  defaultCampConfig,
} from '../packages/shared/dist/index.js';
import { accessToken, documentUrl, fromFirestore, toFieldMap } from './lib/firestore-rest.mjs';

process.loadEnvFile('.env');

const write = process.argv.includes('--write');
const force = process.argv.includes('--force');
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

const ALL_DOCS = [
  { id: 'integrations', defaults: DEFAULT_INTEGRATIONS_CONFIG },
  { id: 'parish', defaults: DEFAULT_PARISH_CONFIG },
  // Design tokens. Unlike the two above, seeding this is optional — the site
  // ships the same values in its bundle and renders identically without the
  // document. Writing it is what makes the theme *editable*, so it is worth
  // doing before handing the console to anyone.
  { id: 'theme', defaults: DEFAULT_THEME },
  /*
   * Summer camp: the season, the weekly fee per child, and the waiver.
   *
   * Seeding this creates a document with a fee of **zero** and an empty waiver,
   * which is the deliberate shape of the default — a seeded fee is a number
   * somebody has to notice and correct, and the failure mode of noticing late
   * is a family told the wrong price at a desk. The registration screen shows
   * "No fee set" and refuses to offer the waiver tick until the text is there.
   *
   * A function rather than a constant because the default season is the current
   * year, which cannot be frozen into a module that gets imported in January
   * and read in July.
   */
  { id: 'camp', defaults: defaultCampConfig() },
];

const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length);
const DOCS = only ? ALL_DOCS.filter((doc) => doc.id === only) : ALL_DOCS;

// An unrecognised id would otherwise select nothing and print a clean, empty,
// entirely successful run — which reads exactly like a write that worked.
if (only && DOCS.length === 0) {
  console.error(`Unknown --only=${only}. Expected one of: ${ALL_DOCS.map((d) => d.id).join(', ')}`);
  process.exit(1);
}

const authHeader = { Authorization: `Bearer ${accessToken()}` };
const urlFor = (id) => documentUrl(project, `config/${id}`);

let exitCode = 0;

for (const { id, defaults } of DOCS) {
  console.log(`\n=== config/${id} ===`);

  const current = await fetch(urlFor(id), { headers: authHeader });
  let exists = false;

  if (current.ok) {
    exists = true;
    const body = await current.json();
    console.log(JSON.stringify(fromFirestore(body.fields ?? {}), null, 2));
  } else if (current.status === 404) {
    console.log('(does not exist yet)');
  } else {
    console.error(`Read failed: HTTP ${current.status} ${(await current.text()).slice(0, 300)}`);
    exitCode = 1;
    continue;
  }

  if (!write) {
    if (!exists) {
      console.log('\nWould create it with:');
      console.log(JSON.stringify(defaults, null, 2));
    }
    continue;
  }

  if (exists && !force) {
    console.log('\nAlready exists — leaving it alone. Use --force to overwrite.');
    continue;
  }

  const res = await fetch(urlFor(id), {
    method: 'PATCH',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFieldMap(defaults) }),
  });

  if (!res.ok) {
    console.error(`Write failed: HTTP ${res.status} ${(await res.text()).slice(0, 500)}`);
    exitCode = 1;
    continue;
  }
  console.log(`\n${exists ? 'Overwrote' : 'Created'} config/${id}.`);
}

if (!write) {
  console.log('\nDry run. Re-run with `-- --write` to create anything missing.');
}
process.exitCode = exitCode;
