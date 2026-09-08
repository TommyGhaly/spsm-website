/**
 * What is in the outbound mail queue, and whether anything has ever sent it.
 *
 * ---------------------------------------------------------------------------
 * The one collection no screen can show you.
 *
 * Two Functions post mail by writing a document to `mail` and stopping:
 * `squareCheckout` (the bookstore receipt) and `formSubmit` (the office
 * notification and the sender's copy). The Trigger Email extension is what
 * drains it. `firestore.rules` closes `mail` to clients in **both** directions,
 * so no browser and no signed-in staff account can read this collection — which
 * means an undelivered message is invisible from every side of the site. The
 * Function logs a success either way, and a bookstore buyer gets Square's own
 * receipt as well, so nobody reports the silence.
 *
 * That is how the whole queue went unsent from the day the first feature shipped
 * until somebody thought to look: `firebase ext:list` returned no extensions at
 * all on 2026-09-05.
 *
 * ## The tell is the absence of a field — with one exception
 *
 * The extension stamps `delivery.state` the instant it picks a document up —
 * PROCESSING, then SUCCESS or ERROR. So a document with **no `delivery` field at
 * all** has never been read by anything.
 *
 * The exception matters, and this script got it wrong until 2026-09-08: the
 * trigger fires on document **create**, so a document written *before* the
 * extension was installed is never picked up, no matter how healthy the
 * extension is. The receipt queued on 2026-09-05 still sits here untouched
 * beside sends that succeeded in two seconds. An old untouched document is
 * therefore expected, not a fault — what would indict the extension is a
 * *recent* one, written after the install and still unread.
 *
 * When that happens, the first thing to check is `DATABASE_REGION` in
 * extensions/firestore-send-email.env: a v2 Firestore trigger outside the
 * database's own region installs healthy, reports healthy, and never fires.
 * (`LOCATION` is a red herring — it is not a parameter of 0.2.10, the functions
 * run in us-central1, and the trigger fires across regions anyway.)
 *
 * gcloud credentials rather than the Firebase CLI, for the reason above — rules
 * deny every client, and `firebase` has no `firestore:get`.
 *
 * Usage:
 *   node scripts/read-mail-queue.mjs           # newest 20
 *   node scripts/read-mail-queue.mjs --all     # up to 300
 * ---------------------------------------------------------------------------
 */
import { accessToken, documentUrl } from './lib/firestore-rest.mjs';

process.loadEnvFile('.env');

const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const limit = process.argv.includes('--all') ? 300 : 20;

if (!project) {
  console.error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set. Is .env present?');
  process.exit(1);
}

const res = await fetch(`${documentUrl(project, 'mail')}?pageSize=${limit}`, {
  headers: { Authorization: `Bearer ${accessToken()}` },
});

if (!res.ok) {
  console.error(`Read failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}

const documents = (await res.json()).documents ?? [];

if (documents.length === 0) {
  /*
   * Empty is not evidence of health. Nothing on this site has sent enough mail
   * for an empty queue to mean "all delivered" — it much more likely means no
   * order and no form submission has come in since the queue was last cleared,
   * or that this is a project nobody has used yet.
   */
  console.log('The `mail` collection is empty.');
  console.log('');
  console.log('Which proves nothing either way: a receipt is only written when somebody');
  console.log('buys something, and a notification when somebody sends a form. Take a');
  console.log('cheap order or send the contact form, then run this again.');
  process.exit(0);
}

const rows = documents
  .map((document) => {
    const fields = document.fields ?? {};
    const delivery = fields.delivery?.mapValue?.fields;
    return {
      id: document.name.split('/').pop(),
      created: document.createTime,
      to: (fields.to?.arrayValue?.values ?? []).map((value) => value.stringValue).join(', '),
      subject: fields.message?.mapValue?.fields?.subject?.stringValue ?? '',
      // No `delivery` map at all is the interesting case, and it is not the same
      // as a state this script does not recognise.
      state: delivery ? (delivery.state?.stringValue ?? 'UNKNOWN') : null,
      error: delivery?.error?.stringValue ?? '',
      attempts: delivery?.attempts?.integerValue ?? '',
    };
  })
  .sort((a, b) => b.created.localeCompare(a.created));

const untouched = rows.filter((row) => row.state === null).length;
const failed = rows.filter((row) => row.state === 'ERROR').length;
const sent = rows.filter((row) => row.state === 'SUCCESS').length;

console.log(`${rows.length} message(s) in the queue — newest first.`);
console.log('');

for (const row of rows) {
  const state = row.state ?? 'never read';
  console.log(`  ${row.created.slice(0, 16).replace('T', ' ')}  ${state.padEnd(11)} ${row.to}`);
  if (row.subject) console.log(`                     ${row.subject}`);
  if (row.error) console.log(`                     error: ${row.error}`);
}

console.log('');
console.log(`${sent} sent, ${failed} failed, ${untouched} never read by anything.`);

if (untouched === rows.length) {
  /*
   * Every message unread. Two very different causes, and the newest document's
   * age is what separates them — see the note at the top of this file.
   */
  console.log('');
  console.log('No message here has a `delivery` field, so none of them has been read.');
  console.log('');
  console.log('If they all predate the extension being installed (2026-09-08), that is');
  console.log('expected: the trigger fires on document *create*, so a message queued');
  console.log('before it existed is never picked up. Delivering one means writing it');
  console.log('again under a new document id.');
  console.log('');
  console.log('If any of them is NEWER than that, the extension is not doing its job:');
  console.log('  npx firebase ext:list --project ' + project);
  console.log('and check the instance actually carries an SMTP_PASSWORD param — the');
  console.log('deploy does not prompt for it, so it installs happily without one. See');
  console.log('section 4 of docs/api-keys.md.');
} else if (failed > 0) {
  console.log('');
  console.log('A failure names its own reason above. The usual ones are an unverified');
  console.log('sending domain (Resend rejects the From address) and a missing API key —');
  console.log('SMTP_PASSWORD is declared optional, so the extension installs without it.');
}
