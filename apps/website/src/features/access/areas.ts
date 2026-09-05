import { ADMIN_SCREENS, type AdminScreen, type FinanceSource } from '@spsm/shared';

/**
 * Everything a superadmin can hand out, in the order they are handed out.
 *
 * ---------------------------------------------------------------------------
 * ## Why a list here and not just `ADMIN_SCREENS`
 *
 * `ADMIN_SCREENS` is the permission model: eleven flags, named for what they
 * unlock, correct and unreadable. This is the *screen*, and a screen has to say
 * what a flag actually means to the person ticking it — that "content" is the
 * About pages, that "finance" is totals and not a list of who owes them, that
 * "Summer camp" is the registrations and deliberately not the camp's event
 * pages.
 *
 * Keeping them apart means the model can grow a screen without this page
 * inventing copy for it, and this page can group and word things without the
 * model acquiring a `label` field that the mobile app would then have to carry.
 *
 * ## This list is shorter than `ADMIN_SCREENS`, on purpose
 *
 * It used to be the whole model bar two, and the file argued for that: *a flag
 * that no page can set is a flag that only a console edit can set, which is the
 * state this whole screen exists to end.* Five rows were carried on that
 * argument with a `no editor yet` marker on them — the About pages, the
 * announcements, the servants' rota, the vehicle register and the design
 * tokens.
 *
 * **The About pages are the first of the five to come back**, in exactly the way
 * the instruction further down asks for: with their editor, in the same change.
 * Four are still out. See `AREA_CONTENT`.
 *
 * **At Tommy's direction they are gone, and the audit behind that is worth
 * recording.** Every one of those five gates nothing whatsoever in the browser:
 * `canAdmin('…')` was called for exactly four screens on this site — `events`,
 * `forms`, `bookstore` and `finance` — and for nothing else. There are six
 * now: `camp` was the camp's program grant until the registrations were
 * separated from the camp's events and gallery, and `content` has an editor at
 * last — see `AREA_CONTENT`. Of the other four, the bulletin is read through from the parish's own source
 * each week and is not stored here at all; the rota is written by a script over
 * the REST API; the vehicle register has a public form and no back office; the
 * design tokens are seeded and deployed. So the five rows offered an
 * administrator a decision with no consequence, four screens deep into a page
 * whose entire job is making consequences legible.
 *
 * The cost of dropping them is real and it is small: those flags can now only be
 * set from the Firebase console. That costs nothing *today*, because there is no
 * screen on which the grant would do anything — the person given `content` and
 * the person not given it can both do exactly nothing with the prose pages.
 *
 * **The five constants are deleted, not shelved, and that is a second decision
 * rather than the same one.** They were kept whole here for a few hours on the
 * argument that the copy is the expensive part of a row — the caveats about
 * children's medical notes and about an event being public the moment it is
 * saved are the work, not the checkbox. Tommy's answer was to get rid of them,
 * and it is the better one: a row's copy has to describe *the editor it opens*,
 * and none of these five will be written until that editor exists. Kept, they
 * would have been five blocks of prose about screens nobody had designed yet,
 * ageing quietly next to four that were true.
 *
 * So **write the row with its editor, in the same change**, and take the old
 * wording from `git log -- apps/website/src/features/access/areas.ts` if it
 * still fits. `AccessArea` no longer carries `hasEditor` either; a grant that
 * genuinely has to land ahead of its screen can bring the field back with it.
 *
 * ## Two flags are deliberately not offered here, and never will be
 *
 * `members` and `config` exist in the model and are absent from this list for a
 * different reason than the five above — not "no screen uses it" but "no
 * screen should be able to give it away". `members` is the power to grant every
 * other flag on this page, and delegating the delegation is how a
 * superadmin-only screen quietly stops being one. `config` is where the site is
 * pointed at its backends. Both stay with the claim; the long version is in
 * `packages/shared/src/screens.ts`.
 *
 * ## Nothing is revoked by a row disappearing
 *
 * `AccessScreen` edits a *complete* `ScreenAdmin` map read off the member
 * document and writes it back whole, so a flag with no row is carried through a
 * save untouched. It is also counted and named on the panel — see
 * `UNOFFERED_SCREENS` — because a permission this page silently preserves and
 * never mentions is worse than one it does not offer.
 * ---------------------------------------------------------------------------
 */
export interface AccessArea {
  /** Stable key. The screen flag, or `'programs'` for the per-program axis. */
  key: AdminScreen | 'programs';
  /** What an administrator calls it. */
  label: string;
  /** One line under the label: what the person will be able to do. */
  blurb: string;
  /**
   * Anything the label would otherwise overpromise.
   *
   * Rendered in a quieter voice beneath the blurb, and only where there is a
   * real limit to state. A caveat on every row is a caveat nobody reads.
   */
  caveat?: string;
}

/**
 * The one area that is not a screen flag.
 *
 * Program grants are a list of ids, not a boolean, so this row draws a picker
 * of the parish's ministries rather than a switch. It is first because it is
 * the one people come here for — a servant runs one ministry and should be
 * given that ministry and nothing else, which is the whole argument for this
 * page existing.
 */
export const AREA_PROGRAMS: AccessArea = {
  key: 'programs',
  label: 'Ministries and their events',
  blurb:
    'Which ministries this person runs — their gatherings, and the photographs sent in to them.',
  caveat:
    'Not the parish calendar. Liturgies and one-off event pages are the Parish calendar row below. Ticking the summer camp here gives its gatherings and photographs — its registrations are the Summer camp row, and the two are separate on purpose.',
};

/**
 * Summer camp — the back office, and now a screen flag of its own.
 *
 * ---------------------------------------------------------------------------
 * **This row used to set the camp's program grant, and that is the thing that
 * changed.** One tick opened the registrations *and* the camp's page, its
 * gatherings and its gallery, because that is what a program grant is. The
 * caveat here said so — "there is no way to give one without the other" — which
 * is a permission model apologising for itself on the screen whose whole job is
 * making permissions legible.
 *
 * `camp` is now a flag in `ADMIN_SCREENS`, so this is an ordinary row among the
 * areas of the site, and the camp's photographs are a tick in the Ministries
 * list above like every other ministry's. Either can be given without the
 * other, in both directions.
 *
 * It stays worded more heavily than its neighbours for the reason it always
 * was: what it opens is children's names, grades, allergies and medical notes.
 *
 * The fees are no longer named here, and that is the second half of the change:
 * the ledger is read under Finance, narrowed to the camp. What this grant gets
 * of the money is one box for writing down a check as it is handed over.
 * ---------------------------------------------------------------------------
 */
export const AREA_CAMP: AccessArea = {
  key: 'camp',
  label: 'Summer camp',
  blurb:
    'Registrations, the allocation into bands and groups, the daily register, and the camp’s own settings.',
  caveat:
    'This is personal data about children — names, grades, allergies and medical notes. Not the camp’s money: balances and payment history are Finance, narrowed to the camp, and this grant can only write down a payment as it is taken. Not the camp’s event pages or its gallery either — those are the ministry, in the list above.',
};

/**
 * Money.
 *
 * The caveat used to say that this row reached one of the three places the
 * parish takes money, because camp fees and form totals sit inside documents
 * full of personal data and rules grant documents rather than fields. That is
 * still true of those documents, and the way round it was to stop asking: a
 * scheduled Function now writes `financeRollups` — totals with no names in them
 * — and this flag reads those. See the long note on `'finance'` in
 * `packages/shared/src/screens.ts`.
 *
 * The caveat that remains is the one that cannot be engineered away. The
 * treasurer sees what the camp took; they do not see who has not paid, because
 * that is a list of families and it lives with the camp.
 */
export const AREA_FINANCE: AccessArea = {
  key: 'finance',
  label: 'Finance',
  blurb:
    'What the bookstore, the summer camp and the paid forms have taken — and what is still owed. Any of the three on its own, in the list beneath.',
  caveat:
    'Totals only. Which family owes what stays with the Summer camp grant, and who answered a form stays with Forms — those records hold children’s medical notes and people’s answers, and this row is deliberately not a way into them. Sunday giving goes through Tithe.ly and is not recorded on this site at all.',
};

/**
 * The three parts of the money, each grantable on its own.
 *
 * ---------------------------------------------------------------------------
 * Sub-rows rather than three more areas, and the shape is the argument.
 *
 * These are not separate screens: every one of them is read through
 * /admin/finance and through the row above. A parish can have a bookkeeper who
 * does the shop's books and has no business with a list of which families owe
 * camp fees, and that sentence is "Finance, but only the bookstore" — not "the
 * bookstore's money" as an area of the site standing beside the Bookstore row
 * that already exists and means something else.
 *
 * So they are drawn indented under Finance, they are disabled when Finance is
 * off, and `hasFinance()` in firestore.rules asks for the flag before it asks
 * for the source. See `FINANCE_SOURCES` in packages/shared/src/screens.ts for
 * why an unset map means all three.
 *
 * Worded to name the *record*, not the takings, wherever the grant reaches one:
 * the bookstore row opens the orders, which have buyers' names on them, and an
 * administrator ticking it should be told that on the row rather than from a
 * support call.
 * ---------------------------------------------------------------------------
 */
export interface FinanceSourceRow {
  key: FinanceSource;
  label: string;
  blurb: string;
}

export const FINANCE_SOURCE_ROWS: readonly FinanceSourceRow[] = [
  {
    key: 'bookstore',
    label: 'The bookstore',
    blurb:
      'What the shop took each month, and the orders behind it — which carry the buyer’s name and what they bought, because a refund cannot be checked against a sale nobody can see.',
  },
  {
    key: 'camp',
    label: 'The summer camp',
    blurb:
      'What each season billed, took and is still owed, by payment method. Figures only — no child, no family, and no list of who has not paid.',
  },
  {
    key: 'forms',
    label: 'The paid forms',
    blurb:
      'What each form that charges has collected, and what was priced and never paid. No answers and no names.',
  },
] as const;

export const AREA_FORMS: AccessArea = {
  key: 'forms',
  label: 'Forms',
  blurb: 'Building forms, opening and closing them, and reading the replies.',
  caveat:
    'The replies are whatever the form asked for — names, phone numbers, sometimes a child’s allergies.',
};

export const AREA_BOOKSTORE: AccessArea = {
  key: 'bookstore',
  label: 'Bookstore',
  blurb: 'The orders queue, the sales figures, and how the shop’s shelves are arranged.',
  caveat:
    'Prices, stock and whether a book is listed at all live in Square, not here. This does not open Square.',
};

/**
 * The five About pages.
 *
 * ---------------------------------------------------------------------------
 * **This row is back, and the file's own instruction is why it is back now
 * rather than earlier.** `content` was one of the five deleted for gating
 * nothing whatsoever — "the person given `content` and the person not given it
 * can both do exactly nothing with the prose pages" — and the standing rule
 * left behind was to write the row *with* its editor, in the same change. That
 * change is this one: `features/about` is an overlay on the five hand-written
 * About routes, `useAboutAdmin` gates it on this flag, and `firestore.rules`
 * asks for the same flag on `aboutOverrides`.
 *
 * The caveat carries three limits, and every one of them is a thing somebody
 * would otherwise discover by trying:
 *
 *  - **Live as typed.** No draft, like the calendar. What is written is on the
 *    public page within a second, on a page a stranger arrives at from a search
 *    result.
 *  - **Not the layouts, and not everything on them.** A developer declares what
 *    is editable, band by band — see `features/about/slots.ts`. The Creed, the
 *    dated spines, the feast tables and the tour's station bodies are
 *    deliberately beyond reach.
 *  - **Not new pages.** The five parts of About are fixed; a sixth needs a
 *    route file the static export can enumerate, so the database itself refuses
 *    any other slug.
 *
 * It also still opens the older `content` documents — the welcome page, the
 * beliefs prose, the clergy bios, the contact copy — which have no editor of
 * their own and are changed in the Firebase console. Worth knowing, not worth
 * putting in the caveat: nobody is granted this row *for* that.
 * ---------------------------------------------------------------------------
 */
export const AREA_CONTENT: AccessArea = {
  key: 'content',
  label: 'About pages',
  blurb:
    'Rewriting the headings, words and photographs on the five About pages, and adding sections to the foot of them.',
  caveat:
    'Live the moment it is typed — there is no draft, on pages strangers arrive at from a search result. Not the page layouts, and not everything on them: what can be changed is chosen band by band, and the Creed, the dated histories and the feast days are deliberately not. Not new pages either — the five parts of About are fixed.',
};

export const AREA_EVENTS: AccessArea = {
  key: 'events',
  label: 'Parish calendar',
  blurb: 'Adding and editing the services and one-off event pages on /calendar and /events.',
  caveat:
    'Every event in this collection is public the moment it is saved — there is no draft state. Give this to somebody you would trust to publish.',
};

/**
 * The order the page draws them in: the two program-shaped rows first, then the
 * screen flags, roughly by how sensitive each is.
 */
export const ACCESS_AREAS: readonly AccessArea[] = [
  AREA_PROGRAMS,
  AREA_CAMP,
  AREA_EVENTS,
  AREA_CONTENT,
  AREA_FORMS,
  AREA_FINANCE,
  AREA_BOOKSTORE,
] as const;

/**
 * The rows that are a plain screen flag, in page order.
 *
 * These six, and only these six, are the screens something in this codebase
 * actually gates on — `useCampAdmin`, `useEventsAdmin`, `useAboutAdmin`,
 * `useFormsAdmin`, `useBookstoreAdmin` and `useFinanceAdmin`, plus the
 * calendar's own `canAdmin('events')`. Ticking any of them changes what
 * somebody sees on their next page load, which is the property the long note at
 * the top of this file is about.
 *
 * About pages sits beside Parish calendar rather than at the end, because the
 * two are the same kind of trust: both publish to a public page with no draft
 * step between the typing and the world.
 *
 * Summer camp leads because it is the most sensitive and the most often given —
 * and because it is the newest, having been a program grant until the two jobs
 * were separated.
 *
 * Not alphabetical and not the order of `ADMIN_SCREENS`: an administrator
 * scanning this page is looking for the area somebody actually works in.
 */
export const SCREEN_AREAS: readonly (AccessArea & { key: AdminScreen })[] = [
  AREA_CAMP,
  AREA_EVENTS,
  AREA_CONTENT,
  AREA_FORMS,
  AREA_FINANCE,
  AREA_BOOKSTORE,
] as readonly (AccessArea & { key: AdminScreen })[];

/**
 * Flags in the model that this page does not draw a control for.
 *
 * Derived rather than listed, so a screen added to `ADMIN_SCREENS` without a row
 * here cannot go unnoticed: it lands in this set on the next build, and the
 * panel names it on anybody holding it.
 *
 * `members` and `config` are excluded because they are not *unoffered*, they are
 * *undelegable* — no screen should ever set them, so a person holding one is
 * either the superadmin (whose claim is elsewhere) or a mistake to be fixed in
 * the console rather than a footnote on this page.
 */
export const UNOFFERED_SCREENS: readonly AdminScreen[] = ADMIN_SCREENS.filter(
  (screen) =>
    screen !== 'members' &&
    screen !== 'config' &&
    !SCREEN_AREAS.some((area) => area.key === screen),
);

/**
 * What to call a flag this page does not offer, when somebody turns out to hold one.
 *
 * A name and nothing else — no blurb, no caveat. These four have no editor, so
 * there is nothing to describe: the only sentence the panel needs is "this
 * person holds a thing you cannot change here", and the label is the half of it
 * that varies. It is what survives of the five full rows this file used to
 * carry, and it is deliberately the cheap half.
 *
 * `content` has gone from this map, which is the whole point of the exercise: it
 * has a row and an editor now, so `UNOFFERED_SCREENS` drops it on its own.
 */
export const UNOFFERED_LABELS: Readonly<Partial<Record<AdminScreen, string>>> = {
  bulletin: 'Bulletin and announcements',
  servants: 'Servants’ rota',
  parking: 'Car park register',
  theme: 'Colors and type',
};
