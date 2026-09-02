/**
 * The eleven pictures on /about/our-belief, and where each one came from.
 *
 * Every one is from Wikimedia Commons and is public domain, CC BY or CC BY-SA.
 * The originals live in `assets/belief/` beside a `credits.json` written by the
 * Commons API, and `scripts/optimize-assets.mjs` turns each into a 640px and a
 * 1280px WebP under `public/img/belief/`.
 *
 * **`width` is the real width of the large file, not 1280.** The optimiser
 * resizes `withoutEnlargement`, so a 1,023px original stays 1,023px; a srcset
 * descriptor claiming 1280w for that file would make the browser pick it on
 * screens where it is no larger than the small one. The numbers below are read
 * off the emitted files.
 *
 * `alt` describes the picture to somebody who cannot see it. `caption` says
 * what it is and why it is here, and is read by everybody — they are different
 * jobs and neither is a copy of the other.
 */

export type BeliefPicture = {
  /** A few words naming the work, for the credits list. */
  short: string;
  alt: string;
  caption: string;
  /** Intrinsic size of the 1280 file, so nothing reflows when it lands. */
  width: number;
  height: number;
  /** Which way it hangs. Drives the frame's aspect ratio, nothing else. */
  shape: 'tall' | 'wide';
};

export const BELIEF_PICTURES = {
  'wadi-natrun-frescos': {
    short: 'Monastery wall paintings, Wadi al-Natrun',
    alt: 'Painted saints and angels filling the half-dome of a monastery apse, the plaster cracked with age.',
    caption:
      'Wall paintings in a monastery church in Wadi al-Natrun, the desert valley north-west of Cairo. Monks have lived there without a break since the fourth century.',
    width: 1280,
    height: 857,
    shape: 'wide',
  },
  'holy-trinity': {
    short: 'The Trinity, Andrei Rublev',
    alt: 'An icon of three angels seated around a table, each with a staff, inclining towards one another.',
    caption:
      'Rublev’s Trinity, Moscow, about 1411 — the three visitors Abraham received at Mamre. The Church does not paint the divine essence; when it depicts the Trinity, it paints this.',
    width: 1280,
    height: 1594,
    shape: 'tall',
  },
  'council-of-nicaea': {
    short: 'The First Council of Nicaea',
    alt: 'An icon of the First Council of Nicaea: bishops standing around the Emperor Constantine, holding an open scroll of Greek text.',
    caption:
      'The First Council of Nicaea. The fathers hold the Creed they wrote, with Constantine — who summoned them — at the centre; the scroll carries its opening lines in Greek.',
    width: 1024,
    height: 1388,
    shape: 'tall',
  },
  'alexandrian-fathers': {
    short: 'St. Athanasius and St. Cyril of Alexandria',
    alt: 'A gold-ground icon of two bishops in patterned vestments, each holding a Gospel book.',
    caption:
      'St. Athanasius and St. Cyril of Alexandria, on a Cretan icon. Athanasius went to Nicaea as a deacon; Cyril presided at Ephesus a century later.',
    width: 1162,
    height: 1600,
    shape: 'tall',
  },
  'christ-pantocrator': {
    short: 'Christ Pantocrator, Sinai',
    alt: 'The sixth-century Sinai icon of Christ, holding a jewelled Gospel book and raising His right hand in blessing.',
    caption:
      'Christ Pantocrator — painted in coloured wax at the Monastery of St. Catherine in Sinai in the sixth century, and among the oldest icons of Christ that survive.',
    width: 1023,
    height: 1688,
    shape: 'tall',
  },
  'theotokos-sinai': {
    short: 'The Virgin enthroned, Sinai',
    alt: 'An early icon of the Virgin enthroned with the Christ child on her lap, a soldier-saint standing on either side and two angels behind.',
    caption:
      'The Virgin enthroned with the Christ child, between St. Theodore and St. George. Encaustic on wood, Sinai, sixth century.',
    width: 1038,
    height: 1525,
    shape: 'tall',
  },
  'resurrection': {
    short: 'The Resurrection, Elias Moskos',
    alt: 'An icon of the risen Christ standing in light above the tomb, holding a banner, with soldiers scattered below.',
    caption:
      'The Resurrection, painted by Elias Moskos on Crete in 1679 — Christ risen above the sealed tomb, the guard thrown down around it.',
    width: 1080,
    height: 1438,
    shape: 'tall',
  },
  'coptic-gospel-leaf': {
    short: 'A Coptic manuscript leaf',
    alt: 'A page of a hand-copied manuscript in Coptic letters, with a decorated initial in the margin.',
    caption:
      'A leaf from a Coptic manuscript of the Pauline Epistles and the Gospel of John — the Scriptures in the language of Egypt.',
    width: 1280,
    height: 1432,
    shape: 'tall',
  },
  'hanging-church': {
    short: 'The Hanging Church, Old Cairo',
    alt: 'The interior of an old Coptic church: rows of marble columns, dark wooden screens inlaid with ivory, and hanging lamps.',
    caption:
      'Inside the Hanging Church in Old Cairo, built above the gatehouse of a Roman fortress and in use for something like thirteen centuries.',
    width: 1280,
    height: 960,
    shape: 'wide',
  },
  'coptic-baptism': {
    short: 'A Coptic Orthodox baptism',
    alt: 'A priest in a black vestment leaning over a stone font, one hand steadying the child being baptised in it.',
    caption:
      'A baptism in a Coptic Orthodox church. The child is immersed three times, and is anointed with the holy Myron immediately afterwards.',
    width: 1280,
    height: 960,
    shape: 'wide',
  },
  'st-mark-preaching': {
    short: 'St. Mark Preaching in Alexandria',
    alt: 'A wide Renaissance painting of St. Mark preaching from a platform in a great square, before a domed basilica and a crowd in Eastern dress.',
    caption:
      'St. Mark Preaching in Alexandria, begun by Gentile Bellini and finished by his brother Giovanni around 1507. The Alexandria in it is imagined — the painting was made for the Venetian confraternity that kept the Evangelist’s relics.',
    width: 1280,
    height: 608,
    shape: 'wide',
  },
} as const satisfies Record<string, BeliefPicture>;

export type BeliefPictureName = keyof typeof BELIEF_PICTURES;

/** The small file. 640px is a full-width plate on a retina phone. */
export function beliefSmall(name: BeliefPictureName): string {
  return `/img/belief/${name}-640.webp`;
}

/** The large file. Its real width is `BELIEF_PICTURES[name].width`. */
export function beliefLarge(name: BeliefPictureName): string {
  return `/img/belief/${name}-1280.webp`;
}

/**
 * Where every picture on this page came from, and under what licence.
 *
 * Generated from `assets/belief/credits.json`, which the Commons API wrote —
 * not typed out here — so the author and licence beside a picture are the ones
 * Commons holds rather than the ones somebody remembered.
 *
 * Public-domain entries are listed too, though nothing obliges us to. A credits
 * list that quietly drops the works it is not *required* to credit teaches the
 * next person that the list is optional.
 */
export type BeliefCredit = {
  name: BeliefPictureName;
  author: string;
  license: string;
  /** The permanent Commons description page — the link the licences require. */
  page: string;
};

export const BELIEF_CREDITS: readonly BeliefCredit[] = [
  {
    name: 'wadi-natrun-frescos',
    author: 'Diaa abdelmoneim',
    license: 'CC BY-SA 3.0',
    page: 'https://commons.wikimedia.org/wiki/File:Coptic_Frescos_from_the_Wadi_Natrun_monastery.jpg',
  },
  {
    name: 'holy-trinity',
    author: 'Andrei Rublev',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Angelsatmamre-trinity-rublev-1410.jpg',
  },
  {
    name: 'council-of-nicaea',
    author: 'Unknown author',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Nicaea_icon.jpg',
  },
  {
    name: 'alexandrian-fathers',
    author: 'Unknown author',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Cretan_Icon_of_Saint_Kyrillos_and_Saint_Athanasios_of_Alexandria.jpg',
  },
  {
    name: 'christ-pantocrator',
    author: 'Anonymous',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Spas_vsederzhitel_sinay_(cropped).jpg',
  },
  {
    name: 'theotokos-sinai',
    author: 'Unknown author',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Mary_%26_Child_Icon_Sinai_6th_century.jpg',
  },
  {
    name: 'resurrection',
    author: 'Elias Moskos',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Resurrection_by_Ilias_Moskos_(1679,_Byzantine_museum).jpg',
  },
  {
    name: 'coptic-gospel-leaf',
    author: 'Unknown author',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Page_from_Coptic_manuscript_of_the_%27Pauline_Epistles_%26_Gospel_of_John%27_(CBL_Cpt_813,_f.3r).jpg',
  },
  {
    name: 'hanging-church',
    author: 'Radosław Botev',
    license: 'CC BY 3.0 pl',
    page: 'https://commons.wikimedia.org/wiki/File:Hanging_Church_Cairo_interior_(1).jpg',
  },
  {
    name: 'coptic-baptism',
    author: 'Beshoy Makram Zaki',
    license: 'CC BY-SA 4.0',
    page: 'https://commons.wikimedia.org/wiki/File:Babtism_of_coptic_Egyptian_orthodox.jpg',
  },
  {
    name: 'st-mark-preaching',
    author: 'Gentile Bellini / Giovanni Bellini',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Milan_pinacoth%C3%A8que_Bramante_Sermon_of_St_Mark_in_Alexandria._(bis).jpg',
  },
];
