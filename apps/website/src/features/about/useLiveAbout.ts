'use client';

import { useEffect, useState } from 'react';
import { decodeFirestoreFields, parseAboutOverride, type AboutSlug } from '@spsm/shared';
import type { AboutCopy } from './context';

/**
 * This page's copy as it is *now*, not as it was at the last build.
 *
 * ---------------------------------------------------------------------------
 * ## Why a static page reads the database at all
 *
 * The five About pages are prerendered — `getAboutOverride` runs during
 * `next build` and the overridden words are baked into the HTML. That is right
 * for pages like these: they render instantly, they work with no JavaScript,
 * and a search engine sees the real text.
 *
 * It is also why an edit made in the browser would sit invisible until somebody
 * redeployed, which defeats the point of an editor. The same arrangement the
 * bookstore catalog and the homepage bulletin already use: bake it, then read
 * through to the live copy and swap. A visitor sees the baked page immediately
 * and, a moment later, the real one — and in the overwhelmingly common case
 * they are identical and nothing moves.
 *
 * ## One document, by id, over REST
 *
 * `GET /aboutOverrides/{slug}`. Not a query, which is the whole reason this is
 * simpler than `useLiveCatalog`: there is no result set to prove anything
 * about, so no `where('published','==',true)` and no decision-#10 trap. The
 * rule is `allow read: if true` and no credential is involved beyond the public
 * API key.
 *
 * ## Failure is silence
 *
 * Every error path leaves the baked copy on screen, including a 404 — which is
 * the ordinary state for a page nobody has edited yet. A page showing last
 * week's wording is a working page; a page showing an error because a refresh
 * failed is not. Nothing here is awaited by anything a reader does.
 * ---------------------------------------------------------------------------
 */

interface RestDocument {
  fields?: unknown;
}

function restBase(): { url: string; key: string } | null {
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!project) return null;

  const path = `projects/${project}/databases/(default)/documents`;
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === '1') {
    return { url: `http://127.0.0.1:8080/v1/${path}`, key: '' };
  }
  return apiKey ? { url: `https://firestore.googleapis.com/v1/${path}`, key: apiKey } : null;
}

export function useLiveAbout(page: AboutSlug, enabled = true): AboutCopy | null {
  const [live, setLive] = useState<AboutCopy | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const base = restBase();
    if (!base) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const suffix = base.key ? `?key=${base.key}` : '';
        const response = await fetch(`${base.url}/aboutOverrides/${page}${suffix}`, {
          signal: controller.signal,
        });
        // A 404 means nobody has ever edited this page. Ordinary, not an error.
        if (!response.ok) return;

        const document = (await response.json()) as RestDocument;
        const parsed = parseAboutOverride(page, decodeFirestoreFields(document.fields));
        setLive({ slots: parsed.slots, sections: parsed.sections });
      } catch {
        /* Baked copy stays. See the header. */
      }
    })();

    return () => controller.abort();
  }, [page, enabled]);

  return live;
}
