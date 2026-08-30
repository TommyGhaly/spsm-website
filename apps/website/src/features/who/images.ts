/**
 * The seven pictures on /about/who-we-are, and where each one came from.
 *
 * The originals live in `assets/who/` beside a `credits.json` written by the
 * Commons API, and `scripts/optimize-assets.mjs` turns each into a 640px and a
 * 1280px WebP under `public/img/who/`.
 *
 * **Every one is public domain, CC0 or "no restrictions", and that is a
 * constraint rather than a coincidence.** This page shows no credits list, so a
 * CC BY or CC BY-SA picture on it would be an attribution we are not making.
 * The fetch that filled `assets/who/` refuses any other licence, and the two
 * strongest candidates it turned away — a photograph of the Abbassia cathedral
 * and one of the first Coptic church in America, in Jersey City — are recorded
 * in the optimiser's notes, because if a credits list ever goes back on the
 * page they are worth going back for.
 *
 * `WHO_CREDITS` below is still complete, and `parts.tsx` still renders it. See
 * the note there for why a hidden list is worth keeping.
 *
 * **`width` is the real width of the large file, not 1280.** The optimiser
 * resizes `withoutEnlargement`, so the 1,015px portrait of Pope Kyrillos stays
 * 1,015px; a srcset descriptor claiming 1280w for it would make the browser
 * pick it on screens where it is no larger than the small one. The numbers
 * below are read off the emitted files.
 *
 * `alt` describes the picture to somebody who cannot see it. `caption` says
 * what it is and why it is here, and is read by everybody — different jobs,
 * and neither is a copy of the other.
 */

export type WhoPicture = {
  /** A few words naming the work, for the credits list. */
  short: string;
  alt: string;
  caption: string;
  /** Intrinsic size of the 1280 file, so nothing reflows when it lands. */
  width: number;
  height: number;
};

export const WHO_PICTURES = {
  'coptic-family': {
    short: 'A Coptic family, nineteenth century',
    alt: 'A hand-coloured print of five people — an old bearded man seated with a staff, two women, a girl and a small child — posed together in Egyptian dress.',
    caption:
      'A Coptic family, from a European illustrated book of the late nineteenth century. The pyramids behind them are painted in; the framing is the publisher’s, not theirs. For most of the Church’s history this is the only sort of picture of ordinary Copts that outsiders made.',
    width: 1280,
    height: 1739,
  },
  'desert-monastery': {
    short: 'The Monastery of St. Antony',
    alt: 'A walled monastery of pale stone with a bell tower and cross, set among date palms below a long red desert cliff.',
    caption:
      'The Monastery of St. Antony, under the cliffs of the Eastern Desert. Monks have lived on this site since the fourth century, and every monastery in the world descends from what began here.',
    width: 1280,
    height: 960,
  },
  'coptic-houses-cairo': {
    short: 'Coptic houses, Cairo',
    alt: 'An albumen photograph of a Cairo street: tall stone houses with tiers of latticed wooden bay windows overhanging an empty dirt square.',
    caption:
      'Coptic houses in Cairo, photographed in the nineteenth century. The latticed upper storeys are mashrabiya — the same building language as the Muslim city around them, which is the point.',
    width: 1280,
    height: 970,
  },
  'coptic-monks': {
    short: 'Coptic monks',
    alt: 'A black-and-white photograph of eight Coptic monks in black robes and turbans, one seated at the centre holding an icon, the rest standing around him against a stone wall.',
    caption:
      'Coptic monks, photographed early in the twentieth century. The habit is unchanged; so is the practice of putting the eldest in the chair and everyone else around him.',
    width: 1280,
    height: 995,
  },
  'pope-kyrillos': {
    short: 'Pope Kyrillos VI',
    alt: 'A portrait of Pope Kyrillos VI in a dark embroidered vestment and domed headdress, holding a pastoral staff.',
    caption:
      'Pope Kyrillos VI, 116th Pope of Alexandria from 1959 to 1971. He is the one who started sending priests after the emigrants — including the first two to America.',
    width: 1015,
    height: 1549,
  },
  'pope-shenouda': {
    short: 'Pope Shenouda III',
    alt: 'A close portrait of Pope Shenouda III, white-bearded, in a domed black headdress and gold-embroidered vestment, looking past the camera.',
    caption:
      'Pope Shenouda III, who led the Church for forty years and under whom nearly every Coptic church in North America was founded. He first came to the United States in 1977 and stayed two months.',
    width: 1280,
    height: 1920,
  },
  'queens-church': {
    short: 'SS. Mary and Antonius, Ridgewood, Queens',
    alt: 'A grey neoclassical church with fluted columns and a bell tower, a Coptic cross standing on top of it, seen from the street corner against a clear sky.',
    caption:
      'SS. Mary and Antonius in Ridgewood, Queens — an American church of another century, with a Coptic cross on the tower. Nearly every Coptic church in the north-east began in a building somebody else built and could no longer fill.',
    width: 1280,
    height: 1707,
  },
} as const satisfies Record<string, WhoPicture>;

export type WhoPictureName = keyof typeof WHO_PICTURES;

/** The small file. 640px is a full-width plate on a retina phone. */
export function whoSmall(name: WhoPictureName): string {
  return `/img/who/${name}-640.webp`;
}

/** The large file. Its real width is `WHO_PICTURES[name].width`. */
export function whoLarge(name: WhoPictureName): string {
  return `/img/who/${name}-1280.webp`;
}

/**
 * Where every picture on this page came from, and under what licence.
 *
 * Generated from `assets/who/credits.json`, which the Commons API wrote — not
 * typed out here — so the author and licence beside a picture are the ones
 * Commons holds rather than the ones somebody remembered.
 *
 * Nothing in this list legally obliges us, which is the whole reason the set
 * was chosen the way it was. It is kept, and rendered hidden, because "which
 * file is this and where did it come from" is a question somebody will ask
 * about a picture on a church website, and the answer should be in the page
 * rather than in a developer's memory.
 */
export type WhoCredit = {
  name: WhoPictureName;
  author: string;
  license: string;
  /** The permanent Commons description page. */
  page: string;
};

export const WHO_CREDITS: readonly WhoCredit[] = [
  {
    name: 'coptic-family',
    author: 'Unidentified',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Famille_Copte.jpg',
  },
  {
    name: 'desert-monastery',
    author: 'Tentoila',
    license: 'Public domain',
    page: "https://commons.wikimedia.org/wiki/File:St._Anthony%27s_Monastery_2006.jpg",
  },
  {
    name: 'coptic-houses-cairo',
    author: 'Cornell University Library',
    license: 'No known restrictions',
    page: 'https://commons.wikimedia.org/wiki/File:Coptic_Houses,_Cairo.jpg',
  },
  {
    name: 'coptic-monks',
    author: 'American Colony (Jerusalem), Photo Department',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Coptic_monks.jpg',
  },
  {
    name: 'pope-kyrillos',
    author: 'Raafat',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Pope_Cyril_VI_of.jpg',
  },
  {
    name: 'pope-shenouda',
    author: 'Chuck Kennedy, White House Photostream',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Pope_Shenouda_III_of_Alexandria_by_Chuck_Kennedy_(Official_White_House_Photostream).jpg',
  },
  {
    name: 'queens-church',
    author: 'Jim Henderson',
    license: 'CC0',
    page: 'https://commons.wikimedia.org/wiki/File:Mary_%26_Antonionus_Coptic_Ch_606_Woodward_Av_Ridgewood_NY_11385_jeh.jpg',
  },
];
