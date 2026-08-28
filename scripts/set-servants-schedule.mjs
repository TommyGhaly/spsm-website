/**
 * Point the church calendar at Breeze.
 *
 * Two URLs, because there are two calendars: the **parish** calendar, which is
 * the public schedule of liturgies and classes, and the **servants** calendar,
 * which adds the internal entries — tentative plans, prep days, which van is
 * out. Both are Breeze embed tokens for the same subdomain and both live in
 * `servantsConfig/schedule`.
 *
 * Its own script, and not a value in this repo, for one reason: a Breeze embed
 * URL is a bearer credential. It returns the calendar to anyone who requests it
 * — no session, no referrer check — so committing it would publish the parish
 * rota to anyone who reads the repository, and baking it into the static site
 * would publish it to everyone else.
 *
 * **Only the `calendar` Cloud Function reads these**, through the Admin SDK. No
 * browser ever receives either URL; the Function calls Breeze and sends back
 * the events. That is the difference from the old /servants page, which handed
 * the URL to the browser and framed it.
 *
 * Writing there needs the `admin` claim; this goes in over the REST API with
 * your own gcloud credentials, which bypass rules the same way the Admin SDK
 * does. Same pattern as seed-config.mjs.
 *
 * Usage:
 *   node scripts/set-servants-schedule.mjs                            # show current
 *   node scripts/set-servants-schedule.mjs --parish-url '<url>' --write
 *   node scripts/set-servants-schedule.mjs --url '<url>' --write      # servants
 *   node scripts/set-servants-schedule.mjs --parish-url '…' --url '…' --write
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
const parishUrl = valueOf('--parish-url');
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
  const show = (value) => (value ? `${value.slice(0, 60)}…` : '(unset)');
  console.log(`  parishEmbedUrl: ${show(current.parishEmbedUrl)}`);
  console.log(`  embedUrl      : ${show(current.embedUrl)}   (servants)`);
  console.log(`  note          : ${current.note || '(none)'}`);
  console.log(`  manageUrl     : ${current.manageUrl || '(none)'}`);
}

if (!url && !parishUrl) {
  console.log("\nPass --parish-url '<url>' and/or --url '<url>' with --write. Quote them.");
  process.exit(0);
}

for (const [flag, value] of [
  ['--parish-url', parishUrl],
  ['--url', url],
]) {
  if (value && !isAllowedEmbedUrl(value)) {
    console.error(
      `\nRefused ${flag}: ${value.slice(0, 60)}…\n` +
        `That is not an https URL on an allowed host. The Cloud Function fetches this\n` +
        `server-side with the parish's own service-account identity, so the allowlist\n` +
        `in packages/shared/src/schema/servants.ts is the thing standing between a\n` +
        `mistyped value and an SSRF.`,
    );
    process.exit(1);
  }
}

const document = {
  // Each URL is left alone unless this run supplies it, so setting one does not
  // silently blank the other.
  embedUrl: url ?? current?.embedUrl ?? '',
  parishEmbedUrl: parishUrl ?? current?.parishEmbedUrl ?? '',
  note: note ?? current?.note ?? '',
  manageUrl: manageUrl ?? current?.manageUrl ?? '',
  updatedAt: new Date(),
};

if (!write) {
  console.log('\nWould set:');
  if (parishUrl) console.log('  parishEmbedUrl');
  if (url) console.log('  embedUrl (servants)');
  console.log('Re-run with --write to apply.');
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

console.log('\nSet. /calendar picks it up on the next load — no rebuild needed, because');
console.log('the schedule is fetched at request time rather than baked at build time.');
console.log('The Function caches each range for five minutes, so allow for that.');
