/**
 * Turn every inline subgroup into a level of its own, once.
 *
 * The galleries were three fixed levels — program, gathering, and inline
 * `groups` on the gathering — and are now a tree of arbitrary depth where every
 * level is a `programEvents` document with a `parentId`. This is the one-way
 * move between those two shapes:
 *
 *  1. each `ProgramEvent.groups[]` entry becomes a child document, keeping its
 *     name, its position among its siblings, and its `layout` (which becomes the
 *     child's own `sectionLayout`);
 *  2. every `galleryMedia` document pointing at that group by `groupId` is
 *     re-filed onto the new child by `programEventId`;
 *  3. the gathering keeps its `groups` array, untouched.
 *
 * ## Why step 3 leaves the array behind
 *
 * Because deleting it makes the migration irreversible and buys nothing. Nothing
 * in the site reads `groups` any more — see the deprecation note on it in
 * schema/programs.ts — so a stale array is inert. What it *is* good for is
 * answering "where did this photograph used to sit" if a re-file went somewhere
 * unexpected, which is worth more than a tidy document. Same reasoning as
 * `groupId`, which is likewise left on the media rather than nulled.
 *
 * ## Idempotence, and why it matters more than usual
 *
 * A re-run creates nothing it created before and re-files nothing it filed
 * before: a child is skipped when a document already exists at its id, and a
 * photograph is skipped when its `programEventId` is already the child's. That
 * is not politeness — this script's second step is a write to the parish's
 * photographs, and a half-finished first run has to be safe to finish.
 *
 * The id of a child is derived (`<gatheringId>-<groupId>`), which is what makes
 * that check possible at all. A generated id would mean a second run could not
 * tell its own work from a fresh group of the same name.
 *
 * ## Ordering
 *
 * `order` is copied from the group and then normalised to 10, 20, 30… in the
 * order the groups were in. Days are the level that actually needs a manual
 * order — "Day 2" after "Day 1" is neither a date nor an alphabet — and the
 * groups already carried exactly that, so it transfers directly.
 *
 * Usage:
 *   node scripts/migrate-gallery-tree.mjs              # dry run, prints the plan
 *   node scripts/migrate-gallery-tree.mjs -- --write   # apply
 */
import {
  accessToken,
  documentUrl,
  fromFirestore,
  toFieldMap,
} from './lib/firestore-rest.mjs';

process.loadEnvFile('.env');

const write = process.argv.includes('--write');
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!project) {
  console.error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set. Is .env present?');
  process.exit(1);
}

const authHeader = { Authorization: `Bearer ${accessToken()}` };

/** Every document in one collection, following the page tokens. */
async function listAll(collection) {
  const found = [];
  let pageToken = '';

  for (;;) {
    const url = new URL(documentUrl(project, collection));
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url, { headers: authHeader });
    if (!response.ok) {
      throw new Error(`Could not list ${collection}: ${response.status} ${await response.text()}`);
    }
    const body = await response.json();
    for (const document of body.documents ?? []) {
      found.push({
        id: document.name.split('/').pop(),
        ...fromFirestore(document.fields ?? {}),
      });
    }
    pageToken = body.nextPageToken ?? '';
    if (!pageToken) return found;
  }
}

async function createDocument(collection, id, body) {
  const url = new URL(documentUrl(project, collection));
  url.searchParams.set('documentId', id);
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFieldMap(body) }),
  });
  if (!response.ok) {
    throw new Error(`Could not create ${collection}/${id}: ${await response.text()}`);
  }
}

/**
 * Patch named fields and nothing else.
 *
 * `updateMask` is not optional here and getting it wrong is destructive: a PATCH
 * without one replaces the whole document, so re-filing a photograph would erase
 * its caption, its placement and its rendition path.
 */
async function patchDocument(collection, id, body) {
  const url = new URL(documentUrl(project, `${collection}/${id}`));
  for (const field of Object.keys(body)) url.searchParams.append('updateMask.fieldPaths', field);
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFieldMap(body) }),
  });
  if (!response.ok) {
    throw new Error(`Could not patch ${collection}/${id}: ${await response.text()}`);
  }
}

/** A URL-safe slug, matching `slugifyName` in the website's adminData. */
function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const events = await listAll('programEvents');
const media = await listAll('galleryMedia');

console.log(
  `${events.length} level${events.length === 1 ? '' : 's'}, ` +
    `${media.length} photograph${media.length === 1 ? '' : 's'}.`,
);

const byId = new Map(events.map((event) => [event.id, event]));

let created = 0;
let refiled = 0;
let skipped = 0;

for (const event of events) {
  const groups = Array.isArray(event.groups) ? event.groups : [];
  if (groups.length === 0) continue;

  // The order they were in, which is the order the days should come out in.
  const ordered = [...groups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const [index, group] of ordered.entries()) {
    const childId = `${event.id}-${group.id}`;

    if (byId.has(childId)) {
      skipped += 1;
    } else {
      const child = {
        programId: event.programId,
        parentId: event.id,
        // The group's own id, which is already a slug — `groupIdFrom` derived it
        // from the name the same way. Re-slugified for the documents where it
        // was hand-written into Firestore rather than made in the editor.
        slug: slugify(group.id) || slugify(group.name) || `part-${index + 1}`,
        title: group.name,
        description: '',
        /*
         * No dates. A subgroup never had any — it was a name and a position
         * inside a gathering — and inventing the gathering's dates for it would
         * make every day of a camp claim to span the whole week.
         */
        startAt: null,
        endAt: null,
        timeZone: event.timeZone ?? 'America/New_York',
        order: (index + 1) * 10,
        featuredMediaIds: [],
        ...(group.layout ? { sectionLayout: group.layout } : {}),
        coverMediaId: null,
        calendarEventId: null,
        /*
         * Closed, and published to match its parent.
         *
         * Closed because submissions were only ever accepted at the gathering —
         * the public form has no notion of a subgroup — so opening one here
         * would be inventing a new upload target the parish never chose.
         *
         * Published to match, because the photographs being moved onto it are
         * already public. A child left unpublished would take a live section of
         * the parish's gallery offline as its last act, which is the one outcome
         * a migration must not have.
         */
        submissionsOpen: false,
        published: event.published === true,
        publishAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: null,
      };

      console.log(`  + programEvents/${childId}  “${group.name}”  under ${event.id}`);
      if (write) await createDocument('programEvents', childId, child);
      created += 1;
    }

    const mine = media.filter(
      (item) => item.programEventId === event.id && item.groupId === group.id,
    );
    for (const item of mine) {
      console.log(`    → galleryMedia/${item.id} to ${childId}`);
      if (write) await patchDocument('galleryMedia', item.id, { programEventId: childId });
      refiled += 1;
    }
  }
}

console.log(
  `\n${created} level${created === 1 ? '' : 's'} created, ` +
    `${refiled} photograph${refiled === 1 ? '' : 's'} re-filed` +
    (skipped > 0 ? `, ${skipped} already there` : '') +
    '.',
);

if (!write) {
  console.log('\nDry run. Re-run with -- --write to apply.');
} else if (created === 0 && refiled === 0) {
  console.log('Nothing to do.');
}
