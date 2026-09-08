/**
 * Point everything that emails the church office at the office's address.
 *
 * ---------------------------------------------------------------------------
 * Three documents hold a copy of one address, and none of them started with it.
 *
 * `config/parish.email` is the address the church gave — it is what /contact
 * prints, and it is the source this script copies *from*. Two other documents
 * hold their own copy, because each is edited by different people for different
 * reasons, and both were left empty:
 *
 *   forms/contact.notifyEmails    who is emailed when somebody writes to the
 *                                 office. Empty means **nobody is told** — the
 *                                 submission is stored and that is all. See the
 *                                 `notifyEmails.length > 0` test in
 *                                 functions/src/forms/email.ts.
 *   config/bookstore.orderEmail   the address a buyer is told to write to if
 *                                 their order is wrong. Empty means the receipt
 *                                 says "contact the church office" and names
 *                                 nobody — honest, but it makes a no-reply
 *                                 receipt a dead end.
 *
 * A copy rather than a lookup, in both cases, because both are things staff
 * change for their own reasons: the office may want a submission going to a
 * deacon's address rather than the one printed on the site, and the bookstore
 * may want orders answered by whoever runs the shop. Deriving either from
 * `config/parish` at read time would take that away.
 *
 * ## Why a script, when both are editable on the site
 *
 * `notifyEmails` has a field in the drawer on /forms ("Tell these addresses")
 * and it is still the right place to change this afterwards. `orderEmail` has
 * no UI anywhere. And neither can be edited by anyone who is not signed in as
 * staff, which is the state a freshly seeded project is in — so the first write
 * has to come from a terminal either way.
 *
 * ## Additive, and it never overwrites an address somebody chose
 *
 * Every field here is written **only when it is empty**. An address already in
 * one of these fields is a decision — possibly one taken at eleven at night to
 * stop mail going somewhere — and a script that reset it on every run would
 * undo that with no way to tell which of the two had won. Same rule as
 * `sync-form-pictures.mjs`, for the same reason.
 *
 * Usage:
 *   node scripts/set-office-email.mjs                     # dry run
 *   node scripts/set-office-email.mjs --write             # apply
 *   node scripts/set-office-email.mjs --email=a@b.org     # a different address
 * ---------------------------------------------------------------------------
 */
import { builtInForm } from '../packages/shared/dist/index.js';
import { accessToken, documentUrl } from './lib/firestore-rest.mjs';

process.loadEnvFile('.env');

const write = process.argv.includes('--write');
const override = process.argv.find((arg) => arg.startsWith('--email='))?.slice('--email='.length);
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!project) {
  console.error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set. Is .env present?');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${accessToken()}` };

/** Read one document. `null` when it does not exist; exits on anything else. */
async function read(path) {
  const res = await fetch(documentUrl(project, path), { headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    console.error(`Read failed for ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  return await res.json();
}

/**
 * Write named fields onto one document, and nothing else.
 *
 * `updateMask.fieldPaths` per field — without it a PATCH replaces the whole
 * document with a body holding one key, which on `forms/contact` would delete
 * every question on the form.
 */
async function patch(path, fields) {
  const mask = Object.keys(fields)
    .map((field) => `updateMask.fieldPaths=${field}`)
    .join('&');
  const res = await fetch(`${documentUrl(project, path)}?${mask}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    console.error(`Write failed for ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
}

/* ── the address ────────────────────────────────────────────────────────── */

const parish = await read('config/parish');
const stored = parish?.fields?.email?.stringValue?.trim() ?? '';
const office = (override ?? stored).trim();

if (!office) {
  console.error('No office address to write.');
  console.error('');
  console.error("  config/parish.email is empty, and no --email= was given. The address");
  console.error('  belongs in config/parish first — it is what /contact prints — so set it');
  console.error('  there and re-run, or pass --email=someone@spsmwayland.org to write these');
  console.error('  two fields alone.');
  process.exit(1);
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(office)) {
  console.error(`"${office}" does not look like an email address.`);
  process.exit(1);
}
if (override && stored && override !== stored) {
  console.log(`Note: /contact prints ${stored}. Writing ${office} instead, as asked.`);
  console.log('');
}

console.log(write ? `Writing ${office}…` : `Dry run — nothing will be written. (${office})`);
console.log('');

let pending = 0;

/* ── the contact form ───────────────────────────────────────────────────── */

const contact = await read('forms/contact');

if (!contact) {
  console.log('  · forms/contact — not stored yet. Run `npm run forms -- --write` first.');
} else {
  const fields = {};
  const notify = (contact.fields?.notifyEmails?.arrayValue?.values ?? [])
    .map((value) => value.stringValue)
    .filter(Boolean);

  if (notify.length === 0) {
    fields.notifyEmails = { arrayValue: { values: [{ stringValue: office }] } };
    console.log(`  + forms/contact.notifyEmails — [${office}]`);
  } else if (notify.includes(office)) {
    console.log(`  = forms/contact.notifyEmails — already tells ${office}`);
  } else {
    console.log(
      `  ! forms/contact.notifyEmails — keeps [${notify.join(', ')}]. Add ${office} in the` +
        ' drawer on /forms if it belongs there too.',
    );
  }

  /*
   * The sender's copy, from the built-in default.
   *
   * Empty `confirmationEmailBody` means no copy is sent, and for most forms that
   * is a setting rather than an oversight — a copy of the answers in somebody's
   * inbox is a privacy problem on a form that asks anything sensitive. The
   * contact form is the one where the default says otherwise, and its stored
   * document predates that default, so it is empty by age rather than by
   * choice. Written here only when it is empty, like everything else.
   */
  const body = contact.fields?.confirmationEmailBody?.stringValue?.trim() ?? '';
  const wanted = builtInForm('contact')?.confirmationEmailBody?.trim() ?? '';

  if (!body && wanted) {
    fields.confirmationEmailBody = { stringValue: wanted };
    console.log('  + forms/contact.confirmationEmailBody — the sender gets a copy again');
  } else if (body) {
    console.log('  = forms/contact.confirmationEmailBody — already set');
  }

  if (Object.keys(fields).length > 0) {
    pending += 1;
    if (write) await patch('forms/contact', fields);
  }
}

/* ── the bookstore receipt ──────────────────────────────────────────────── */

const bookstore = await read('config/bookstore');
const orderEmail = bookstore?.fields?.orderEmail?.stringValue?.trim() ?? '';

if (!bookstore) {
  /*
   * `checkout.ts` falls back to `DEFAULT_BOOKSTORE_CONFIG` and the deployed
   * PARISH_EMAIL parameter when this document is missing, so the receipt still
   * goes out — it just names whatever was deployed. Creating the whole document
   * here would mean this script deciding the delivery charge, which is not its
   * business.
   */
  console.log('  · config/bookstore — not stored yet. Run `npm run config -- --write` first.');
} else if (!orderEmail) {
  console.log(`  + config/bookstore.orderEmail — ${office}`);
  pending += 1;
  if (write) await patch('config/bookstore', { orderEmail: { stringValue: office } });
} else if (orderEmail === office) {
  console.log(`  = config/bookstore.orderEmail — already ${office}`);
} else {
  console.log(`  ! config/bookstore.orderEmail — keeps ${orderEmail}`);
}

/* ── what is still not emailed ──────────────────────────────────────────── */

/*
 * Every other form that tells nobody.
 *
 * Reported and not touched. Which address a request form notifies is a decision
 * about who answers it — the van requests may go to whoever drives the van — and
 * this script only knows the office's address. An embedded form is listed as
 * unreachable rather than unset: nothing it collects reaches this project at
 * all, so a notification address there would be a promise it cannot keep.
 */
const list = await fetch(`${documentUrl(project, 'forms')}?pageSize=100`, { headers });
if (list.ok) {
  const silent = [];
  for (const document of (await list.json()).documents ?? []) {
    const id = document.name.split('/').pop();
    if (id === 'contact') continue;
    const kind = document.fields?.kind?.stringValue ?? 'native';
    const notify = document.fields?.notifyEmails?.arrayValue?.values ?? [];
    if (notify.length > 0) continue;
    if (kind === 'embed' || kind === 'tithely') continue;
    silent.push(`${id} (${kind})`);
  }
  if (silent.length > 0) {
    console.log('');
    console.log('Still telling nobody, and left alone — set these on /forms if they should:');
    for (const entry of silent) console.log(`    ${entry}`);
  }
}

console.log('');
if (pending === 0) {
  console.log('Nothing to do.');
} else if (!write) {
  console.log(`Dry run. Re-run with --write to apply. (${pending} document(s))`);
} else {
  console.log(`Written. ${pending} document(s).`);
  console.log('');
  console.log('These messages are queued in the `mail` collection and delivered by the');
  console.log('Trigger Email extension. If that is not installed yet, they will sit there');
  console.log('unsent — see section 4 of docs/api-keys.md.');
}
