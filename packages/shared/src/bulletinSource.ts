/**
 * Resolving "the active bulletin" against the announcements project.
 *
 * ---------------------------------------------------------------------------
 * This lives in @spsm/shared because it has exactly two callers and they must
 * not drift.
 *
 *   - the website build (`features/bulletin/data.ts`), which bakes the active
 *     week into static HTML;
 *   - the `bulletin` Cloud Function, which re-reads it at request time so the
 *     homepage stops being as old as the last deploy.
 *
 * If those two ever resolved the active bulletin differently, the homepage
 * would swap week a moment after load, for no reason a reader could see and
 * with nothing in either codebase looking wrong. One function, imported twice.
 * The mobile app is a third caller in waiting.
 * ---------------------------------------------------------------------------
 *
 * Deliberately SDK-free, like everything else in this package: the Firestore
 * handle is taken structurally (see `SourceFirestore`), so a caller can pass a
 * handle from any admin app — the build opens the project with a key from
 * `.env`, the Function with one from Secret Manager — and neither has to care
 * that it is the same read. It also means this is testable against a plain
 * object instead of an emulator.
 */
import {
  parseBulletin,
  activeBulletinId,
  mostRecentlyPublished,
  ANNOUNCEMENTS_ACTIVE_BULLETIN_DOC,
  BulletinShapeError,
  type Bulletin,
} from './schema/bulletin.js';
import type { AnnouncementsConfig } from './schema/config.js';

/**
 * The slice of the Admin SDK's `Firestore` this read uses. Structural, so
 * nothing here depends on `firebase-admin`.
 */
export interface SourceFirestore {
  doc(path: string): {
    get(): Promise<{
      readonly exists: boolean;
      readonly id: string;
      data(): Record<string, unknown> | undefined;
    }>;
  };
  collection(path: string): {
    get(): Promise<{
      readonly empty: boolean;
      readonly docs: readonly { readonly id: string; data(): Record<string, unknown> }[];
    }>;
  };
}

/**
 * The bulletin the announcements app says is active, or null.
 *
 * Order of preference, and the reasoning is on
 * `ANNOUNCEMENTS_ACTIVE_BULLETIN_DOC` and `mostRecentlyPublished`:
 *
 *   1. `config/active_bulletin` -> `bulletins/{id}`. One document read, and it
 *      agrees with the screen in the narthex by construction rather than by a
 *      rule that happens to coincide with it.
 *   2. The most recently *published* week, if the pointer is missing or names
 *      something unusable. Published, never newest — the newest document is
 *      reliably next week's unpublished draft, because drafting next week is
 *      what people use that app for.
 *   3. Null. At that point there is no honest answer, and a missing section
 *      beats a wrong schedule.
 *
 * Never throws for a badly shaped week: a document that cannot be parsed is
 * skipped with a warning, because one malformed week over there should not cost
 * this site a deploy or a request.
 */
export async function readActiveBulletin(
  firestore: SourceFirestore,
  config: AnnouncementsConfig,
): Promise<Bulletin | null> {
  const parse = (documentId: string, data: Record<string, unknown>): Bulletin | null => {
    try {
      return parseBulletin(data, {
        project: config.projectId,
        collection: config.collectionPath,
        documentId,
      });
    } catch (error) {
      if (error instanceof BulletinShapeError) {
        console.warn(`[bulletin] skipping source document ${documentId}: ${error.message}`);
        return null;
      }
      throw error;
    }
  };

  const pointer = await firestore.doc(ANNOUNCEMENTS_ACTIVE_BULLETIN_DOC).get();
  const activeId = pointer.exists ? activeBulletinId(pointer.data()) : null;

  if (activeId === null) {
    console.warn(
      `[bulletin] ${config.projectId}/${ANNOUNCEMENTS_ACTIVE_BULLETIN_DOC} is missing or ` +
        `has no "id". Falling back to the last published week.`,
    );
  } else {
    const active = await firestore.doc(`${config.collectionPath}/${activeId}`).get();

    if (!active.exists) {
      console.warn(
        `[bulletin] ${ANNOUNCEMENTS_ACTIVE_BULLETIN_DOC} names ${activeId}, which does not ` +
          `exist in ${config.collectionPath}. Falling back to the last published week.`,
      );
    } else {
      const bulletin = parse(active.id, active.data() ?? {});
      if (bulletin) return bulletin;
      // Said out loud rather than quietly showing a different week: the parish
      // chose this document, and we are about to not use it.
      console.warn(
        `[bulletin] ${ANNOUNCEMENTS_ACTIVE_BULLETIN_DOC} names ${activeId}, but that ` +
          `document could not be parsed. Falling back to the last published week.`,
      );
    }
  }

  const snapshot = await firestore.collection(config.collectionPath).get();

  if (snapshot.empty) {
    console.warn(
      `[bulletin] ${config.projectId}/${config.collectionPath} is empty. ` +
        `Check the collection path in config/integrations.`,
    );
    return null;
  }

  const published = mostRecentlyPublished(
    snapshot.docs.map((doc) => parse(doc.id, doc.data())).filter((b): b is Bulletin => b !== null),
  );

  if (published === null) {
    console.warn(
      `[bulletin] no document in ${config.collectionPath} has ever been published, so ` +
        `there is no week to fall back to.`,
    );
  }
  return published;
}
