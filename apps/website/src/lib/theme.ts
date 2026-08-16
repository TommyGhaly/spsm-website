/**
 * The parish's design tokens, fetched **in the browser at runtime**.
 *
 * ---------------------------------------------------------------------------
 * This used to run at build time and bake the resulting CSS into every exported
 * HTML file. It was changed deliberately: baking the tokens meant an edit in the
 * Firebase console did nothing until the site was rebuilt and redeployed, which
 * is not what "stored in the database" should mean for a parish that wants to
 * change its own colours.
 *
 * The trade is real and worth stating, because it is the reason the build-time
 * version existed: nothing about the theme is in the HTML any more, so the very
 * first paint of a first visit uses the fallbacks compiled into globals.css.
 * Three things keep that from being a problem:
 *
 *   1. Those fallbacks *are* the design — `DEFAULT_THEME`'s values — so an
 *      unstyled or broken-looking page is not among the outcomes.
 *   2. A returning visitor never sees it. The theme is cached in localStorage
 *      and reapplied synchronously before first paint by the boot script in the
 *      root layout.
 *   3. It is one small request to a CDN-fronted Google endpoint, issued as
 *      early as the document parser reaches the head.
 * ---------------------------------------------------------------------------
 *
 * No Firebase SDK. This is a plain `fetch` of a world-readable document, and
 * pulling in `firebase/firestore` for it would add far more to every page than
 * the document it retrieves. See `publicDocumentUrl` in @spsm/shared.
 */
import {
  CONFIG_DOC_THEME,
  COLLECTIONS,
  DEFAULT_THEME,
  decodeFirestoreFields,
  emitThemeCss,
  parseTheme,
  publicDocumentUrl,
  type ThemeTokens,
} from '@spsm/shared';

/** The `<style>` element this module owns, and the localStorage key it caches to. */
export const THEME_STYLE_ID = 'spsm-theme';
export const THEME_CACHE_KEY = 'spsm.theme.css.v1';

/**
 * Fetch and parse the theme. Never throws.
 *
 * Returns `null` rather than `DEFAULT_THEME` when the read fails, so the caller
 * can tell "the database said something" from "we could not reach it" — and
 * leave the already-applied fallbacks alone in the second case rather than
 * repainting to the same values.
 */
export async function fetchTheme(signal?: AbortSignal): Promise<ThemeTokens | null> {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!projectId || !apiKey) return null;

  try {
    const path = `${COLLECTIONS.config}/${CONFIG_DOC_THEME}`;
    // `npm run dev:local` points the rest of the app at the emulators; the theme
    // has to follow, or local development silently styles itself from the live
    // parish site and an emulator-only theme edit appears to do nothing.
    const url =
      process.env.NEXT_PUBLIC_USE_EMULATORS === '1'
        ? `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents/${path}`
        : publicDocumentUrl(projectId, path, apiKey);
    const response = await fetch(url, {
      signal: signal ?? null,
      // The document changes when staff edit it, which is rarely but must not
      // require a hard refresh to see. The browser cache would otherwise serve
      // a stale copy for as long as Google's headers say.
      cache: 'no-cache',
    });
    if (!response.ok) return null;

    const body = (await response.json()) as { fields?: unknown };
    return parseTheme(decodeFirestoreFields(body.fields ?? {}));
  } catch {
    // Offline, blocked, aborted mid-navigation, or malformed. All the same
    // answer: keep what is already on screen.
    return null;
  }
}

/**
 * Put the tokens on the page, and remember them for next time.
 *
 * Replaces the element's text rather than appending a second `<style>`, so a
 * repeated call cannot leave two competing blocks whose winner depends on
 * source order.
 */
export function applyTheme(theme: ThemeTokens): void {
  const css = emitThemeCss(theme);

  let element = document.getElementById(THEME_STYLE_ID);
  if (!element) {
    element = document.createElement('style');
    element.id = THEME_STYLE_ID;
    document.head.appendChild(element);
  }
  element.textContent = `:root {\n${css}\n}`;

  try {
    localStorage.setItem(THEME_CACHE_KEY, css);
  } catch {
    // Private mode, or storage full. The theme still applied; only the
    // no-flash-next-time part is lost, which is not worth failing over.
  }
}

/** Exported for the tests and for anything that wants the shipped values. */
export { DEFAULT_THEME };
