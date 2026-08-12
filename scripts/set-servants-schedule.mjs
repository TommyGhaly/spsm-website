/**
 * Point the servants schedule at a Breeze calendar.
 *
 * Its own script, and not a value in this repo, for one reason: the Breeze
 * embed URL is a bearer credential. It returns the calendar to anyone who
 * requests it — no session, no referrer check — so committing it would publish
 * the parish rota to anyone who reads the repository, and baking it into the
 * static site would publish it to everyone else.
 *
 * It goes in `servantsConfig/schedule`, which `firestore.rules` gates on the
 * `servant` claim, and the website fetches it in the browser after sign-in.
 *
 * Writing there needs the `admin` claim; this goes in over the REST API with
 * your own gcloud credentials, which bypass rules the same way the Admin SDK
 * does. Same pattern as seed-config.mjs.
 *
 * Usage:
 *   node scripts/set-servants-schedule.mjs                       # show current
 *   node scripts/set-servants-schedule.mjs --url '<embed url>' --write
 *   node scripts/set-servants-schedule.mjs --url '…' --note 'Updated weekly' --write
 *
 * Quote the URL. It contains `&`, which the shell will otherwise read as
 * "run this in the background" and hand you a truncated URL that half works.
 */
import { isAllowedEmbedUrl, parseServantsSchedule } from '../packages/shared/dist/index.js';
import { accessToken, documentUrl, fromFirestore, toFieldMap } from './lib/firestore-rest.mjs';

process.loadEnvFile('.env');

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const at = args.indexOf(flag);
  return at === -1 ? null : (args[at + 1] ?? null);
};

const write = args.includes('--write');
const url = valueOf('--url');
const note = valueOf('--note');
const manageUrl = valueOf('--manage-url');
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!project) {
  console.error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set. Is .env present?');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${accessToken()}` };
const target = documentUrl(project, 'servantsConfig/schedule');

const existing = await fetch(target, { headers });
let current = null;

if (existing.ok) {
  current = parseServantsSchedule(fromFirestore((await existing.json()).fields ?? {}));
} else if (existing.status !== 404) {
  console.error(`Read failed: HTTP ${existing.status} ${(await existing.text()).slice(0, 300)}`);
  process.exit(1);
}

console.log('servantsConfig/schedule');
if (!current) {
  console.log('  (does not exist yet)');
} else {
  // Printed truncated. It is a credential, and shoulder-surfing a terminal is a
  // real way to leak one.
  console.log(`  embedUrl : ${current.embedUrl ? `${current.embedUrl.slice(0, 60)}…` : '(unset)'}`);
  console.log(`  note     : ${current.note || '(none)'}`);
  console.log(`  manageUrl: ${current.manageUrl || '(none)'}`);
}

if (!url) {
  console.log('\nPass --url \'<embed url>\' --write to set it. Quote the URL.');
  process.exit(0);
}

if (!isAllowedEmbedUrl(url)) {
  console.error(
    `\nRefused: ${url.slice(0, 60)}…\n` +
      `That is not an https URL on an allowed host. The website renders this as an\n` +
      `iframe src, so the allowlist in packages/shared/src/schema/servants.ts is the\n` +
      `thing standing between a mistyped value and arbitrary content inside a page\n` +
      `our servants trust.`,
  );
  process.exit(1);
}

const document = {
  embedUrl: url,
  note: note ?? current?.note ?? '',
  manageUrl: manageUrl ?? current?.manageUrl ?? '',
  updatedAt: new Date(),
};

if (!write) {
  console.log('\nWould set embedUrl to the URL provided. Re-run with --write to apply.');
  process.exit(0);
}

const res = await fetch(target, {
  method: 'PATCH',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: toFieldMap(document) }),
});

if (!res.ok) {
  console.error(`Write failed: HTTP ${res.status} ${(await res.text()).slice(0, 400)}`);
  process.exit(1);
}

console.log('\nSet. Servants see it as soon as they load /servants — no rebuild needed,');
console.log('because the page reads this at runtime rather than at build time.');
