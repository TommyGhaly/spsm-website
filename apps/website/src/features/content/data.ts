import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { COLLECTIONS, type ContentPage, type ContentSection, type DocOf } from '@spsm/shared';
import { db } from '@/lib/firebase';
import { docOf, safely, withoutEmbargoed } from '@/lib/firestore';

/**
 * Prose pages: About, Our Faith, clergy bios, Contact copy.
 *
 * These were bespoke hand-built pages on Wix and are all the same thing —
 * ordered prose within a section. One template drives all of them, so adding a
 * page is a Firestore write plus a rebuild rather than a code change.
 */

export async function getContentPages(section?: ContentSection): Promise<DocOf<ContentPage>[]> {
  return safely(
    `content pages${section ? ` (${section})` : ''}`,
    async () => {
      const constraints = [where('published', '==', true), orderBy('order', 'asc')];
      if (section) constraints.unshift(where('section', '==', section));

      const snapshot = await getDocs(query(collection(db(), COLLECTIONS.content), ...constraints));
      return withoutEmbargoed('content', snapshot.docs.map(docOf<ContentPage>));
    },
    [],
  );
}

export async function getContentPage(slug: string): Promise<DocOf<ContentPage> | null> {
  return safely(
    `content page "${slug}"`,
    async () => {
      const snapshot = await getDocs(
        query(
          collection(db(), COLLECTIONS.content),
          where('published', '==', true),
          where('slug', '==', slug),
          limit(1),
        ),
      );
      const [first] = withoutEmbargoed('content', snapshot.docs.map(docOf<ContentPage>));
      return first ?? null;
    },
    null,
  );
}
