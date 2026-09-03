/**
 * Give a built-in form the picture its code default names — but only if the
 * stored form has none.
 *
 * ---------------------------------------------------------------------------
 * The second of the two writes, for `image`.
 *
 * `builtInForms()` in `@spsm/shared` is the *default*, not the live form. A
 * project that has already been seeded renders the stored document, so adding
 * `image: '/img/stock-office-1000.webp'` to the default in code changes nothing
 * on the parish's own site — the same trap `sync-contact-subjects.mjs` exists
 * for, and the same one recorded against the theme.
 *
 * ## Only when the stored picture is null
 *
 * This never replaces a picture. `image` is a field staff set themselves, in
 * the drawer on /forms, with a picker; a script that overwrote it would undo
 * that choice every time somebody ran it, and they would have no way to know
 * which of the two had won. A stored `null` is the only case this touches, and
 * "null" is exactly the state a default is *for*.
 *
 * Which means the honest way to change a picture that has already been set is
 * still the picker on /forms. This is for the forms that never had one.
 *
 * Usage:
 *   node scripts/sync-form-pictures.mjs            # dry run, prints the diff
 *   node scripts/sync-form-pictures.mjs --write    # apply
 */
import { BUILT_IN_FORM_IDS, builtInForm } from "../packages/shared/dist/index.js";
import { accessToken, documentUrl } from "./lib/firestore-rest.mjs";

process.loadEnvFile(".env");

const write = process.argv.includes("--write");
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!project) {
  console.error("NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set. Is .env present?");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${accessToken()}` };
let written = 0;
let skipped = 0;

for (const slug of BUILT_IN_FORM_IDS) {
  const wanted = builtInForm(slug)?.image ?? null;
  if (!wanted) continue;

  const target = documentUrl(project, `forms/${slug}`);
  const res = await fetch(target, { headers });

  if (res.status === 404) {
    console.log(`  · ${slug} — not stored yet; the seeder will carry the picture.`);
    continue;
  }
  if (!res.ok) {
    console.error(`Read failed for ${slug}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }

  const document = await res.json();
  /*
   * `stringValue` when a picture is set, `nullValue` when it is not, and
   * *absent* on a document written before the field existed. All three of the
   * last two mean "none chosen".
   */
  const stored = document.fields?.image?.stringValue ?? null;

  if (stored === wanted) {
    console.log(`  = ${slug} — already ${wanted}`);
    continue;
  }
  if (stored !== null) {
    skipped += 1;
    console.log(`  ! ${slug} — keeps its own ${stored} (the default says ${wanted})`);
    continue;
  }

  console.log(`  + ${slug} — ${wanted}`);
  if (!write) continue;

  // `updateMask.fieldPaths=image` — this one field. Without the mask the PATCH
  // would replace the whole document with a body holding one key.
  const patch = await fetch(`${target}?updateMask.fieldPaths=image`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { image: { stringValue: wanted } } }),
  });

  if (!patch.ok) {
    console.error(`Write failed for ${slug}: HTTP ${patch.status} ${(await patch.text()).slice(0, 200)}`);
    process.exit(1);
  }
  written += 1;
}

console.log("");
if (!write) {
  console.log("Dry run. Pass --write to apply.");
} else {
  console.log(`Written. ${written} picture(s) set.`);
}
if (skipped > 0) {
  console.log(
    `${skipped} form(s) already carry a picture somebody chose; change those in the drawer on /forms.`,
  );
}
