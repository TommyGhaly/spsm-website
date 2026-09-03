import { ARTICLES } from '@/features/belief/articles';
import { CREED } from '@/features/belief/creed';
import { BY_USE, PROGRESS, TEAM } from '@/features/future/plan';
import { MERCURIUS_FEASTS, MINA_FEASTS, type Feast } from '@/features/saints/saints';
import { TOUR_STATIONS } from '@/features/tour/stations';
import { EGYPT, NEW_ENGLAND } from '@/features/who/chronologies';
import { ROSTER } from '@/features/who/clergy';
import type { AboutSlug } from '@spsm/shared';

/**
 * Every part of the five About pages staff may rewrite, and nothing else.
 *
 * ---------------------------------------------------------------------------
 * ## This file is the whole of the permission
 *
 * `firestore.rules` says who may write `aboutOverrides`. This says *what* there
 * is to write. A key not declared here has no `<Editable>` wrapped round it, so
 * the panel does not offer it, the page never reads it, and a key typed into
 * the console by hand changes nothing at all.
 *
 * That is deliberate, and it is what makes an overlay safe on pages like these.
 * The Creed is not editable prose — it is a settled text of the whole Church,
 * rendered from `creed.ts` in stanzas with `lang` attributes on the Greek. A
 * feast date is computed. The tour's passport is a state machine. The
 * flythrough's captions are a VTT file. None of them appear below, so none of
 * them can be reached by an editor, and nobody has to remember not to.
 *
 * ## What is offered instead
 *
 * Per band: its heading, its opening prose, and its photograph where it has a
 * single obvious one. That is the honest answer to what staff actually want —
 * a wrong date, a paragraph that reads badly, a photograph that should be the
 * parish's own — without pretending a volunteer should be re-laying out a
 * fifteen-band page.
 *
 * ## Adding one
 *
 * Two edits, and they have to be the same change: a row here, and an
 * `<Editable page slot>` round the JSX it names. A row with no wrap is a
 * control that saves and changes nothing on the page, which is precisely the
 * failure the deleted /access rows were deleted for — see
 * `features/access/areas.ts`.
 *
 * Band ids are the ones already on the page: every `<section>` on these five
 * carries `aria-labelledby` pointing at its own `h2`, so the ids exist, are
 * stable, and are what a link into the page already uses. Slot keys are
 * `<bandId>.<part>`.
 * ---------------------------------------------------------------------------
 */

export type AboutSlotKind = 'heading' | 'prose' | 'picture';

export interface AboutSlotSpec {
  /** The key in `AboutOverride.slots`. `<bandId>.<part>`. */
  id: string;
  kind: AboutSlotKind;
  /** What the panel calls it. */
  label: string;
}

export interface AboutBand {
  /** The section's own id — its `aria-labelledby` target, or the section id. */
  id: string;
  /** What the panel calls this band. Usually its heading as written. */
  label: string;
  slots: readonly AboutSlotSpec[];
}

function heading(band: string, label = 'Heading'): AboutSlotSpec {
  return { id: `${band}.h2`, kind: 'heading', label };
}
function prose(band: string, label = 'Opening words'): AboutSlotSpec {
  return { id: `${band}.body`, kind: 'prose', label };
}
function picture(band: string, label = 'Photograph'): AboutSlotSpec {
  return { id: `${band}.picture`, kind: 'picture', label };
}
function lede(band: string, label = 'Standfirst'): AboutSlotSpec {
  return { id: `${band}.lede`, kind: 'prose', label };
}
/**
 * `SectionHeading`'s third line.
 *
 * Only on the bands that use that component — the patron saints page, which is
 * built out of it. Elsewhere the same job is done by a `.lede` paragraph, and
 * the two are deliberately different keys because they are different elements.
 */
function note(band: string, label = 'Line under the heading'): AboutSlotSpec {
  return { id: `${band}.note`, kind: 'heading', label };
}

/**
 * The hero of every one of the five, which is the same three lines each time:
 * an eyebrow, a title that is a `p` rather than an `h2`, and a lede. Shared
 * because it is genuinely the same band five times, and because the title being
 * a `p` is a rule about the document outline that a copy-paste would eventually
 * break.
 */
function hero(id: string): AboutBand {
  return {
    id,
    label: 'The opening band',
    slots: [
      { id: `${id}.eyebrow`, kind: 'heading', label: 'Eyebrow' },
      { id: `${id}.title`, kind: 'heading', label: 'Title' },
      lede(id, 'Opening lines'),
    ],
  };
}

/**
 * The rows of every table on the five pages.
 *
 * ---------------------------------------------------------------------------
 * Tommy: *"try to get all the text on each page not skipping anything if you
 * can."* These are what "everything" turned out to mean — most of the words on
 * these pages are not in prose blocks at all, they are rows of data rendered by
 * a `.map()`: nineteen centuries of dated spine, the Creed line by line, the
 * feast days, the area schedule, the nine firms, the six clergy.
 *
 * **Derived from the same arrays the pages render**, never written out by hand.
 * That is the whole reason this is code and not a list: the slot for a row is
 * its index, so the manifest and the page cannot disagree about how many rows
 * there are, and adding a moment to `EGYPT` makes it editable without anyone
 * touching this file. `tests/unit/aboutSlots.test.ts` proves the two agree.
 *
 * The labels lead with the row's own text, truncated, because in a column of
 * twenty boxes "1968 — a generation of Coptic engineers…" is the only thing
 * that tells you which one you are in.
 * ---------------------------------------------------------------------------
 */
function short(text: string, max = 42): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** A term-and-detail row: a dated spine, a feast, a line of the area schedule. */
function pairRows(
  prefix: string,
  rows: readonly { term: string; detail: string }[],
  parts: [string, string],
): AboutSlotSpec[] {
  return rows.flatMap((row, index) => [
    {
      id: `${prefix}-${index}-${parts[0]}`,
      kind: 'heading' as const,
      label: `${short(row.term, 24)} — the ${parts[0]}`,
    },
    {
      id: `${prefix}-${index}-${parts[1]}`,
      kind: 'prose' as const,
      label: `${short(row.term, 24)} — what it says`,
    },
  ]);
}

const CHRON_EGYPT = pairRows(
  'in-egypt.moment',
  EGYPT.map((m) => ({ term: m.when, detail: m.what })),
  ['term', 'detail'],
);
const CHRON_NEW_ENGLAND = pairRows(
  'in-new-england.moment',
  NEW_ENGLAND.map((m) => ({ term: m.when, detail: m.what })),
  ['term', 'detail'],
);

/** The Creed, one slot per line — see the note at its call site. */
const CREED_LINES: AboutSlotSpec[] = CREED.flatMap((stanza, index) =>
  stanza.lines.map((line, at) => ({
    id: `the-creed.stanza-${index}-line-${at}`,
    kind: 'heading' as const,
    label: `Creed · ${short(line, 34)}`,
  })),
);

/** The line-by-line articles: the quoted line, the heading, the body, the plate. */
const CREED_ARTICLES: AboutSlotSpec[] = ARTICLES.flatMap((article) => {
  const rows: AboutSlotSpec[] = [
    {
      id: `line-by-line.art-${article.id}-line`,
      kind: 'heading',
      label: `${short(article.heading, 26)} — the Creed’s line`,
    },
    {
      id: `line-by-line.art-${article.id}-heading`,
      kind: 'heading',
      label: `${short(article.heading, 26)} — heading`,
    },
    {
      id: `line-by-line.art-${article.id}-body`,
      kind: 'prose',
      label: `${short(article.heading, 26)} — words`,
    },
  ];
  if (article.picture) {
    rows.push({
      id: `line-by-line.art-${article.id}-caption`,
      kind: 'prose',
      label: `${short(article.heading, 26)} — caption`,
    });
  }
  return rows;
});

function feastRows(prefix: string, feasts: readonly Feast[]): AboutSlotSpec[] {
  return [
    { id: `${prefix}-label`, kind: 'heading', label: 'The label above the days' },
    ...feasts.flatMap((feast, index) => [
      {
        id: `${prefix}-${index}-coptic`,
        kind: 'heading' as const,
        label: `${short(feast.coptic, 22)} — Coptic date`,
      },
      {
        id: `${prefix}-${index}-gregorian`,
        kind: 'heading' as const,
        label: `${short(feast.coptic, 22)} — Gregorian date`,
      },
      {
        id: `${prefix}-${index}-what`,
        kind: 'prose' as const,
        label: `${short(feast.coptic, 22)} — what falls on it`,
      },
    ]),
  ];
}

/** The area schedule's names and notes. The *figures* are not offered. */
const BY_USE_ROWS: AboutSlotSpec[] = BY_USE.flatMap((row, index) => [
  { id: `all-of-it.use-${index}-name`, kind: 'heading' as const, label: `${short(row.use, 26)} — name` },
  { id: `all-of-it.use-${index}-of`, kind: 'prose' as const, label: `${short(row.use, 26)} — note` },
]);

const PROGRESS_ROWS = pairRows(
  'where-it-stands.step',
  PROGRESS.map((m) => ({ term: m.when, detail: m.what })),
  ['when', 'what'],
);

const TEAM_ROWS: AboutSlotSpec[] = TEAM.flatMap((member) => {
  const rows: AboutSlotSpec[] = [
    {
      id: `who-is-drawing-it.firm-${member.slug}-role`,
      kind: 'heading',
      label: `${short(member.firm, 24)} — what they do`,
    },
    {
      id: `who-is-drawing-it.firm-${member.slug}-name`,
      kind: 'heading',
      label: `${short(member.firm, 24)} — the firm’s name`,
    },
  ];
  if (member.town) {
    rows.push({
      id: `who-is-drawing-it.firm-${member.slug}-town`,
      kind: 'heading',
      label: `${short(member.firm, 24)} — town`,
    });
  }
  return rows;
});

const CLERGY_ROWS: AboutSlotSpec[] = ROSTER.flatMap((cleric) => [
  {
    id: `the-clergy-here.cleric-${cleric.slug}-name`,
    kind: 'heading' as const,
    label: `${short(cleric.name, 26)} — name`,
  },
  {
    id: `the-clergy-here.cleric-${cleric.slug}-rank`,
    kind: 'heading' as const,
    label: `${short(cleric.name, 26)} — rank`,
  },
  {
    id: `the-clergy-here.cleric-${cleric.slug}-note`,
    kind: 'prose' as const,
    label: `${short(cleric.name, 26)} — what is said`,
  },
]);

const WHO_BANDS: readonly AboutBand[] = [
  hero('who-hero'),
  {
    id: 'what-copt-means',
    label: 'A word that means Egyptian',
    slots: [heading('what-copt-means'), prose('what-copt-means'), picture('what-copt-means')],
  },
  {
    id: 'in-egypt',
    label: 'The Church in Egypt',
    slots: [
      { id: 'in-egypt.eyebrow', kind: 'heading', label: 'Eyebrow' },
      heading('in-egypt'),
      lede('in-egypt'),
      // The nineteen-century spine, one slot per row. It used to say here that
      // a markdown box was the wrong shape for twenty dated rows and that
      // correcting a date was a deploy — true of one box, and the answer was a
      // slot per row rather than a refusal.
      ...CHRON_EGYPT,
    ],
  },
  {
    id: 'a-minority-at-home',
    label: 'A minority at home',
    slots: [heading('a-minority-at-home'), prose('a-minority-at-home'), picture('a-minority-at-home')],
  },
  {
    id: 'the-crossing',
    label: 'The crossing',
    slots: [heading('the-crossing'), prose('the-crossing'), picture('the-crossing')],
  },
  {
    id: 'in-new-england',
    label: 'New England',
    slots: [
      { id: 'in-new-england.eyebrow', kind: 'heading', label: 'Eyebrow' },
      heading('in-new-england'),
      lede('in-new-england'),
      ...CHRON_NEW_ENGLAND,
    ],
  },
  {
    id: 'this-church',
    label: 'This church',
    slots: [heading('this-church'), prose('this-church')],
    // The sanctuary photograph is the homepage's hero file, shared on purpose
    // so there is one answer to what this room looks like. Not offered here for
    // that reason — see `Sanctuary` in `features/who/parts.tsx`.
  },
  {
    id: 'the-clergy-here',
    label: 'The clergy',
    slots: [
      { id: 'the-clergy-here.eyebrow', kind: 'heading', label: 'Eyebrow' },
      heading('the-clergy-here'),
      lede('the-clergy-here'),
      ...CLERGY_ROWS,
    ],
    // The portraits are still files on disk, so a priest *arriving* is a deploy
    // — `npm run assets` has to run over the photograph. Their names, ranks and
    // notes are editable; see the note at the call site about the initial and
    // the homepage both reading the coded name.
  },
];

const BELIEF_BANDS: readonly AboutBand[] = [
  hero('belief-hero'),
  {
    id: 'the-faith',
    label: 'As the Church prays, so it believes',
    slots: [prose('the-faith'), picture('the-faith')],
    // The heading is two spans with `lang="la"` on the Latin and a gloss line
    // under it. Overriding it with one string would either lose the gloss or
    // lose the language attribute, and both matter — a screen reader changes
    // voice on the first.
  },
  {
    id: 'the-creed',
    label: 'The Nicene Creed',
    slots: [
      { id: 'the-creed.eyebrow', kind: 'heading', label: 'Eyebrow' },
      heading('the-creed'),
      lede('the-creed'),
      // The commentary beside the Creed on the two deliberate choices of
      // English. Editable; the Creed it comments on is not.
      { id: 'the-creed.note', kind: 'prose', label: 'The note beside it' },
    ],
    // The Creed is `creed.ts`. Not editable, and this is the clearest case in
    // the file: it is the text of the whole Church, said aloud at every
    // Liturgy, and a typo introduced here would be said aloud with it.
  },
  {
    id: 'the-councils',
    label: 'Three councils, and one word',
    slots: [heading('the-councils'), prose('the-councils')],
  },
  {
    id: 'line-by-line',
    label: 'The Creed, line by line',
    slots: [
      heading('line-by-line'),
      lede('line-by-line'),
      // Each article's quoted Creed line, its heading, its words and its
      // plate's caption. The bodies are JSX with links in them, which is
      // exactly the case `Editable`'s children fallback exists for.
      ...CREED_ARTICLES,
    ],
  },
  {
    id: 'the-see',
    label: 'Whose confession this is',
    slots: [heading('the-see'), prose('the-see'), picture('the-see')],
  },
];

const SAINTS_BANDS: readonly AboutBand[] = [
  {
    id: 'both-heading',
    label: 'Two soldiers',
    slots: [
      { id: 'both-heading.eyebrow', kind: 'heading', label: 'Eyebrow' },
      heading('both-heading'),
      // No `note` — that band's `SectionHeading` has no third line.
      prose('both-heading'),
    ],
    // The diptych is two icons at matched height, named. Not offered: an icon
    // is venerated rather than used as page furniture, and swapping one for a
    // photograph from a phone is not an edit anybody should make in passing.
  },
  {
    id: 'mercurius-heading',
    label: 'St. Philopater Mercurius',
    slots: [
      { id: 'mercurius-heading.eyebrow', kind: 'heading', label: 'Eyebrow' },
      heading('mercurius-heading'),
      note('mercurius-heading'),
      prose('mercurius-heading'),
      ...feastRows('mercurius-heading.feast', MERCURIUS_FEASTS),
    ],
  },
  {
    id: 'mina-heading',
    label: 'St. Mina the Wonder-worker',
    slots: [
      { id: 'mina-heading.eyebrow', kind: 'heading', label: 'Eyebrow' },
      heading('mina-heading'),
      note('mina-heading'),
      prose('mina-heading'),
      ...feastRows('mina-heading.feast', MINA_FEASTS),
    ],
  },
  {
    id: 'icons-heading',
    label: 'Reading the icons',
    slots: [
      { id: 'icons-heading.eyebrow', kind: 'heading', label: 'Eyebrow' },
      heading('icons-heading'),
      note('icons-heading'),
      prose('icons-heading'),
    ],
  },
  // The feast tables are computed from Coptic dates. Not offered.
];

/**
 * The tour's six stations, derived rather than written out.
 *
 * Their headings and ledes are already data — `TOUR_STATIONS` in
 * `stations.ts` — so listing them here by hand would be a second copy of the
 * same six titles, going stale the first time one is reworded.
 *
 * Their *bodies* are not offered, and that is the one place in this file where
 * the omission needs stating rather than assuming: a station body is a
 * `Reveal`, a `Stepper`, a `Switcher`, a hymn table and a stamp button. A
 * markdown box in its place would work, save, and quietly delete the tour.
 */
const TOUR_BANDS: readonly AboutBand[] = [
  hero('tour-hero'),
  ...TOUR_STATIONS.map<AboutBand>((station) => ({
    id: station.id,
    label: `Station ${station.number} · ${station.title}`,
    slots: [
      { id: `${station.id}.h2`, kind: 'heading', label: 'Title' },
      { id: `${station.id}.lede`, kind: 'prose', label: 'Standfirst' },
    ],
  })),
];

const FUTURE_BANDS: readonly AboutBand[] = [
  hero('future-hero'),
  /*
   * The film's own band is not here. Its `h2` is `visually-hidden` — it exists
   * to label the section for a screen reader — and its content is a video with
   * a caption track beside it. Neither is copy anybody edits.
   *
   * Nor are the "Building A/B/C" tags on the three bands below. They are the
   * letters the permit set uses, and the whole page is written to agree with
   * the filed drawings.
   */
  {
    id: 'what-is-being-built',
    label: 'Three buildings, one courtyard',
    slots: [heading('what-is-being-built'), prose('what-is-being-built')],
  },
  {
    id: 'the-church',
    label: 'Building A · The church',
    slots: [heading('the-church'), prose('the-church')],
  },
  {
    id: 'youth-and-housing',
    label: 'Building B · Sunday school, sport, and housing',
    slots: [heading('youth-and-housing'), prose('youth-and-housing')],
  },
  {
    id: 'the-diocese-centre',
    label: 'Building C · The diocese centre',
    slots: [heading('the-diocese-centre'), prose('the-diocese-centre')],
  },
  {
    id: 'more-views',
    label: 'Walk round it',
    slots: [
      { id: 'more-views.eyebrow', kind: 'heading', label: 'Eyebrow' },
      heading('more-views'),
      lede('more-views'),
    ],
  },
  {
    id: 'all-of-it',
    label: 'What the space is for',
    slots: [
      { id: 'all-of-it.eyebrow', kind: 'heading', label: 'Eyebrow' },
      heading('all-of-it'),
      lede('all-of-it'),
      // The schedule's names and notes. **Not its figures** — those are
      // arithmetic off the filed drawings, and the note in `plan.ts` about not
      // trusting an area extracted from the Revit export applies twice over to
      // one typed in by hand. See the call site in `parts.tsx`.
      ...BY_USE_ROWS,
    ],
  },
  {
    id: 'the-land',
    label: 'How it sits on the land',
    slots: [
      { id: 'the-land.eyebrow', kind: 'heading', label: 'Eyebrow' },
      heading('the-land'),
      lede('the-land'),
      prose('the-land'),
    ],
  },
  {
    id: 'where-it-stands',
    label: 'Where the work stands',
    slots: [
      { id: 'where-it-stands.eyebrow', kind: 'heading', label: 'Eyebrow' },
      heading('where-it-stands'),
      lede('where-it-stands'),
      // The dated spine of filings. These are dates printed on the drawings, so
      // a change is a matter of record with the town — which is an argument for
      // being careful rather than for it being impossible.
      ...PROGRESS_ROWS,
    ],
  },
  {
    id: 'who-is-drawing-it',
    label: 'Who is drawing it',
    slots: [
      { id: 'who-is-drawing-it.eyebrow', kind: 'heading', label: 'Eyebrow' },
      heading('who-is-drawing-it'),
      lede('who-is-drawing-it'),
      ...TEAM_ROWS,
    ],
  },
  {
    id: 'paying-for-it',
    label: 'Paying for it',
    slots: [
      heading('paying-for-it'),
      lede('paying-for-it'),
      { id: 'paying-for-it.note', kind: 'prose', label: 'The line under the button' },
    ],
    // Not the fund name. "SPSM Construction Project" has to match what
    // Tithe.ly's form actually offers, and a typo here sends offerings to the
    // general fund silently.
  },
];
/**
 * Captions, and the prose blocks that were reached later.
 *
 * ---------------------------------------------------------------------------
 * Tommy: *"any text on the page should be editable even captions to
 * pictures"*, and then *"a lot of the text is still uneditable."* Both were
 * fair. The first pass declared one heading and one prose block per band and
 * left the rest — every figure caption, the second column of a two-part band,
 * the closing paragraphs under a spine — which on a page like Future Plans is
 * most of the words on it.
 *
 * These are kept apart from the hand-written bands above rather than merged
 * into them for one reason: they are mechanical. A caption slot is
 * `<band>.cap-<picture>` and its label is the picture's own name, so the whole
 * block can be regenerated from the `captionSlot=` props in the five screens if
 * a picture is ever renamed. The bands above carry the *judgement* — which
 * parts of a page are prose at all — and are worth reading. This is a table.
 *
 * Captions are `prose` because several of them want an italicised title or a
 * link to a source, and `Editable` renders an override in a `figcaption` inline,
 * so there is no paragraph wrapper to go wrong.
 * ---------------------------------------------------------------------------
 */
const EXTRA_SLOTS: Partial<Record<AboutSlug, Record<string, readonly AboutSlotSpec[]>>> = {
  'who-we-are': {
    'a-minority-at-home': [
      { id: 'a-minority-at-home.cap-coptic-houses-cairo', kind: 'prose', label: 'Caption · coptic houses cairo' },
      { id: 'a-minority-at-home.cap-coptic-monks', kind: 'prose', label: 'Caption · coptic monks' },
    ],
    'in-egypt': [
      { id: 'in-egypt.cap-desert-monastery', kind: 'prose', label: 'Caption · desert monastery' },
    ],
    'in-new-england': [
      { id: 'in-new-england.cap-queens-church', kind: 'prose', label: 'Caption · queens church' },
    ],
    'the-crossing': [
      { id: 'the-crossing.cap-pope-kyrillos', kind: 'prose', label: 'Caption · pope kyrillos' },
      { id: 'the-crossing.cap-pope-shenouda', kind: 'prose', label: 'Caption · pope shenouda' },
      { id: 'the-crossing.more', kind: 'prose', label: 'More words' },
      { id: 'the-crossing.picture2', kind: 'picture', label: 'Second photograph' },
    ],
    'this-church': [
      { id: 'this-church.cap-sanctuary', kind: 'prose', label: 'Caption · sanctuary' },
    ],
    'what-copt-means': [
      { id: 'what-copt-means.cap-coptic-family', kind: 'prose', label: 'Caption · coptic family' },
    ],
  },
  'our-belief': {
    'the-councils': [
      { id: 'the-councils.cap-alexandrian-fathers', kind: 'prose', label: 'Caption · alexandrian fathers' },
    ],
    'the-creed': [
      { id: 'the-creed.cap-council-of-nicaea', kind: 'prose', label: 'Caption · council of nicaea' },
    ],
    'the-faith': [
      { id: 'the-faith.cap-wadi-natrun-frescos', kind: 'prose', label: 'Caption · wadi natrun frescos' },
    ],
    'the-see': [
      { id: 'the-see.cap-st-mark-preaching', kind: 'prose', label: 'Caption · st mark preaching' },
    ],
  },
  'patron-saints': {
    'both-heading': [
      { id: 'both-heading.cap-mercurius-icon', kind: 'prose', label: 'Caption · mercurius icon' },
      { id: 'both-heading.cap-mina-mosaic', kind: 'prose', label: 'Caption · mina mosaic' },
    ],
    'icons-heading': [
      { id: 'icons-heading.cap-mercurius-triptych', kind: 'prose', label: 'Caption · mercurius triptych' },
      { id: 'icons-heading.cap-mina-ampulla', kind: 'prose', label: 'Caption · mina ampulla' },
      { id: 'icons-heading.cap-mina-plaque', kind: 'prose', label: 'Caption · mina plaque' },
    ],
    'mercurius-heading': [
      { id: 'mercurius-heading.cap-mercurius-church-cairo', kind: 'prose', label: 'Caption · mercurius church cairo' },
    ],
    'mina-heading': [
      { id: 'mina-heading.cap-mina-basilica', kind: 'prose', label: 'Caption · mina basilica' },
    ],
  },
  'future-plans': {
    'paying-for-it': [
      { id: 'paying-for-it.fund', kind: 'prose', label: 'Which fund to choose' },
    ],
    'the-church': [
      { id: 'the-church.cap-steps', kind: 'prose', label: 'Caption · steps' },
      { id: 'the-church.cap-west-front', kind: 'prose', label: 'Caption · west front' },
    ],
    'the-diocese-centre': [
      { id: 'the-diocese-centre.cap-diocese-center', kind: 'prose', label: 'Caption · diocese center' },
    ],
    'the-land': [
      { id: 'the-land.cap-massing', kind: 'prose', label: 'Caption · massing' },
      { id: 'the-land.cap-roofs-aerial', kind: 'prose', label: 'Caption · roofs aerial' },
      { id: 'the-land.cap-site-plan', kind: 'prose', label: 'Caption · site plan' },
    ],
    'what-is-being-built': [
      { id: 'what-is-being-built.cap-campus-aerial', kind: 'prose', label: 'Caption · campus aerial' },
      { id: 'what-is-being-built.cap-piazza', kind: 'prose', label: 'Caption · piazza' },
    ],
    'where-it-stands': [
      { id: 'where-it-stands.foot', kind: 'prose', label: 'Closing words' },
    ],
    'youth-and-housing': [
      { id: 'youth-and-housing.cap-youth-center', kind: 'prose', label: 'Caption · youth center' },
    ],
  },
};

/**
 * Every page's bands, with the mechanical slots folded in.
 *
 * `Record<AboutSlug, …>` rather than an array, so this fails to compile the day
 * somebody adds a slug to `ABOUT_SLUGS` without deciding what is editable on
 * it — which is the only reliable way to keep a manifest like this honest.
 */
function withExtras(page: AboutSlug, bands: readonly AboutBand[]): readonly AboutBand[] {
  const extra = EXTRA_SLOTS[page];
  if (!extra) return bands;
  return bands.map((band) => {
    const more = extra[band.id];
    return more ? { ...band, slots: [...band.slots, ...more] } : band;
  });
}

export const ABOUT_BANDS: Record<AboutSlug, readonly AboutBand[]> = {
  'who-we-are': withExtras('who-we-are', WHO_BANDS),
  'our-belief': withExtras('our-belief', BELIEF_BANDS),
  'patron-saints': withExtras('patron-saints', SAINTS_BANDS),
  'welcome-newcomers': withExtras('welcome-newcomers', TOUR_BANDS),
  'future-plans': withExtras('future-plans', FUTURE_BANDS),
};

/** The spec for one key, for the editor. Undefined means "not declared". */
export function slotSpec(page: AboutSlug, id: string): AboutSlotSpec | undefined {
  for (const band of ABOUT_BANDS[page]) {
    const found = band.slots.find((slot) => slot.id === id);
    if (found) return found;
  }
  return undefined;
}

/** Which band a slot belongs to, so the panel can title itself. */
export function bandOfSlot(page: AboutSlug, id: string): AboutBand | undefined {
  return ABOUT_BANDS[page].find((band) => band.slots.some((slot) => slot.id === id));
}
