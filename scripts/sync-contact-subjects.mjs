/**
 * Add any missing "What is this about?" options to the live contact form.
 *
 * ---------------------------------------------------------------------------
 * Why a script exists for one select on one form.
 *
 * `seed-forms.mjs` creates a form and then never touches it again, on purpose:
 * staff reword questions, add a notification address, and reorder fields in the
 * drawer on /forms, and a seeder that clobbered would undo somebody's afternoon
 * every time it ran. The consequence is that a *new* option added to the
 * built-in default in `@spsm/shared` changes nothing at all on a project that
 * has already been seeded — the site renders the stored document, and the
 * Function validates a submission against that same stored document.
 *
 * So there are two writes for one change, exactly as there are for the theme.
 * The default in code is the first; this is the second.
 *
 * It matters here because /calendar now links to
 * `/contact?about=signing-in-or-a-church-account` for a servant who needs a
 * church account. If the stored form has no such option, that link silently
 * opens an ordinary empty contact form — `subjectFromQuery` drops a value the
 * form does not offer rather than carrying one the server would refuse — and
 * the requests arrive filed under "A general question" with nothing to tell
 * them apart.
 *
 * ## Additive, and only for this one field
 *
 * Options present in the stored document are left exactly as they are,
 * including their order and any relabelling; only options in the built-in
 * default that the document is missing are appended. Nothing is renamed,
 * reordered, or removed, and no other field is read or written — the mask is
 * `fields`, and the array is rebuilt from what Firestore already holds with
 * that one list extended.
 *
 * Removing an option is deliberately not offered. A stored answer is the option
 * *value*, so deleting one from the definition orphans every submission that
 * chose it, and that is a decision for the office in the builder rather than
 * something a sync script should do on its own.
 *
 * Usage:
 *   node scripts/sync-contact-subjects.mjs            # dry run, prints the diff
 *   node scripts/sync-contact-subjects.mjs --write    # apply
 */
import { builtInForm } from "../packages/shared/dist/index.js";
import { accessToken, documentUrl } from "./lib/firestore-rest.mjs";

process.loadEnvFile(".env");

const write = process.argv.includes("--write");
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!project) {
  console.error("NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set. Is .env present?");
  process.exit(1);
}

const SUBJECT_KEY = "subject";
const headers = { Authorization: `Bearer ${accessToken()}` };
const target = documentUrl(project, "forms/contact");

/* ---- what is there now -------------------------------------------------- */

const res = await fetch(target, { headers });

if (res.status === 404) {
  console.error(
    "forms/contact does not exist. Run `npm run forms -- --write` first.",
  );
  process.exit(1);
}

if (!res.ok) {
  console.error(
    `Read failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`,
  );
  process.exit(1);
}

const document = await res.json();
const storedFields = document.fields?.fields?.arrayValue?.values ?? [];

const subjectAt = storedFields.findIndex(
  (entry) => entry.mapValue?.fields?.key?.stringValue === SUBJECT_KEY,
);

if (subjectAt === -1) {
  console.error(
    `forms/contact has no "${SUBJECT_KEY}" field. It has been renamed or removed in the ` +
      "builder; add the option there by hand rather than letting this guess.",
  );
  process.exit(1);
}

const subject = storedFields[subjectAt];
const storedOptions = subject.mapValue.fields.options?.arrayValue?.values ?? [];
const storedValues = new Set(
  storedOptions.map((option) => option.mapValue?.fields?.value?.stringValue),
);

/* ---- what the built-in default says ------------------------------------- */

const wanted = builtInForm("contact")?.fields.find(
  (field) => field.key === SUBJECT_KEY,
);

if (!wanted) {
  console.error(
    "The built-in contact form has no subject field. Nothing to sync.",
  );
  process.exit(1);
}

const missing = wanted.options.filter(
  (option) => !storedValues.has(option.value),
);

console.log('forms/contact — "What is this about?"');
console.log("");
for (const option of storedOptions) {
  console.log(`  = ${option.mapValue.fields.label.stringValue}`);
}
for (const option of missing) {
  console.log(`  + ${option.label}   (${option.value})`);
}
console.log("");

if (missing.length === 0) {
  console.log(
    "Nothing missing — the stored form already offers every built-in option.",
  );
  process.exit(0);
}

if (!write) {
  console.log(
    `Dry run. ${missing.length} option(s) would be appended. Pass --write to apply.`,
  );
  process.exit(0);
}

/* ---- the write ---------------------------------------------------------- */

/*
 * The stored options, untouched, with the missing ones appended in the shape
 * Firestore's REST API returns them in. Built by hand rather than through
 * `toFieldMap` so that every option already in the document is passed straight
 * back the way it came — a round trip through a converter is where a stored
 * price of `0` quietly becomes `0.0` or a string.
 */
subject.mapValue.fields.options = {
  arrayValue: {
    values: [
      ...storedOptions,
      ...missing.map((option) => ({
        mapValue: {
          fields: {
            value: { stringValue: option.value },
            label: { stringValue: option.label },
            priceCents: { integerValue: String(option.priceCents ?? 0) },
          },
        },
      })),
    ],
  },
};

/*
 * `updateMask.fieldPaths=fields` — the whole `fields` array, and nothing else in
 * the document. Without a mask this PATCH would replace every field of
 * `forms/contact` with the ones in this body, which is a body containing one
 * key: the notification addresses, the confirmation email, the blurb and the
 * published flag would all be deleted.
 */
const patch = await fetch(`${target}?updateMask.fieldPaths=fields`, {
  method: "PATCH",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({
    fields: { fields: { arrayValue: { values: storedFields } } },
  }),
});

if (!patch.ok) {
  console.error(
    `Write failed: HTTP ${patch.status} ${(await patch.text()).slice(0, 300)}`,
  );
  process.exit(1);
}

console.log(`Written. ${missing.length} option(s) appended to forms/contact.`);
