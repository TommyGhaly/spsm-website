/**
 * The clergy serving this church, for the roster at the foot of
 * /about/who-we-are.
 *
 * ---------------------------------------------------------------------------
 * **Literals, not the `content` collection — a real cost, stated here rather
 * than discovered later.** The three fathers already exist as
 * `content/clergy/*.md` documents and the homepage reads them from Firestore.
 * The three below duplicate their names.
 *
 * They do so because this page has no Firestore read in it at all and is the
 * better for it — it is a history, it is the same for everybody forever, and
 * making it `async` to fetch three names it could state would be paying a
 * network round trip for nothing. What is duplicated is deliberately only *rank
 * and dates*; the biographies stay in Firestore and are not repeated here, so
 * the drift surface is a name and a title. `slug` is the same slug the content
 * document has, which is what keeps the portraits shared rather than copied.
 *
 * **The deacons are not here.** They are in `features/content/deacons.ts`,
 * because the homepage shows them too and neither page should have to reach
 * into the other's feature for its own church's clergy. `ROSTER` below is the
 * two joined, in rank order.
 *
 * `slug` is load-bearing twice over. It is the `content` document id, and it is
 * the filename `scripts/optimize-assets.mjs` writes into
 * `public/img/clergy/<slug>.webp`. `bundledPortrait()` reads that directory at
 * build time and returns null for anyone with no file, so a person listed here
 * without a photograph gets the initial mark rather than a broken image — and
 * gets their face the moment the file lands, with no change to this file.
 *
 * **The three deacons have no photographs yet.** The optimiser already names
 * the files it is waiting for; see its clergy block.
 * ---------------------------------------------------------------------------
 */

import { DEACONS } from '@/features/content/deacons';

export type Cleric = {
  /** The `content` slug, and the portrait filename. */
  slug: string;
  name: string;
  /** The order and see, if there is one. Printed under the name. */
  rank: string;
  /** One sentence. Dates, not biography — the biographies are on the homepage. */
  note: string;
};

/**
 * In order of rank, then of when each was set here.
 *
 * The bishop first because the diocese is the church's, not the other way
 * round: a Coptic Orthodox church is a bishop's church served by his priests,
 * and a roster that opened with the resident priests would have the
 * ecclesiology backwards.
 */
export const CLERGY: readonly Cleric[] = [
  {
    slug: 'bishop-david',
    name: 'H.G. Bishop David',
    rank: 'Bishop of the Diocese of New York and New England',
    note: 'Consecrated in Cairo on 16–17 November 2013 as the first bishop of the diocese, and enthroned that December.',
  },
  {
    slug: 'fr-youhanna-gobran',
    name: 'Hegumen Youhanna Gobran',
    rank: 'Priest',
    note: 'Ordained priest by Pope Shenouda III on 12 January 2002 and served at St. Mark in Natick. Set here by Bishop David in 2016, and elevated to hegumen in November 2022.',
  },
  {
    slug: 'fr-armia-tawfik',
    name: 'Fr. Armia Tawfik',
    rank: 'Priest',
    note: 'Ordained by Bishop Timotheos on 27 November 2015 and served in Zagazig, Egypt. Appointed here by Bishop David in January 2024.',
  },
];

/**
 * The fathers and then the deacons, as one list, which is what the roster
 * renders.
 *
 * Three and three, and the layout below leans on that: the grid is a fixed
 * three columns from 48rem up so the six fall as two even rows. An `auto-fit`
 * grid put four on the first row and two on the second at a laptop width, which
 * reads as a group of four and a leftover pair rather than as clergy and
 * deacons. If a fourth priest is appointed, that assumption breaks and the
 * columns need looking at again — which is a better failure than silently
 * dropping him.
 */
export const ROSTER: readonly Cleric[] = [...CLERGY, ...DEACONS];

