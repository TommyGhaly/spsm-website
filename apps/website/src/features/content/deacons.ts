/**
 * The deacons serving this church.
 *
 * ---------------------------------------------------------------------------
 * **The first people on this site who are not in the `content` collection, and
 * that is on purpose.** The three fathers are `content/clergy/*.md` documents
 * because each carries a biography staff can rewrite from the Firebase console.
 * A deacon here has a name and a year. Six half-empty documents to avoid one
 * array is the more expensive mistake, and a `content` page whose body is
 * "Ordained in 2018." is a page that will never be edited.
 *
 * It lives under `features/content` rather than beside either page that shows
 * it, because **two pages show it** — the homepage's clergy band and
 * /about/who-we-are's roster — and the second one to be written should not have
 * to reach into the first one's feature to find its own church's deacons.
 *
 * `slug` is load-bearing twice. It is the anchor a `/#deacon-severus-ghaly`
 * link scrolls to, and it is the filename `scripts/optimize-assets.mjs` writes
 * into `public/img/clergy/<slug>.webp`. `bundledPortrait()` lists that
 * directory at build time and returns null for anyone with no file, so a deacon
 * with no photograph shows his initial rather than a broken image — and gets
 * his face the moment the jpg is dropped into `assets/` and `npm run assets` is
 * run, with no change to this file or to either page.
 *
 * **None of the three has a photograph yet.** The optimiser already names the
 * files it is waiting for; see its clergy block.
 * ---------------------------------------------------------------------------
 */

export type Deacon = {
  /** The anchor, and the portrait filename. */
  slug: string;
  name: string;
  /** Printed under the name, the way `person.rank` is for the fathers. */
  rank: string;
  /** One sentence. Dates, not biography. */
  note: string;
};

/** In order of ordination. */
export const DEACONS: readonly Deacon[] = [
  {
    slug: 'deacon-severus-ghaly',
    name: 'Deacon Severus Ghaly',
    rank: 'Deacon',
    note: 'Ordained in 2018.',
  },
  {
    slug: 'deacon-peter-awadalla',
    name: 'Deacon Peter Awadalla',
    rank: 'Deacon',
    /*
     * ⚠ UNCONFIRMED YEAR. Given as 2019 with "not fully sure of that one", and
     * nothing published corroborates it — the three fathers' dates come from
     * their own biographies, this one does not. Confirm with the church before
     * this ships. A wrong ordination year on a church website is the kind of
     * error the person it is about notices first.
     */
    note: 'Ordained in 2019.',
  },
  {
    slug: 'deacon-kyrillos-bebawy',
    name: 'Deacon Kyrillos Bebawy',
    rank: 'Deacon',
    note: 'Ordained in 2026.',
  },
];

/**
 * The initial to show in place of a missing photograph.
 *
 * The rank is stripped first, or all three deacons would show a D. Shared
 * rather than written twice, because the homepage and the roster must not
 * disagree about which letter stands for a person.
 */
export function clericInitial(name: string): string {
  return name
    .trim()
    .replace(/^(H\.G\.|H\.H\.|Fr\.|Deacon|Hegumen)\s+/, '')
    .charAt(0)
    .toUpperCase();
}
