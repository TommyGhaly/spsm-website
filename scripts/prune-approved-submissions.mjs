/**
 * Delete the quarantine copies of photographs that were already published.
 *
 * ---------------------------------------------------------------------------
 * `onGalleryMediaReviewed` used to *copy* an approved file into `galleries/`
 * and leave the preview and the original behind in `submissions/`. It now
 * deletes them once the public file exists — but only on a status change, so
 * everything approved before that deploy still carries both. This is the
 * one-off for those.
 *
 * For every `galleryMedia` document that is `approved` with a `renditionPath`:
 *
 *   1. confirm the public file actually exists — a document whose copy failed
 *      is skipped, because its `submissions/` files are the only ones left;
 *   2. delete `previewPath` and `sourcePath`, only if they are under
 *      `submissions/`;
 *   3. set `previewPath: null` on the document, as the trigger now does.
 *
 * `sourcePath` stays on the document: it is a required field, and the delete
 * trigger already tolerates the object being gone.
 *
 * Irreversible. The originals are the only full-resolution copy of each
 * photograph; what remains afterwards is the published webp.
 * ---------------------------------------------------------------------------
 *
 * Usage:
 *   node scripts/prune-approved-submissions.mjs              # dry run
 *   node scripts/prune-approved-submissions.mjs -- --write   # apply
 */
import { accessToken, documentUrl, fromFirestore } from './lib/firestore-rest.mjs';

process.loadEnvFile('.env');

const write = process.argv.includes('--write');
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

if (!project || !bucket) {
  console.error('NEXT_PUBLIC_FIREBASE_PROJECT_ID / _STORAGE_BUCKET not set. Is .env present?');
  process.exit(1);
}

const authHeader = { Authorization: `Bearer ${accessToken()}` };
const objectUrl = (path) =>
  `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(path)}`;

/** @returns {Promise<number | null>} the object's size, or null when it is not there. */
async function objectSize(path) {
  const res = await fetch(objectUrl(path), { headers: authHeader });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`stat ${path}: HTTP ${res.status}`);
  return Number((await res.json()).size);
}

console.log(`Project: ${project}  Bucket: ${bucket}`);
console.log(write ? 'Writing — deletions are permanent.' : 'Dry run — nothing will be deleted.');
console.log('');

const documents = [];
let pageToken = '';
do {
  const url = new URL(documentUrl(project, 'galleryMedia'));
  url.searchParams.set('pageSize', '300');
  if (pageToken) url.searchParams.set('pageToken', pageToken);
  const res = await fetch(url, { headers: authHeader });
  if (!res.ok) {
    console.error(`list galleryMedia: HTTP ${res.status}`);
    process.exit(1);
  }
  const body = await res.json();
  documents.push(...(body.documents ?? []));
  pageToken = body.nextPageToken ?? '';
} while (pageToken);

let exitCode = 0;
let freed = 0;
let pruned = 0;

for (const document of documents) {
  const id = document.name.split('/').pop();
  const media = fromFirestore(document.fields ?? {});
  if (media.status !== 'approved' || !media.renditionPath) continue;

  try {
    if ((await objectSize(media.renditionPath)) === null) {
      console.log(`  ! ${id}  — ${media.renditionPath} is missing; leaving its originals alone`);
      continue;
    }

    const paths = [...new Set([media.previewPath, media.sourcePath])].filter(
      (path) => typeof path === 'string' && path.startsWith('submissions/'),
    );

    let any = false;
    for (const path of paths) {
      const size = await objectSize(path);
      if (size === null) continue;
      any = true;
      freed += size;
      console.log(`  - ${path}  (${(size / 1024 / 1024).toFixed(2)} MiB)`);
      if (write) {
        const res = await fetch(objectUrl(path), { method: 'DELETE', headers: authHeader });
        if (!res.ok && res.status !== 404) throw new Error(`delete ${path}: HTTP ${res.status}`);
      }
    }

    if (media.previewPath && write) {
      const url = new URL(documentUrl(project, `galleryMedia/${id}`));
      url.searchParams.set('updateMask.fieldPaths', 'previewPath');
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { previewPath: { nullValue: null } } }),
      });
      if (!res.ok) throw new Error(`clear previewPath on ${id}: HTTP ${res.status}`);
    }

    if (any) pruned += 1;
  } catch (error) {
    console.error(`  ! ${id}: ${error.message}`);
    exitCode = 1;
  }
}

console.log('');
console.log(
  `${write ? 'Pruned' : 'Would prune'} ${pruned} photograph(s), ` +
    `${(freed / 1024 / 1024).toFixed(2)} MiB from submissions/.`,
);
process.exit(exitCode);
