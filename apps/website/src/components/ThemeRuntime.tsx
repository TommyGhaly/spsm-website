'use client';

import { useEffect } from 'react';
import { applyTheme, fetchTheme } from '@/lib/theme';

/**
 * Fetches `config/theme` in the browser and applies it.
 *
 * Renders nothing. It is a component only because that is how a static export
 * gets to run code on every page without a server — and it sits in the root
 * layout, so a visitor landing on any page picks up the parish's current theme.
 *
 * The pairing to understand is with `ThemeBootScript`, which runs first:
 *
 *   boot script  → synchronous, before paint, applies the **cached** theme.
 *                  Prevents the flash for anyone who has been here before.
 *   this effect  → asynchronous, after paint, applies the **fresh** theme and
 *                  updates that cache. This is what makes a console edit show
 *                  up without a rebuild.
 *
 * On a first visit only the second runs, so the first paint uses the fallbacks
 * compiled into globals.css — which are `DEFAULT_THEME`'s own values, not
 * placeholders. The page is never unstyled, only briefly last-release.
 */
export function ThemeRuntime() {
  useEffect(() => {
    // Abort if the visitor navigates away mid-flight. Applying a theme to a
    // page that has already been replaced is harmless but pointless, and the
    // abort keeps React from warning about the late state of a dead tree.
    const controller = new AbortController();

    fetchTheme(controller.signal).then((theme) => {
      if (theme && !controller.signal.aborted) applyTheme(theme);
    });

    return () => controller.abort();
  }, []);

  return null;
}

/**
 * The pre-paint half: restores the cached theme synchronously.
 *
 * This has to be an inline, blocking script in `<head>`. Anything deferred —
 * including a React effect — runs after the first paint, which is precisely the
 * flash it exists to prevent.
 *
 * **It contains no token values**, only the code to read them back. That is the
 * point of the change: the exported HTML carries no styling, so a theme edit
 * needs no rebuild.
 *
 * Two safety properties worth not breaking:
 *
 *   - The cached string is **validated before injection**, with the same
 *     allowlist `isSafeThemeCss` uses. `localStorage` is writable by any script
 *     on this origin, so "we wrote it" is not a reason to trust it on the way
 *     back in. Inlined here rather than imported because an import cannot be
 *     synchronous in a plain script tag.
 *   - Everything is wrapped in try/catch. A visitor with storage disabled gets
 *     the fallback palette, not a script error that stops the parser.
 */
export function ThemeBootScript() {
  const source = `(function(){try{
var css=localStorage.getItem('spsm.theme.css.v1');
if(!css||css.length>20000)return;
var lines=css.split('\\n');
for(var i=0;i<lines.length;i++){
var l=lines[i].trim();
if(!l)continue;
if(!/^--[a-z0-9-]+:\\s*[a-z0-9\\s.,%#'()+\\/*-]+;$/i.test(l))return;
if(/url\\(|@import|expression|javascript:|\\/\\*/i.test(l))return;
}
var s=document.createElement('style');
s.id='spsm-theme';
s.textContent=':root{'+css+'}';
document.head.appendChild(s);
}catch(e){}})();`;

  return (
    <script
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: source }}
    />
  );
}
