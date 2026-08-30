/**
 * The two saints this church is named for, as data.
 *
 * ---------------------------------------------------------------------------
 * Literals, not a Firestore read — the same choice as `TOUR_STATIONS` next
 * door, for a plainer reason: a martyr's feast day does not change, and the
 * pictures are files in `public/`. There is nothing here a staff member would
 * ever edit, and a page that can be emptied by a failed read is worse than one
 * that cannot.
 *
 * What is *not* here is the prose. It lives in the page itself, as JSX, because
 * it is two lives told in paragraphs with pictures set into them, and a block
 * format rich enough to hold that would be a CMS. What lives here is the part
 * that has to agree with something outside this file: the picture slugs (which
 * name files the asset pipeline emits), the licences (which the parish is
 * obliged to print), and the feast dates (which are the Church's, not ours).
 * ---------------------------------------------------------------------------
 */

/**
 * One picture on the page.
 *
 * `slug` names two files the asset pipeline writes — `-520.webp` for a tile in
 * the iconography grid and `-1100.webp` for a figure beside the prose — so a
 * replacement picture is a new original in `assets/saints/` and a re-run of
 * `npm run assets`. See the saints block in `scripts/optimize-assets.mjs`.
 *
 * `alt` is for somebody who cannot see the picture and `caption` is the line
 * printed under it. They are never the same sentence: the alt text says what is
 * in the frame, the caption says why it is on the page.
 */
export type SaintImage = {
  slug: string;
  alt: string;
  caption: string;
  /** The intrinsic size of the `-1100` file, so the text never reflows when the
   *  picture lands. Read off the built files rather than guessed: two of these
   *  sources are smaller than 1100px and stop where they stop. */
  width: number;
  height: number;
};

export const SAINT_IMAGES: Record<string, SaintImage> = {
  'mercurius-icon': {
    slug: 'mercurius-icon',
    alt: 'A Coptic icon of a young soldier on a black horse, a sword raised in each hand, an angel above him holding out one of them, and a crowned man falling under the horse’s hooves.',
    caption:
      'The two swords: the one the army issued him and the one the angel brought. The crowned figure beneath the horse is Julian; the bishop at the left is St. Basil.',
    width: 792,
    height: 1186,
  },
  'mercurius-triptych': {
    slug: 'mercurius-triptych',
    alt: 'A black and white photograph of a painted wooden triptych hanging on a plastered wall, a mounted saint in the centre panel and a robed elder on each wing.',
    caption:
      'The same saint on a triptych at the Monastery of St. Paul in the Eastern Desert, photographed there in 1930.',
    width: 1100,
    height: 824,
  },
  'mercurius-church-cairo': {
    slug: 'mercurius-church-cairo',
    alt: 'The inside of an ancient church: two rows of stone columns, a dark wooden screen inlaid with crosses across the far end, and oil lamps hanging from a great chandelier.',
    caption:
      'The Church of St. Mercurius in Old Cairo — Dayr Abu Sefein — where his relics are kept.',
    width: 1100,
    height: 733,
  },
  'mina-mosaic': {
    slug: 'mina-mosaic',
    alt: 'A mosaic of a young soldier in a red cloak and blue tunic, both arms raised open at his sides, with a camel kneeling on either side of him and a church in the distance behind.',
    caption:
      'St. Mina in the cathedral of the monastery at Mariout, standing between the two camels he is never shown without.',
    width: 600,
    height: 821,
  },
  'mina-plaque': {
    slug: 'mina-plaque',
    alt: 'A carved ivory plaque of a soldier standing under an arch with both hands raised, a kneeling camel on each side of him.',
    caption:
      'A sixth-century plaque carried out of Alexandria, now in Milan. The open hands are how the early Church is shown praying.',
    width: 1100,
    height: 1080,
  },
  'mina-ampulla': {
    slug: 'mina-ampulla',
    alt: 'A small round clay flask with two handles, stamped with a standing figure between two animals inside a beaded circle.',
    caption:
      'A pilgrim’s flask filled at the shrine and carried home. They have been dug up as far away as France and Germany.',
    width: 1100,
    height: 1469,
  },
  'mina-basilica': {
    slug: 'mina-basilica',
    alt: 'Low stone walls, broken column bases and scattered blocks of white marble on flat desert sand under a clear sky.',
    caption:
      'What is left of the Great Basilica at Abu Mina, in the desert south-west of Alexandria.',
    width: 1100,
    height: 825,
  },
};

/**
 * A day the Church keeps for one of them.
 *
 * Both dates, always. The Coptic date is the one the Synaxarium is read on and
 * the one a Coptic calendar prints; the Gregorian date is the one a visitor
 * reading this in Wayland can find on their phone. Giving only the first is
 * accurate and useless to a newcomer, and giving only the second quietly drops
 * the calendar the Church actually keeps.
 *
 * The Gregorian dates hold for an ordinary year and slip by a day in the year
 * before a Coptic leap year, which is why the page says so once rather than
 * hedging every line.
 */
export type Feast = {
  coptic: string;
  gregorian: string;
  what: string;
};

export const MERCURIUS_FEASTS: readonly Feast[] = [
  { coptic: '25 Hathor', gregorian: '4 December', what: 'His martyrdom' },
  { coptic: '25 Abib', gregorian: '1 August', what: 'The consecration of his church' },
];

export const MINA_FEASTS: readonly Feast[] = [
  { coptic: '15 Hathor', gregorian: '24 November', what: 'His martyrdom' },
  {
    coptic: '15 Paoni',
    gregorian: '22 June',
    what: 'The consecration of his church at Mariout',
  },
];

/**
 * Where each picture came from, and under what licence.
 *
 * ---------------------------------------------------------------------------
 * Transcribed from `assets/saints/credits.json`, which was written straight
 * from the Wikimedia Commons API rather than typed from memory — so the author
 * and the licence beside a picture are the ones its uploader actually asserted.
 *
 * Four of the seven are CC BY or CC BY-SA, which oblige the parish to name the
 * author and the licence wherever the picture is published; the other three are
 * CC0 and oblige nothing. All seven are listed, for the reason the tour's
 * credits list gives: a list that silently drops the entries which do not
 * *require* crediting teaches the next person that the list is optional.
 *
 * Nothing NC and nothing ND, so the parish may reprint any of these in a
 * bulletin or on a poster without asking anybody.
 *
 * None of them is this church, and none of them is a photograph of a relic
 * taken by us. They are museum objects, a monastery mosaic, a church interior
 * and an excavated site — the things the words are about.
 * ---------------------------------------------------------------------------
 */
export type SaintCredit = {
  slug: string;
  what: string;
  author: string;
  license: string;
  /** The permanent Commons description page — the link the licences require. */
  page: string;
};

export const SAINT_CREDITS: readonly SaintCredit[] = [
  {
    slug: 'mercurius-icon',
    what: 'Icon of St. Mercurius',
    author: 'Yuhannarmani',
    license: 'CC BY-SA 3.0',
    page: 'https://commons.wikimedia.org/wiki/File:Yuhanna-Mercurius.jpg',
  },
  {
    slug: 'mercurius-triptych',
    what: 'Triptych at the Monastery of St. Paul',
    author: 'Kazazian, for Dumbarton Oaks',
    license: 'CC0',
    page: 'https://commons.wikimedia.org/wiki/File:Triptych_icon_of_Saint_Mercurius,_Monastery_of_Saint_Paul,_Egypt_-_MSBZ004_B17_-_Dumbarton_Oaks.jpg',
  },
  {
    slug: 'mercurius-church-cairo',
    what: 'The Church of St. Mercurius, Old Cairo',
    author: 'Sailko',
    license: 'CC BY 3.0',
    page: 'https://commons.wikimedia.org/wiki/File:Cairo,_monastero_di_san_mercurio,_02.JPG',
  },
  {
    slug: 'mina-mosaic',
    what: 'Mosaic of St. Mina at the monastery, Mariout',
    author: 'Roland Unger',
    license: 'CC BY-SA 3.0',
    page: 'https://commons.wikimedia.org/wiki/File:DeirAbuMena.jpg',
  },
  {
    slug: 'mina-plaque',
    what: 'Sixth-century plaque from Alexandria, Castello Sforzesco, Milan',
    author: 'Sailko',
    license: 'CC BY 2.5',
    page: "https://commons.wikimedia.org/wiki/File:Tavoletta_paleocristiana_con_san_mena,_da_alessandria_d'egitto.JPG",
  },
  {
    slug: 'mina-ampulla',
    what: 'Pilgrim flask, the Metropolitan Museum of Art',
    author: 'The Metropolitan Museum of Art',
    license: 'CC0',
    page: 'https://commons.wikimedia.org/wiki/File:Ampulla_(Flask)_with_Saint_Menas_MET_DP258369.jpg',
  },
  {
    slug: 'mina-basilica',
    what: 'The Great Basilica at Abu Mina',
    author: 'Institute for the Study of the Ancient World',
    license: 'CC BY 2.0',
    page: 'https://commons.wikimedia.org/wiki/File:Ruins_of_the_Great_Basilica_at_Abu_Mena_(I).jpg',
  },
];

/** The tile in the iconography grid. */
export function saintThumb(slug: string): string {
  return `/img/saints/${slug}-520.webp`;
}

/** The figure beside the prose, and the wide source in the `srcset`. */
export function saintFull(slug: string): string {
  return `/img/saints/${slug}-1100.webp`;
}
