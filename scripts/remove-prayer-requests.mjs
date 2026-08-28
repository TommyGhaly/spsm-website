/**
 * Delete what the prayer request feature left behind in Firestore.
 *
 * ---------------------------------------------------------------------------
 * The code is gone; this is the data. Two separate things, and only one of them
 * is urgent.
 *
 *   forms/prayer-requests   — URGENT. The definition is `published: true` with
 *                             `kind: 'prayer'`, and `kind` no longer exists.
 *                             `parseFormDefinition` falls unknown kinds back to
 *                             `native`, and the document has an empty `fields`
 *                             array, so until this is deleted /forms shows a
 *                             "Prayer requests" card leading to a form with no
 *                             questions on it.
 *
 *   prayerRequests/*        — the sealed requests themselves. Not urgent: the
 *                             collection is unreachable already, because
 *                             `firestore.rules` no longer matches it and the
 *                             catch-all denies everything unmatched. Deleting
 *                             it is the parish's decision, not a consequence of
 *                             removing the code.
 *
 * ---------------------------------------------------------------------------
 * This is irreversible and there is no undo anywhere behind it.
 *
 * `body`, `authorName` and `contactEmail` are AES-256-GCM envelopes sealed under
 * `PRAYER_KEY`, which means a Firestore export of this collection is unreadable
 * without the key and the key is being retired with it. Nothing that is deleted
 * here can be reconstructed by anyone, including us. That is the point — the
 * disclosure these people read promised the parish would not keep their words
 * in the clear — but it is worth being certain before running it with --write.
 *
 * Deletes are one document at a time, deliberately. `commitWrite` would be
 * fewer round trips; a loop that prints each id is what lets you see what is
 * about to go and stop it half way. The collection is small enough that the
 * round trips cost nothing.
 * ---------------------------------------------------------------------------
 *
 * Usage:
 *   node scripts/remove-prayer-requests.mjs              # dry run, lists everything
 *   node scripts/remove-prayer-requests.mjs -- --write   # apply
 *
 *   node scripts/remove-prayer-requests.mjs -- --write --keep-requests
 *       Deletes only the form definition. Use this to unbreak /forms today and
 *       decide about the sealed requests separately.
 */
import { accessToken, documentUrl } from './lib/firestore-rest.mjs';

process.loadEnvFile('.env');

const write = process.argv.includes('--write');
const keepRequests = process.argv.includes('--keep-requests');
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!project) {
  console.error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set. Is .env present?');
  process.exit(1);
}

const authHeader = { Authorization: `Bearer ${accessToken()}` };

let exitCode = 0;

console.log(`Project: ${project}`);
console.log(write ? 'Writing — deletions are permanent.' : 'Dry run — nothing will be deleted.');
console.log('');

/* ---- the form definition ------------------------------------------------ */

const formUrl = documentUrl(project, 'forms/prayer-requests');
const formRes = await fetch(formUrl, { headers: authHeader });

if (formRes.status === 404) {
  console.log('  = forms/prayer-requests  — already gone');
} else if (!formRes.ok) {
  console.error(`  ! forms/prayer-requests: read failed, HTTP ${formRes.status}`);
  exitCode = 1;
} else {
  console.log('  - forms/prayer-requests  — the published card on /forms');
  if (write) {
    const del = await fetch(formUrl, { method: 'DELETE', headers: authHeader });
    if (!del.ok) {
      console.error(`      delete failed: HTTP ${del.status} ${(await del.text()).slice(0, 300)}`);
      exitCode = 1;
    }
  }
}

/* ---- the sealed requests ------------------------------------------------ */

if (keepRequests) {
  console.log('');
  console.log('  ~ prayerRequests/*  — left alone (--keep-requests)');
} else {
  console.log('');

  /*
   * Two shapes, because listing and deleting want opposite things from the
   * cursor.
   *
   * A dry run pages forward with `nextPageToken` over a collection nobody is
   * changing, which is what the token is for. A real run cannot: Firestore
   * paginates by document name, and carrying a token across the deletes that
   * emptied the page it came from is how documents get skipped. So it asks for
   * the first page, deletes it, and asks again — until a page comes back empty.
   * That is O(n / pageSize) round trips either way, and n here is small.
   */
  let deleted = 0;

  /** One page of ids. `token` is ignored when deleting. */
  async function page(token) {
    const params = new URLSearchParams({ pageSize: '100' });
    // Names only. There is nothing readable in these documents and no reason to
    // pull ciphertext across the wire to throw it away.
    params.append('mask.fieldPaths', '__name__');
    if (token) params.set('pageToken', token);

    const res = await fetch(`${documentUrl(project, 'prayerRequests')}?${params}`, {
      headers: authHeader,
    });
    if (!res.ok) throw new Error(`list failed, HTTP ${res.status}`);

    const body = await res.json();
    return { documents: body.documents ?? [], nextPageToken: body.nextPageToken ?? null };
  }

  try {
    let token = null;

    for (;;) {
      const { documents, nextPageToken } = await page(token);
      if (documents.length === 0) break;

      for (const document of documents) {
        console.log(`  - prayerRequests/${document.name.split('/').pop()}`);
        deleted += 1;

        if (!write) continue;

        const del = await fetch(`https://firestore.googleapis.com/v1/${document.name}`, {
          method: 'DELETE',
          headers: authHeader,
        });
        if (!del.ok) {
          console.error(
            `      delete failed: HTTP ${del.status} ${(await del.text()).slice(0, 300)}`,
          );
          exitCode = 1;
        }
      }

      // Deleting restarts at the front; a dry run walks forward and stops when
      // there is no next page.
      if (write) continue;
      if (!nextPageToken) break;
      token = nextPageToken;
    }
  } catch (error) {
    console.error(`  ! prayerRequests: ${error.message}`);
    exitCode = 1;
  }

  console.log('');
  console.log(
    deleted === 0
      ? 'prayerRequests is empty — nothing to delete.'
      : `${deleted} prayer request${deleted === 1 ? '' : 's'}${write ? ' deleted.' : ' would be deleted.'}`,
  );
}

console.log('');

if (!write) {
  console.log('Dry run. Re-run with -- --write to apply. There is no undo.');
} else {
  console.log('Done. Remaining, and both are yours to do by hand:');
  console.log('  1. Retire the PRAYER_KEY secret:');
  console.log('       npx firebase functions:secrets:destroy PRAYER_KEY');
  console.log('     Do this LAST. Once every version is destroyed, anything still');
  console.log('     sealed under it is unopenable forever.');
  console.log('  2. Delete the prayerSubmit and prayerList Functions, which a deploy');
  console.log('     of the remaining ones will not remove on its own:');
  console.log('       npx firebase functions:delete prayerSubmit prayerList');
}

process.exit(exitCode);
