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
 * About pages, that "finance" does not reach the camp ledger, that Summer camp
 * is not a flag at all but a grant on a program.
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
 * **At Tommy's direction they are gone, and the audit behind that is worth
 * recording.** Every one of those five gates nothing whatsoever in the browser:
 * `canAdmin('…')` is called for exactly four screens on this site — `events`,
 * `forms`, `bookstore` and `finance` — and for nothing else. There is no editor
 * for the prose pages; the bulletin is read through from the parish's own source
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
    'Not the parish calendar. Liturgies and one-off event pages are the Parish calendar row below.',
};

/**
 * Summer camp, which is a program grant wearing a different hat.
 *
 * It gets a row of its own rather than being left as one checkbox among the
 * ministries because it is the one program whose grant opens something other
 * than photographs: registrations, with children's names, grades, allergies and
 * a payment ledger on them. Somebody ticking it should be told that, and a row
 * in a list of ministries cannot say it.
 *
 * The program id is not hardcoded here — it is read from `config/camp` at
 * render time, because that document is what `useCampAdmin` checks against and
 * two copies of the same id is how they come to disagree.
 */
export const AREA_CAMP: AccessArea = {
  key: 'programs',
  label: 'Summer camp',
  blurb:
    'Registrations, allocation into bands and groups, and the fees ledger for the current season.',
  caveat:
    'This is personal data about children — names, grades, allergies and medical notes. It is the same program grant as the camp’s gallery; there is no way to give one without the other.',
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
  AREA_FORMS,
  AREA_FINANCE,
  AREA_BOOKSTORE,
] as const;

/**
 * The rows that are a plain screen flag, in page order.
 *
 * These four, and only these four, are the screens something in this codebase
 * actually gates on — `useEventsAdmin`, `useFormsAdmin`, `useBookstoreAdmin`
 * and `useFinanceAdmin`, plus the calendar's own `canAdmin('events')`. Ticking
 * any of them changes what somebody sees on their next page load, which is the
 * property the long note at the top of this file is about.
 *
 * Not alphabetical and not the order of `ADMIN_SCREENS`: an administrator
 * scanning this page is looking for the area somebody actually works in.
 */
export const SCREEN_AREAS: readonly (AccessArea & { key: AdminScreen })[] = [
  AREA_EVENTS,
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
 * A name and nothing else — no blurb, no caveat. These five have no editor, so
 * there is nothing to describe: the only sentence the panel needs is "this
 * person holds a thing you cannot change here", and the label is the half of it
 * that varies. It is what survives of the five full rows this file used to
 * carry, and it is deliberately the cheap half.
 */
export const UNOFFERED_LABELS: Readonly<Partial<Record<AdminScreen, string>>> = {
  content: 'About pages',
  bulletin: 'Bulletin and announcements',
  servants: 'Servants’ rota',
  parking: 'Car park register',
  theme: 'Colours and type',
};
