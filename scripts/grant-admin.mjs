/**
 * Make somebody a superadmin, by email.
 *
 * ---------------------------------------------------------------------------
 * This is the only way anybody becomes a superadmin, and that is the point
 * rather than a limitation.
 *
 * Every other privilege on this site is allocated at /access, onto the member
 * document, by somebody who is already a superadmin. `superadmin` itself cannot
 * be: it is the power to hand out every one of those areas, and a screen that
 * could grant it would be a screen where one careless click makes a second
 * person who can do anything. So it is a custom claim, claims are settable only
 * with the Admin SDK or the Identity Toolkit API, and this file is the one
 * caller. Making one is a thing you do from a terminal, on purpose.
 *
 * It also solves the chicken-and-egg problem at the start: at the beginning
 * nobody is a superadmin, so nobody can open /access to allocate anything.
 *
 * It talks to the Identity Toolkit REST API with your own gcloud credentials
 * rather than the Admin SDK, for the same reason as seed-config.mjs: no service
 * account key to distribute, and no Application Default Credentials to set up.
 *
 * The person must have signed in at least once, so that there is an account to
 * promote.
 *
 * Usage:
 *   node scripts/grant-admin.mjs someone@spsmwayland.org           # show current
 *   node scripts/grant-admin.mjs someone@spsmwayland.org --write   # promote
 *   node scripts/grant-admin.mjs someone@spsmwayland.org --revoke  # and back
 * ---------------------------------------------------------------------------
 */
import { accessToken, documentUrl } from './lib/firestore-rest.mjs';

process.loadEnvFile('.env');

const email = process.argv[2];
const write = process.argv.includes('--write');
const revoke = process.argv.includes('--revoke');
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!email || email.startsWith('--')) {
  console.error('Usage: node scripts/grant-admin.mjs <email> [--write | --revoke]');
  process.exit(1);
}
if (!project) {
  console.error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set. Is .env present?');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${accessToken()}`,
  'Content-Type': 'application/json',
  'x-goog-user-project': project,
};
const base = `https://identitytoolkit.googleapis.com/v1/projects/${project}`;

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`${path} failed: HTTP ${res.status}\n${(await res.text()).slice(0, 400)}`);
    process.exit(1);
  }
  return res.json();
}

const { users = [] } = await post('/accounts:lookup', { email: [email] });
const user = users[0];

if (!user) {
  console.error(
    `No account for ${email}.\n\n` +
      `They have to sign in through the website once before there is anything to\n` +
      `promote — sign-in is Microsoft-only, so it must be their parish account.`,
  );
  process.exit(1);
}

const current = user.customAttributes ? JSON.parse(user.customAttributes) : {};
const wanted = !revoke;

/*
 * `role` and `groups` are the deleted model's claims, and this is where the last
 * of them go.
 *
 * Every account that signed in before 2026-08-31 is carrying one — the parish's
 * only real account was `{"role":"admin"}` — and **nothing reads them any
 * more**, which makes them worse than useless: a claim block that still says
 * `admin` on an account that can do nothing is the most misleading thing
 * somebody could find while debugging a permission. `parseClaims` drops them,
 * `firestore.rules` never looks, and this script is the one place that rewrites
 * a claim block, so this is the one place that can be rid of them.
 *
 * Reported rather than done silently, because a script that quietly deletes
 * claims is a script you cannot trust with the account that owns the site.
 */
const LEGACY_CLAIMS = ['role', 'groups'];
const legacy = LEGACY_CLAIMS.filter((key) => key in current);

console.log(`${email}`);
console.log(`  uid:        ${user.localId}`);
console.log(`  superadmin: ${current.superadmin === true ? 'yes' : 'no'}`);
// The screen grants, mirrored into the claims by `mirrorGrantsToClaims` for
// storage.rules. Printed because a promotion preserves them and somebody
// reading this output should see what they are preserving.
console.log(`  areas:      ${(current.screens ?? []).join(', ') || '(none)'}`);
if (legacy.length > 0) {
  console.log(
    `  stale:      ${legacy.join(', ')} — from the deleted role model, read by nothing.`,
  );
}

if (current.superadmin === wanted && legacy.length === 0) {
  console.log(`\nAlready ${wanted ? 'a superadmin' : 'not a superadmin'}. Nothing to do.`);
  process.exit(0);
}

if (!write && !revoke) {
  console.log(`\nWould set superadmin to ${wanted}.`);
  if (legacy.length > 0) console.log(`Would drop: ${legacy.join(', ')}.`);
  console.log('Re-run with --write to apply.');
  process.exit(0);
}

/*
 * Spread, never replace. `screens` lives in this same block and is maintained
 * by a Firestore trigger; writing a bare `{ superadmin }` here would wipe it,
 * and the symptom would be that the person can still do everything in the site
 * and can no longer upload a photograph — until the next member write happened
 * to put it back.
 *
 * The spread is also why the legacy keys have to be deleted explicitly: they
 * would otherwise be carried forward for ever, one promotion at a time.
 */
const next = { ...current, superadmin: wanted };
for (const key of legacy) delete next[key];

await post('/accounts:update', {
  localId: user.localId,
  customAttributes: JSON.stringify(next),
});

/*
 * The display mirror on the member document.
 *
 * Claims are not readable across accounts from a browser, so /access has no way
 * to show "this person is a superadmin, ticking these boxes changes nothing"
 * unless somebody writes it down. This is that. It decides nothing — rules read
 * the token — so if the patch below fails the promotion has still happened and
 * only the allocation list is wrong.
 *
 * Field-masked, so it cannot blank a name, an email, a notification preference
 * or — far worse — the `screenAdmin` map that is this person's actual
 * permissions. An unmasked PATCH replaces the whole document.
 */
/*
 * `roleMirror` and `groupsMirror` are named in the mask and absent from the
 * body, which is how the REST API says "delete these fields". They are the
 * document-side half of the stale claims above — written by `createMemberProfile`
 * before the model changed, read by nothing since.
 */
const patch = await fetch(
  `${documentUrl(project, `members/${user.localId}`)}` +
    '?updateMask.fieldPaths=superadminMirror' +
    '&updateMask.fieldPaths=roleMirror' +
    '&updateMask.fieldPaths=groupsMirror',
  {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ fields: { superadminMirror: { booleanValue: wanted } } }),
  },
);
if (!patch.ok) {
  console.warn(
    `\nThe claim was set, but the display mirror on members/${user.localId} was not:\n` +
      `  HTTP ${patch.status} ${(await patch.text()).slice(0, 200)}\n` +
      `Harmless — /access will show them as an ordinary member until it is fixed.`,
  );
}

console.log(`\nDone — ${wanted ? 'now a superadmin' : 'no longer a superadmin'}.`);
console.log(
  'They must sign out and back in, or wait up to an hour, before this appears in\n' +
    'their ID token. Claims are baked into the token at mint time — /access asks\n' +
    'for a fresh one when it would otherwise turn somebody away, so in practice\n' +
    'opening that page is enough.',
);
