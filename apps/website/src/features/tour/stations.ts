/**
 * The six stations of the festival tour, as data.
 *
 * ---------------------------------------------------------------------------
 * Everything here is a literal, not a Firestore read, and that is deliberate.
 * The tour is walked by visitors holding phones on parish wifi in a crowded
 * hall: the page has to be HTML on disk that renders with no network round
 * trip, because the first thing a festival does to a building is saturate its
 * wifi. Nothing on this page waits on a read, and nothing on it can be emptied
 * by one failing. (The same reasoning as `NAV` in `app/layout.tsx`, for the
 * same reason — a bad read must not be able to empty the thing a visitor is
 * standing in front of.)
 *
 * The prose lives next door in `content.tsx`, as JSX, because it is heavily
 * structured — tables, definition lists, and interactive panels interleaved
 * with paragraphs — and a block DSL rich enough to express it would be a small
 * CMS nobody asked for. What lives *here* is the part that a non-developer has
 * a reason to change: the station list, and the photographs.
 * ---------------------------------------------------------------------------
 */

/**
 * One photograph in a station's gallery.
 *
 * `slug` names a pair of files the asset pipeline emits — `-640.webp` for the
 * grid tile and `-1280.webp` for the lightbox — so a replacement photograph is
 * a new original in `assets/tour/` and a re-run of `npm run assets`, with no
 * change to any component. See the tour block in `scripts/optimize-assets.mjs`.
 *
 * `alt` describes the picture for someone who cannot see it and is *not* the
 * caption; `caption` is the line printed under the tile, and says what the
 * picture is showing the reader about the station. Both, always: a caption
 * doubling as alt text reads as a non-sequitur to a screen reader, and alt
 * text doubling as a caption states the obvious to everyone else.
 */
export type TourImage = {
  slug: string;
  alt: string;
  caption: string;
};

export type TourStation = {
  /** The URL fragment. `/about/welcome-newcomers#station-3` is a station
   *  leader's QR code, so these are part of the parish's printed material and
   *  must not be renamed once the codes are printed. */
  id: string;
  /** 1–6. Printed on the passport stamp and on the station's eyebrow. */
  number: number;
  title: string;
  /** The "what you'll see here" line from the tour notes — one sentence, shown
   *  under the title and used as the station's summary in the jump bar. */
  lede: string;
  /** Two to four pictures. More than four stops being a gallery and starts
   *  being a scroll obstacle between the reader and the words. */
  images: TourImage[];
};

export const TOUR_STATIONS: readonly TourStation[] = [
  {
    id: 'station-1',
    number: 1,
    title: 'Origins of the Coptic Orthodox Church',
    lede: 'Where the word "Coptic" comes from, the calendar the Church still keeps, and the language it prayed in for a thousand years.',
    images: [
      {
        slug: 'st-mark-evangelist',
        alt: 'An engraving of St. Mark seated with a book, a winged lion beside him.',
        caption: 'St. Mark the Evangelist, who founded the Church in Alexandria around 43 A.D.',
      },
      {
        slug: 'st-athanasius',
        alt: 'A painted icon of St. Athanasius in bishop’s vestments, holding a book.',
        caption: 'St. Athanasius, 20th Pope of Alexandria, called "the Father of Orthodoxy".',
      },
      {
        slug: 'coptic-manuscript',
        alt: 'Two leaves of a manuscript written in Coptic letters, worn at the edges.',
        caption: 'Coptic script — the Egyptian language written in Greek letters, plus seven of its own.',
      },
      {
        slug: 'sothis-star-chart',
        alt: 'A drawing from an Egyptian tomb ceiling showing figures standing in boats among stars.',
        caption: 'Sothis — the star we call Sirius — among the constellations the Egyptian calendar was set by.',
      },
    ],
  },
  {
    id: 'station-2',
    number: 2,
    title: 'Icons & Architecture',
    lede: 'Why the faces in an icon do not look like photographs, and what the wooden screen across the front of the church is for.',
    images: [
      {
        slug: 'iconostasis',
        alt: 'The carved wooden icon screen of a Coptic church, with the altar visible through its central arch.',
        caption: 'The iconostasis — the barrier between the nave and the sanctuary, and the icons that bridge it.',
      },
      {
        slug: 'icon-archangel',
        alt: 'A Coptic icon of the Archangel Michael holding a scale, with large eyes and a flat gold ground.',
        caption: 'Large eyes, flat ground, no shadow. An icon is drawn as a diagram, not a likeness.',
      },
      {
        slug: 'st-mark-lion',
        alt: 'An illuminated manuscript page of St. Mark writing, with a winged lion at his feet.',
        caption: 'The lion, which is St. Mark’s: his Gospel opens with a voice roaring in the desert.',
      },
      {
        slug: 'shroud-of-turin',
        alt: 'The photographic negative of the Shroud of Turin, showing the faint front and back of a man.',
        caption: 'The Shroud of Turin, one of the images tradition holds was not made by human hands.',
      },
    ],
  },
  {
    id: 'station-3',
    number: 3,
    title: 'Ranks in the Church, and What They Wear',
    lede: 'Every garment worn at the altar means something. Here is what each one is and who wears it.',
    images: [
      {
        slug: 'deacons-in-tunics',
        alt: 'Rows of deacons seated in white tunics with red embroidered stoles over the left shoulder.',
        caption: 'Deacons in the white tunic, each with the red badrashil over the left shoulder.',
      },
      {
        slug: 'bishops-emma',
        alt: 'Two bishops in embroidered white copes and tall embroidered hats, incense smoke in the air.',
        caption: 'The em’ma — the hat, once a cap with a turban wound round it — worn by bishops and priests.',
      },
      {
        slug: 'coptic-tunic',
        alt: 'An ancient linen tunic with woven decorative panels, laid flat.',
        caption: 'A Coptic tunic from late antiquity. The shape of the tonia has changed very little.',
      },
      {
        slug: 'tunic-embroidery',
        alt: 'A fragment of woven Coptic textile with a geometric figured panel in dark thread.',
        caption: 'Woven tunic decoration, 5th–6th century — the ancestor of the embroidered strip worn today.',
      },
    ],
  },
  {
    id: 'station-4',
    number: 4,
    title: 'Cymbals, Triangle & the Midnight Praises',
    lede: 'The two instruments the Coptic Church plays, how they are held, and the all-night service they belong to.',
    images: [
      {
        slug: 'sagat-engraving',
        alt: 'An 1836 engraving of Egyptian hand cymbals and a frame drum, drawn in outline.',
        caption: 'Egyptian hand cymbals, drawn in 1836 — a pair of concave disks joined by a cord.',
      },
      {
        slug: 'hand-cymbals',
        alt: 'A hand holding a pair of small brass cymbals joined by elastic loops.',
        caption: 'How a pair is held. The cymbals used in church are larger — five to seven inches across.',
      },
      {
        slug: 'triangle',
        alt: 'A plain iron triangle with the two ends curled into spirals, photographed against a light ground.',
        caption: 'The triangle, which the Book of Samuel already knew.',
      },
      {
        slug: 'liturgical-codex',
        alt: 'An illustrated page from a Coptic liturgical manuscript, with decorated initials.',
        caption: 'A Coptic liturgical book — the words the cymbals keep time to.',
      },
    ],
  },
  {
    id: 'station-5',
    number: 5,
    title: 'The Ney, and the Oldest Music in Egypt',
    lede: 'A reed flute that has been played without a break for something like five thousand years.',
    images: [
      {
        slug: 'ney',
        alt: 'A long reed flute with six finger holes, laid vertically against a plain ground.',
        caption: 'A ney — a length of reed, six holes in front and one behind, and nothing else.',
      },
      {
        slug: 'ney-player',
        alt: 'A musician holding a ney at an angle to the mouth, playing.',
        caption: 'Blown across the rim rather than into a mouthpiece, which is why it takes so long to learn.',
      },
      {
        slug: 'egyptian-musicians',
        alt: 'An ancient Egyptian tomb painting of seated women playing a double flute and other instruments.',
        caption: 'Musicians painted on the wall of an Egyptian tomb, roughly 3,400 years ago.',
      },
      {
        slug: 'oud',
        alt: 'A pear-shaped stringed instrument with a bent-back neck and a decorated soundhole.',
        caption: 'The oud, from Cairo — the ney’s usual companion.',
      },
    ],
  },
  {
    id: 'station-6',
    number: 6,
    title: 'The Liturgy, the Sacraments & What Is on the Altar',
    lede: 'What each object on the altar is for, the seven sacraments, and why the whole service is told as a wedding.',
    images: [
      {
        slug: 'censer',
        alt: 'A priest in a white cope seen from behind, swinging a censer, smoke rising toward the altar.',
        caption: 'The censer: three chains for the Trinity, and the coal inside it for the womb that carried Christ.',
      },
      {
        slug: 'altar-ark',
        alt: 'A Coptic altar under a painted apse, with a small decorated wooden box standing on it.',
        caption: 'The Ark — the box at the centre of the altar that the chalice stands in.',
      },
      {
        slug: 'veil-of-veronica',
        alt: 'A painting of a white cloth pinned flat, the faint face of Christ visible on it.',
        caption: 'The Veil of Veronica, pressed to Christ’s face on the way to the cross.',
      },
    ],
  },
];

/**
 * Where every photograph on this page came from, and under what licence.
 *
 * ---------------------------------------------------------------------------
 * This is generated from `assets/tour/credits.json`, which is written by the
 * download script straight from the Wikimedia Commons API rather than typed by
 * hand — so the author and licence attached to a picture here are the ones the
 * uploader actually asserted, not a developer's recollection of them.
 *
 * It is rendered at the foot of the page, `visually-hidden` since Tommy asked
 * for the credits off the page — see the note at the call site in
 * `TourScreen`. Hidden, not deleted: seven of these twenty-four are CC BY or
 * CC BY-SA, which oblige the church to name the author and the licence
 * wherever the picture is published. The other seventeen are CC0 or public
 * domain and oblige nothing, and they are listed anyway: a credits list that
 * silently drops the entries that do not *require* crediting teaches the next
 * person that the list is optional.
 *
 * Nothing NC and nothing ND was taken, so the church is free to reprint any of
 * these on a poster or a bulletin without asking anybody.
 * ---------------------------------------------------------------------------
 */
export type TourCredit = {
  slug: string;
  /**
   * A few words naming the picture, for a credits list.
   *
   * The list on /about prints this. It exists because the slug does not read as
   * a title once a human is looking at it — "sothis-star-chart" prettifies to
   * something nobody wrote on purpose — and because `SAINT_CREDITS` and the
   * two `short` fields on the belief and who-we-are pictures already carry the
   * same thing under different names. Four sets, one shape, one list.
   */
  what: string;
  author: string;
  license: string;
  /** The permanent Commons description page — the licence's required link. */
  page: string;
};

export const TOUR_CREDITS: readonly TourCredit[] = [
  {
    slug: 'altar-ark',
    what: 'The Ark on a Coptic altar',
    author: 'That Coptic Guy',
    license: 'CC BY-SA 4.0',
    page: 'https://commons.wikimedia.org/wiki/File:Coptic_Church_altar.jpg',
  },
  {
    slug: 'bishops-emma',
    what: 'A bishop in the em’ma',
    author: 'Andre Forget - Andrew Scheer',
    license: 'CC0',
    page: 'https://commons.wikimedia.org/wiki/File:Church_of_the_Virgin_Mary_and_Saint_Athanasius_in_Mississauga_(32807384017).jpg',
  },
  {
    slug: 'censer',
    what: 'A censer, alight',
    author: 'Fadyashrafmahfouz',
    license: 'CC0',
    page: 'https://commons.wikimedia.org/wiki/File:Sacred_Incense.jpg',
  },
  {
    slug: 'coptic-manuscript',
    what: 'Leaves from a Coptic manuscript',
    author: 'Unknown',
    license: 'CC0',
    page: 'https://commons.wikimedia.org/wiki/File:Leaves_from_a_Coptic_Manuscript_MET_sf21-148-1as2.jpg',
  },
  {
    slug: 'coptic-tunic',
    what: 'A Coptic tunic, late antiquity',
    author: 'Coptic Byzantine',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Coptic_-_Tunic_-_Walters_83484.jpg',
  },
  {
    slug: 'deacons-in-tunics',
    what: 'Deacons in the white tunic',
    author: 'Andre Forget - Andrew Scheer',
    license: 'CC0',
    page: 'https://commons.wikimedia.org/wiki/File:Church_of_the_Virgin_Mary_and_Saint_Athanasius_in_Mississauga_(33873841828).jpg',
  },
  {
    slug: 'egyptian-musicians',
    what: 'Musicians in the tomb of Nakht',
    author: 'Maler der Grabkammer des Nacht',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Maler_der_Grabkammer_des_Nacht_001.jpg',
  },
  {
    slug: 'hand-cymbals',
    what: 'Finger cymbals, and how a pair is held',
    author: 'Gudzwabofer',
    license: 'CC BY-SA 4.0',
    page: 'https://commons.wikimedia.org/wiki/File:Finger_cymbals.jpg',
  },
  {
    slug: 'icon-archangel',
    what: 'Coptic icon of the Archangel Michael',
    author: 'Unknown',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Coptic_Icon_of_the_Archangel_Michael.jpg',
  },
  {
    slug: 'iconostasis',
    what: 'A Coptic iconostasis',
    author: 'That Coptic Guy',
    license: 'CC BY-SA 4.0',
    page: 'https://commons.wikimedia.org/wiki/File:Coptic_Church_Iconostasis_and_Setup.jpg',
  },
  {
    slug: 'liturgical-codex',
    what: 'A Coptic liturgical codex',
    author: 'Unknown',
    license: 'CC0',
    page: 'https://commons.wikimedia.org/wiki/File:Coptic_Liturgical_Codex_MET_DP100664.jpg',
  },
  {
    slug: 'ney',
    what: 'A ney',
    author: 'Zimbricchio',
    license: 'CC BY-SA 4.0',
    page: 'https://commons.wikimedia.org/wiki/File:Persian_ney_with_6_holes.jpg',
  },
  {
    slug: 'ney-player',
    what: 'A ney player',
    author: 'Michael Coghlan from Adelaide, Australia',
    license: 'CC BY-SA 2.0',
    page: 'https://commons.wikimedia.org/wiki/File:Ney_(Flute)_Player_(13305680305).jpg',
  },
  {
    slug: 'oud',
    what: 'An oud, from Cairo',
    author: 'Frank Kovalchek from Anchorage, Alaska, USA',
    license: 'CC BY 2.0',
    page: 'https://commons.wikimedia.org/wiki/File:Oud_(plucked_lute),_Cairo,_Egypt,_2009_-_MIM_PHX.jpg',
  },
  {
    slug: 'pharos-alexandria',
    what: 'The Pharos of Alexandria, engraved 1572',
    author: 'Philip Galle',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Philip_Galle_-_Lighthouse_of_Alexandria_(Pharos_of_Alexandria)_-_1572.jpg',
  },
  {
    slug: 'sagat-engraving',
    what: 'Sagat and tar, engraved 1836',
    author: 'Edward William Lane (1801–1876), via TIMEA; derivative work by Clusternote',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Sa%27ga%27t_(1),_Ta%27r_(2)._(1836)_-_TIMEA_(clip,_rotate,_%26_whiten).jpg',
  },
  {
    slug: 'shroud-of-turin',
    what: 'The Shroud of Turin, in negative',
    author: 'Unknown',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Full_length_negatives_of_the_shroud_of_Turin.jpg',
  },
  {
    slug: 'sothis-star-chart',
    what: 'Orion and Sothis in their barks',
    author: 'Original \u2014 unknown (ancient egyptians), drawing \u2014 Lef\u00e9bure?',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Orion,_Sothis,_and_two_Horus-planets_standing_in_their_barks.jpg',
  },
  {
    slug: 'st-athanasius',
    what: 'Icon of St. Athanasius',
    author: 'Unknown',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Saint-Athanasius-of-Alexandria-icon-Sozopol-Bulgaria-17century.jpg',
  },
  {
    slug: 'st-mark-evangelist',
    what: 'St. Mark, from The Four Evangelists',
    author: 'Heinrich Aldegrever / Georg Pencz',
    license: 'CC0',
    page: 'https://commons.wikimedia.org/wiki/File:Saint_Mark,_from_The_Four_Evangelists_MET_DP836697.jpg',
  },
  {
    slug: 'st-mark-lion',
    what: 'St. Mark and his lion, Grandes Heures',
    author: 'Jean Bourdichon',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Grandes_Heures_Anne_de_Bretagne_Saint_Marc.jpg',
  },
  {
    slug: 'triangle',
    what: 'A triangle',
    author: 'Unknown',
    license: 'CC0',
    page: 'https://commons.wikimedia.org/wiki/File:Triangle_MET_204948.jpg',
  },
  {
    slug: 'tunic-embroidery',
    what: 'Coptic tunic embroidery, 5th–6th century',
    author: 'Giorgi1975',
    license: 'CC BY-SA 4.0',
    page: 'https://commons.wikimedia.org/wiki/File:Fragment_of_coptic_textile._Tunic_decoration._V-VI_cc.jpg',
  },
  {
    slug: 'veil-of-veronica',
    what: 'The Veil of Veronica, Zurbarán',
    author: 'Francisco de Zurbar\u00e1n',
    license: 'Public domain',
    page: 'https://commons.wikimedia.org/wiki/File:Francisco_de_Zurbar%C3%A1n_-_Veil_of_Veronica_-_BF.1980.9_-_Museum_of_Fine_Arts.jpg',
  },
];

/** The tile a station's gallery shows. */
export function tourThumb(slug: string): string {
  return `/img/tour/${slug}-640.webp`;
}

/** The full-size copy the lightbox opens. */
export function tourFull(slug: string): string {
  return `/img/tour/${slug}-1280.webp`;
}
