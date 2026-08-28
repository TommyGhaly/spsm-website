/**
 * Grant `admin` to a person, by email.
 *
 * This exists to solve exactly one chicken-and-egg problem: `setMemberRole`
 * requires an admin to call it, and at the start nobody is one. Use it once to
 * make the first admin, then use the admin UI for everyone else — a script that
 * hands out privileges is a thing you want to need rarely and notice when it
 * runs.
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
 */
import { accessToken } from './lib/firestore-rest.mjs';
import { ROLES } from '../packages/shared/dist/index.js';

process.loadEnvFile('.env');

const email = process.argv[2];
const write = process.argv.includes('--write');
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!email || email.startsWith('--')) {
  console.error('Usage: node scripts/grant-admin.mjs <email> [--write]');
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
console.log(`${email}`);
console.log(`  uid:    ${user.localId}`);
console.log(`  role:   ${current.role ?? '(none)'}`);
console.log(`  groups: ${(current.groups ?? []).join(', ') || '(none)'}`);

if (current.role === 'admin') {
  console.log('\nAlready an admin. Nothing to do.');
  process.exit(0);
}

if (!write) {
  console.log(`\nWould set role to "admin" (from the ${ROLES.join(' < ')} ladder).`);
  console.log('Re-run with --write to apply.');
  process.exit(0);
}

// Groups are preserved: `admin` is a tier on the role ladder and says nothing
// about which capability groups someone holds. Dropping `bookstore` here would
// quietly revoke their access to the shop's section controls.
await post('/accounts:update', {
  localId: user.localId,
  customAttributes: JSON.stringify({ ...current, role: 'admin' }),
});

console.log('\nDone — now an admin.');
console.log(
  'They must sign out and back in, or wait up to an hour, before the new role\n' +
    'appears in their ID token. Claims are baked into the token at mint time.',
);
