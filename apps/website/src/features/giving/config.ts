/**
 * Where the parish's giving form lives.
 *
 * Its own module rather than living in `index.ts` because `GiveButton` is a
 * client component: importing the barrel from a `'use client'` file drags the
 * server components beside it into the browser bundle.
 */

/**
 * The parish's Tithe.ly giving form.
 *
 * **Committed, not read from `.env`, and that is deliberate.** `.env*` is
 * gitignored (only `.env.example` survives), so anything that lives only there
 * is absent from a fresh clone and from any build that is not Tommy's laptop —
 * and for eight months `NEXT_PUBLIC_TITHELY_GIVING_URL` sat empty, which is why
 * /giving has been showing "online giving is being set up" to every visitor.
 *
 * This is not a credential. It is the same identifier Tithe.ly prints in the
 * embed snippet it hands you, and it ships in this page's HTML either way; it
 * authorises nothing beyond opening a public donation form. A key would still go
 * in `.env` — see `TITHELY_PRIVATE_KEY`, which is a Functions secret.
 *
 * The env var still wins if it is set, so a test form can be swapped in without
 * a code change.
 */
export const GIVING_FORM_ID =
  process.env.NEXT_PUBLIC_TITHELY_FORM_ID || '44f1af1b-7edf-4005-af05-0c7a7f7249ac';

/**
 * Where Tithe.ly's hosted form lives. Also the origin `GiveButton` checks a
 * `postMessage` against, which is the reason it is a constant and not spelled
 * out at each use — an origin comparison that drifts from the URL it is
 * comparing is a security hole that looks like a typo.
 */
export const GIVE_ORIGIN = 'https://give.tithe.ly';

/**
 * The form as a top-level page.
 *
 * This is the *fallback*: what `GiveButton` puts in its `href`, what a visitor
 * with JavaScript off gets, and what the overlay's own "open in a new tab"
 * escape hatch points at. It has to stay a real, working destination.
 *
 * Derived from the form id rather than configured separately, because two
 * settings that must agree are one setting and a bug.
 * `NEXT_PUBLIC_TITHELY_GIVING_URL` overrides it for the case where the parish's
 * giving page moves somewhere that is not a form id at all.
 */
export function givingUrl(): string {
  const url = process.env.NEXT_PUBLIC_TITHELY_GIVING_URL;
  if (url && !url.startsWith('REPLACE_ME')) return url;
  return `${GIVE_ORIGIN}/?formId=${GIVING_FORM_ID}`;
}

/**
 * The same form, asked for in its framed mode.
 *
 * `context=modal` is Tithe.ly's own parameter — it is what their `give.js`
 * requests for the embed, and it is what makes the framed page post
 * `closeWindow` to its parent when the gift is finished. Always built from
 * `GIVING_FORM_ID` rather than from `givingUrl()`, because that one may have been
 * overridden to something that is not a Tithe.ly form at all, and appending a
 * Tithe.ly query parameter to it would be meaningless.
 */
export function giveFormUrl(): string {
  return `${GIVE_ORIGIN}/?formId=${GIVING_FORM_ID}&context=modal`;
}
