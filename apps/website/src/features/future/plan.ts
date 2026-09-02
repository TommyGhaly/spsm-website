/**
 * The numbers on /about/future-plans, and where each one was read off.
 *
 * ---------------------------------------------------------------------------
 * **Every figure here comes off a schedule or a printed sentence in the filed
 * drawings, not off a tape measure laid over a PDF.** That distinction did real
 * work: the room tags in the set are exported by Revit in drawing order rather
 * than reading order, so a plain text extraction of sheet R2 pairs BOOKSTORE
 * with 969 SF on one half of the sheet and with 301 SF on the other. Two of
 * these — the nave and the sports court — were checked against a zoomed render
 * of the sheet before being written down. The rest come from the AREA BY USE
 * TYPE and TOTAL BUILDING AREA schedules, which are unambiguous because they
 * are tables.
 *
 * Anything that could not be verified that way is **named without a number**
 * on the page. There is a bookstore in Building B and this file does not say
 * how big it is, and that is the correct outcome.
 *
 * The one honest wobble worth recording for whoever edits this next: the civil
 * site plan (C-200) annotates Building B "25 1 BR UNITS", while the floor plans
 * label twenty-one apartments in Building B and three more in the diocese
 * centre — twenty-four. Both numbers are in the same filing. The page states
 * what the floor plans draw, because that is the countable one, and says
 * "twenty-one" rather than "twenty-five".
 * ---------------------------------------------------------------------------
 */

export type Figure = { value: string; label: string; note: string };

/** The four numbers a reader should leave with. */
export const HEADLINE: readonly Figure[] = [
  {
    value: '119,458',
    label: 'square feet',
    note: 'Across all three buildings and every floor. TOTAL BUILDING AREA schedule, sheet R0.',
  },
  {
    value: '570',
    label: 'seats',
    note: 'The figure the parking requirement is calculated from on the site layout plan.',
  },
  {
    value: '190',
    label: 'parking spaces',
    note: 'One per three seats, which is what the Wayland bylaw asks of a church. Six accessible.',
  },
  {
    value: '5.5',
    label: 'acres',
    note: 'The existing lot. Map 40, Lot 008 — no land is being bought.',
  },
];

/**
 * The whole 119,458 sq ft, split by what it is for.
 *
 * Straight off the AREA BY USE TYPE schedule that repeats on sheets R0 through
 * R4, summed across floors here rather than in the markup. The seven rows add
 * to the total exactly; if you change one, the total is a lie.
 */
export const BY_USE: readonly { use: string; area: number; of: string }[] = [
  {
    use: 'Function hall and parishioners’ needs',
    area: 27736,
    of: 'The dining hall, the function room, the kitchens, the lobbies and the servery. Basement and ground floor.',
  },
  {
    use: 'Sunday school',
    area: 24055,
    of: 'Thirteen classrooms, a nurse station, lobbies and storage, on the basement and ground levels of Building B.',
  },
  {
    use: 'Church and congregation',
    area: 22521,
    of: 'The nave, the altars, the baptistery, the chorus, the deacons’ room, the foyer and the two crying rooms.',
  },
  {
    use: 'Retreat, athletics and children',
    area: 18514,
    of: 'A full-size sports court with locker rooms, a game room and a flexible hall.',
  },
  {
    use: 'Residential',
    area: 17889,
    of: 'One-bedroom apartments over the two upper floors of Building B, with a common room on each.',
  },
  {
    use: 'Diocese',
    area: 7240,
    of: 'Offices, a conference room and a lounge in Building C.',
  },
  {
    use: 'Plant',
    area: 1503,
    of: 'Mechanical, electrical and the rest of what a building this size needs and nobody sees.',
  },
];

export type Moment = { when: string; what: string };

/**
 * Where the work stands.
 *
 * Dates are the ones printed on the drawings themselves — the issue date in the
 * title block and the two revision lines in the revision schedule — not dates
 * anybody remembers. The last entry has no date because it has not happened:
 * the cover sheet's "DATE SITE PLAN ENDORSED" is still a blank line, and every
 * sheet in the set is stamped NOT FOR CONSTRUCTION.
 */
export const PROGRESS: readonly Moment[] = [
  {
    when: '2016',
    what: 'St. Mark of Boston buys the Church of the Holy Spirit at 169 Rice Road, and this church begins — in a building designed for somebody else’s liturgy.',
  },
  {
    when: 'June 2025',
    what: 'The architects issue the first renderings of the church itself — Building A, on its own, without the site around it.',
  },
  {
    when: 'August 2025',
    what: 'The full set goes to the Town of Wayland: three buildings, forty-odd sheets, and seven consulting firms named on the cover — civil, structural, code, mechanical, transport, landscape.',
  },
  {
    when: 'November 2025',
    what: 'First revision, marked “per town review”, together with the survey of abutters the process requires.',
  },
  {
    when: 'December 2025',
    what: 'Second revision, again per town review, and the compiled set that this page was written from.',
  },
  {
    when: 'March 2026',
    what: 'The flythrough above is delivered — the first time the three buildings are shown in colour, with materials on them.',
  },
  {
    when: 'Next',
    what: 'Site plan approval from the Wayland Planning Board. The endorsement line on the cover sheet is still blank, and every drawing in the set is stamped “not for construction”. Nothing has been dug.',
  },
];

/**
 * The nine firms working on this, and what each one does.
 *
 * ---------------------------------------------------------------------------
 * **This list is the page's strongest evidence, and it is deliberately given
 * more room than a credit usually gets.** A church saying "we are planning a
 * new building" is a wish. A church that can name a structural engineer, a
 * traffic consultant, a code consultant, a wetland scientist and a licensed
 * land surveyor — each on a specific sheet of a set already twice revised in
 * front of a planning board — is describing a project. The names do work the
 * adjectives cannot.
 *
 * Seven are named on the cover sheet's PROJECT TEAM block. Two are not, and are
 * here because they are named in the drawings' own notes instead: Goddard
 * Consulting delineated the wetlands (sheet C-100's general notes) and Dillis &
 * Roy prepared the existing-conditions survey the whole set is drawn over
 * (sheet 1). Leaving those two off because they are not in the cover block
 * would undercount the work by two firms.
 *
 * `slug` is the logo filename, not a display value: `assets/future/logos/`
 * holds `<slug>.png` and the optimiser writes `public/img/future/logos/`.
 * A firm with no logo file still renders — see `teamLogo` in `logos.ts` — so
 * this list is complete whether or not the artwork is.
 * ---------------------------------------------------------------------------
 */
export type TeamMember = {
  slug: string;
  firm: string;
  role: string;
  /** Where they are, so "who is this" is answerable without a search. */
  town: string;
};

export const TEAM: readonly TeamMember[] = [
  {
    slug: 'dsk',
    firm: 'Dewing Schmid Kearns',
    role: 'Architects and planners',
    town: 'Concord, Massachusetts',
  },
  {
    slug: 'oak-consulting-group',
    firm: 'Oak Consulting Group',
    role: 'Civil engineering',
    town: 'Newburyport, Massachusetts',
  },
  {
    slug: 'foley-buhl-roberts',
    firm: 'Foley Buhl Roberts & Associates',
    role: 'Structural engineering',
    town: 'Portland, Maine',
  },
  {
    slug: 'buro-happold',
    firm: 'Buro Happold',
    role: 'Mechanical, electrical, plumbing and fire protection',
    town: 'Boston, Massachusetts',
  },
  {
    slug: 'crowley-cottrell',
    firm: 'Crowley Cottrell',
    role: 'Landscape architecture',
    town: 'Boston, Massachusetts',
  },
  {
    slug: 'mdm',
    firm: 'MDM Transportation Consultants',
    role: 'Traffic and transport',
    town: 'Marlborough, Massachusetts',
  },
  {
    slug: 'code-red',
    firm: 'Code Red Consultants',
    role: 'Building and fire code',
    town: 'Southborough, Massachusetts',
  },
  {
    slug: 'goddard-consulting',
    firm: 'Goddard Consulting',
    role: 'Wetland delineation and ecology',
    /* No address is printed for them anywhere in the set — they appear only in
       sheet C-100's general notes — so this stays empty rather than guessed. */
    town: '',
  },
  {
    slug: 'dillis-roy',
    firm: 'Dillis & Roy Civil Design Group',
    role: 'Land survey and existing conditions',
    town: 'Concord, Massachusetts',
  },
];
