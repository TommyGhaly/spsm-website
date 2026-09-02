/**
 * Add `screenAdmin` to member documents written before per-screen permissions
 * existed.
 *
 * `createMemberProfile` in functions/src/auth.ts writes the map now, but it
 * runs from `beforeUserCreated` — which fires once, at account creation, and
 * never again. Anyone who signed in before that change has a member document
 * with no `screenAdmin` at all, and no sign-in will ever add one.
 *
 * `parseScreenAdmin` already treats an absent map as "no permissions", so a
 * document without one is safe rather than broken — nobody gets access they
 * should not have. This exists so the admin UI has a complete map to render and
 * toggle, instead of writing the first key itself against a rule that requires
 * the field to be unchanged.
 *
 * Every screen is written `false`. This grants nothing; it only creates the
 * shape. Use /access to actually entrust somebody with an area — there is no
 * other way, and since the role ladder was removed there is no tier that could
 * stand in for one either.
 *
 * Like the other scripts here it talks to the Firestore REST API with your own
 * gcloud credentials, which bypass security rules — necessary, since the rules
 * deliberately forbid writing this field as the member themselves.
 *
 * Usage:
 *   node scripts/backfill-screen-admin.mjs           # dry run, lists what would change
 *   node scripts/backfill-screen-admin.mjs --write   # apply
 */
import { accessToken, documentUrl, toValue, unwrap } from './lib/firestore-rest.mjs';
import { ADMIN_SCREENS, defaultScreenAdmin } from '../packages/shared/dist/index.js';

process.loadEnvFile('.env');

const write = process.argv.includes('--write');
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!project) {
  console.error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set. Is .env present?');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${accessToken()}`,
  'Content-Type': 'application/json',
  'x-goog-user-project': project,
};

/** Every member document, following pageToken until Firestore stops. */
async function listMembers() {
  const docs = [];
  let pageToken = '';
  do {
    const url = `${documentUrl(project, 'members')}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.error(`Could not list members: ${response.status} ${await response.text()}`);
      process.exit(1);
    }
    const body = await response.json();
    docs.push(...(body.documents ?? []));
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return docs;
}

const members = await listMembers();
if (members.length === 0) {
  console.log('No member documents. Nobody has signed in yet.');
  process.exit(0);
}

/*
 * A document counts as needing the backfill when the map is missing *or*
 * incomplete — the second case is what happens when a screen is added to
 * ADMIN_SCREENS after the document was written. Only the absent keys are
 * added; existing grants are read back and preserved, so re-running this
 * cannot quietly revoke somebody's access.
 */
const pending = [];
for (const doc of members) {
  const uid = doc.name.split('/').pop();
  const existing = doc.fields?.screenAdmin ? unwrap(doc.fields.screenAdmin) : null;
  const missing = ADMIN_SCREENS.filter((screen) => existing?.[screen] === undefined);
  if (missing.length > 0) {
    pending.push({ uid, email: doc.fields?.email ? unwrap(doc.fields.email) : '', existing, missing });
  }
}

console.log(`${members.length} member document(s), ${pending.length} needing screenAdmin.\n`);

for (const { uid, email, missing } of pending) {
  console.log(`  ${uid}  ${email || '(no email)'}  adding: ${missing.join(', ')}`);
}

if (pending.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

if (!write) {
  console.log('\nDry run. Re-run with --write to apply.');
  process.exit(0);
}

let applied = 0;
for (const { uid, existing } of pending) {
  // Merge, not replace: start from what is there and fill the gaps with false.
  const merged = { ...defaultScreenAdmin(), ...(existing ?? {}) };

  // `updateMask` scoped to the one field, so a concurrent profile edit is not
  // clobbered by this script writing the whole document back.
  const url = `${documentUrl(project, `members/${uid}`)}?updateMask.fieldPaths=screenAdmin`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ fields: { screenAdmin: toValue(merged) } }),
  });

  if (!response.ok) {
    console.error(`  ${uid}: FAILED ${response.status} ${await response.text()}`);
    continue;
  }
  applied += 1;
}

console.log(`\nUpdated ${applied} of ${pending.length}.`);
