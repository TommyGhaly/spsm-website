/**
 * Per-screen admin permissions — the whole of the site's authorization, now.
 *
 * This used to be "a second, finer axis than `Role`", widening tiers it could
 * not narrow. There are no tiers left. A person is signed in, which grants the
 * servants' rota and nothing else, or they hold `superadmin`, which grants
 * everything; between those two is this map, and it is the only thing that
 * says who administers what.
 *
 * That changes what these flags mean in one important way. **They used to
 * grant and never revoke** — every rule read `staff, or specifically entrusted
 * with this`, so a flag could only add somebody to a group that already had
 * the door open. Now the flag *is* the door. `canAdminScreen` is "superadmin,
 * or entrusted with this", and there is no third answer.
 *
 * The list is deliberately one constant. Every member document carries a
 * complete map with an entry per screen — see `defaultScreenAdmin` — so
 * adding a screen here means existing documents lack the key, and
 * `canAdminScreen` treats a missing key as `false`. That is the safe direction:
 * a new screen is closed to everyone until somebody is granted it, rather than
 * open to everyone who happened to sign in first.
 *
 * `screensFromGrants` in ./claims.ts mirrors the true keys into the ID token,
 * because Firebase Storage rules cannot read Firestore and have nothing else
 * to go on. That mirror is a copy; this map is the fact.
 */

/**
 * Every area of the site that can be administered separately.
 *
 * Named for the thing being managed, not the route — `/admin/events` may move
 * but "events" is what the permission is about. Ordered roughly by how often a
 * parish actually touches them.
 */
export const ADMIN_SCREENS = [
  /** Parish calendar and event pages. */
  'events',
  /** The weekly bulletin and homepage announcements. */
  'bulletin',
  /** Bookstore catalog and orders. */
  'bookstore',
  /**
   * Form definitions and the answers people send back.
   *
   * A submission carries whatever the form asked for — names, phone numbers,
   * a child's allergies on a registration form — so this is one of the two
   * flags on this list that opens personal data. Grant it to the person who
   * builds the forms and reads the replies, and to nobody as a courtesy.
   */
  'forms',
  /**
   * The summer camp's own back office: registrations, the allocation into
   * bands and groups, the daily register, and the camp's settings.
   *
   * ---------------------------------------------------------------------------
   * **This used to be the camp's program grant, and separating them is the
   * point of this flag.**
   *
   * `programAdmin.programs` containing the camp's id meant one thing to the
   * rules and three things to a parish. It opened the registrations — children's
   * grades, allergies and medical notes — and, because a program grant is a
   * program grant, it also opened `programs/{camp}`, every `programEvent`
   * underneath it and every photograph sent in to them. So the person given the
   * camp's paperwork was thereby given the camp's *events*, and there was no way
   * to say otherwise. /access said so out loud, in a caveat, which is a
   * permission model apologising for itself.
   *
   * They are now two grants that happen to be about the same summer:
   *
   *   `camp` (this flag)            the registrations, the groups, the register
   *   `programAdmin.programs`       the camp's page, its gatherings, its gallery
   *
   * Either can be held without the other, in both directions. The registrar who
   * takes families at a desk needs no power to publish an event page; the
   * servant who posts the week's photographs has no business with a ten-year
   * old's medical notes.
   *
   * **What this flag does not open is the money.** The fees ledger is inside a
   * `campRegistrations` document, so anybody who can read a registration can
   * read the ledger on it — that is a fact about the document and rules cannot
   * change it. What is separated is the *screen*: /admin/camp shows totals,
   * balances, discounts and the payment history only to `finance` narrowed to
   * `camp`, and gives this flag one write-only control for taking a payment at
   * the desk. Correcting, deleting or discounting one is the treasurer's. See
   * `canSeeFinanceSource` at the bottom of this file, and be clear about which
   * half of that is a rule and which is a preference.
   * ---------------------------------------------------------------------------
   */
  'camp',
  /**
   * The money: the bookstore's takings, the camp's fees, and what the paid
   * forms have brought in.
   *
   * ---------------------------------------------------------------------------
   * **This flag once reached less than its name suggested. It no longer does,
   * and how the gap was closed is the thing worth knowing about it.**
   *
   * The parish takes money in three places and only one of them keeps it in a
   * document of its own: `bookstoreStats` is nothing but figures, and `orders`
   * is a transaction record. Camp fees live in `billing.payments[]` *inside* a
   * `campRegistrations` document, alongside the child's grade, allergies and
   * medical notes; a paid form's total lives on the `formSubmissions` document
   * next to every answer given.
   *
   * Firestore rules grant documents, not fields. So a `finance` flag that
   * reached the camp ledger would also hand over children's medical notes, and
   * one that reached form payments would hand over the answers. That trade was
   * never made and must never be: **do not widen the `campRegistrations` or
   * `formSubmissions` rules to admit this flag.** `tests/rules/access.test.ts`
   * asserts that they do not.
   *
   * What exists instead is `financeRollups` — one document per camp season and
   * per paid form, holding counts and sums and no name, no address, no email
   * and no check number. `functions/src/finance.ts` writes them with the Admin
   * SDK, which bypasses the rules that correctly refuse a treasurer, and this
   * flag reads them. The trust boundary moved from a rule that could not be
   * written to a Function that can be read.
   *
   * So the three doors this flag opens are `orders`, `bookstoreStats` and
   * `financeRollups`, and the screen behind them is /admin/finance. What it
   * still does not open — and there is no rollup that would help — is Sunday
   * giving: that goes through Tithe.ly and never touches this site's records at
   * all.
   *
   * **This flag is now the coarser half of a pair.** `FinanceScopes` at the
   * bottom of this file narrows it to any of the shop, the camp and the paid
   * forms, because a parish can have a bookkeeper who does the shop's books and
   * has no business with which families owe camp fees. The flag is still the
   * door — a source without it opens nothing — and the three doors above are
   * each governed by `hasFinance(source)` rather than `hasScreen('finance')`.
   * ---------------------------------------------------------------------------
   */
  'finance',
  /** Vehicle registrations from the car-park NFC tag. */
  'parking',
  /**
   * The servants' own rota — `servantEvents`.
   *
   * Writing it, not reading it: anybody signed in may read that collection,
   * because needing a grant to see when you are serving would be exactly
   * backwards. Sign-in is restricted to the parish's Entra tenant, so "signed
   * in" already means "a servant of this church".
   *
   * Note this is **not** the two editable layers of the public calendar
   * (`scheduleEntries`, `calendarDetails`). Those are /calendar, which is what
   * `events` covers. `servantsConfig` is not here either — it is `read: false`
   * with no client at all, written only by a script over the REST API, and a
   * grant onto a door nobody uses is a door that gets used by accident.
   */
  'servants',
  /** Beliefs, clergy bios, and the other `content` pages. */
  'content',
  /**
   * Design tokens — colours, spacing, type.
   *
   * This needed `hasStrictScreen()` while there was a `staff` tier, because the
   * ordinary helper admitted every staff member and `config/theme` restyles
   * every page on the site. With the tier gone the two helpers say the same
   * thing and only `hasScreen()` remains — but the caution behind the split is
   * still worth knowing when reading /access: ticking this hands somebody the
   * look of the entire website, not one page of it.
   */
  'theme',
  /*
   * ---------------------------------------------------------------------------
   * The two below are **deliberately not delegable**, and are the only entries
   * on this list that no rule honours.
   *
   * That looks exactly like the bug this whole axis was built to fix — a flag
   * written and read by nothing — so it is worth being explicit that it is a
   * decision rather than an unfinished edit:
   *
   *   `members`  is the power to grant every other flag on this list. Delegating
   *              the delegation is how a superadmin-only screen quietly stops
   *              being one, so `/members/{uid}` stays `isSuper()` and the
   *              allocation screen does not offer this row.
   *   `config`   is where the site is pointed at its backends and its
   *              integrations. It is world-readable by design, which makes a
   *              *write* there the whole of its risk, and it sits one document
   *              away from things that decide whether the parish's money and
   *              calendar work at all.
   *
   * They stay in the list because `ScreenAdmin` is a complete map and dropping a
   * key would change the shape of every member document for no gain. If either
   * is ever delegated, use `hasStrictScreen()` — never the loose helper.
   * ---------------------------------------------------------------------------
   */
  /** People, and what each of them has been allocated. Superadmin only; see above. */
  'members',
  /** Integration endpoints and feature switches. Superadmin only; see above. */
  'config',
] as const;

export type AdminScreen = (typeof ADMIN_SCREENS)[number];

/** A complete map, one boolean per screen. Stored on the member document. */
export type ScreenAdmin = Record<AdminScreen, boolean>;

export function isAdminScreen(value: unknown): value is AdminScreen {
  return typeof value === 'string' && (ADMIN_SCREENS as readonly string[]).includes(value);
}

/**
 * What a newly created member gets: every screen `false`.
 *
 * A function rather than a frozen constant because callers write it straight
 * into Firestore, and handing every caller the same object is how one of them
 * mutates it and the next member inherits somebody else's permissions.
 */
export function defaultScreenAdmin(): ScreenAdmin {
  return Object.fromEntries(ADMIN_SCREENS.map((screen) => [screen, false])) as ScreenAdmin;
}

/**
 * Coerce anything read out of Firestore into a complete, trustworthy map.
 *
 * Documents predate screens being added, are written by older code, or are
 * simply absent — all of which arrive here as a partial object or `undefined`.
 * Every unknown key resolves to `false`, and keys that are not screens are
 * dropped rather than carried, so a hand-edited document cannot smuggle in a
 * permission the code does not know how to check.
 */
export function parseScreenAdmin(value: unknown): ScreenAdmin {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(
    ADMIN_SCREENS.map((screen) => [screen, source[screen] === true]),
  ) as ScreenAdmin;
}

/**
 * Whether this person may administer this screen.
 *
 * `superadmin` short-circuits, and it has to: the claim means "all of it", and
 * requiring the administrator to also tick ten boxes would make the first
 * account created by `grant-admin.mjs` unable to reach anything — including the
 * screen where the boxes are ticked.
 *
 * Structurally typed rather than taking `SpsmClaims`, so ./claims.ts can import
 * this module without a cycle.
 */
export function canAdminScreen(
  claims: { superadmin?: boolean } | null | undefined,
  screenAdmin: ScreenAdmin | null | undefined,
  screen: AdminScreen,
): boolean {
  if (claims?.superadmin === true) return true;
  return screenAdmin?.[screen] === true;
}

/* ---------------------------------------------------------------------------
 * Finance, narrowed
 * ------------------------------------------------------------------------ */

/**
 * The three places the church takes money, as separately grantable sources.
 *
 * ---------------------------------------------------------------------------
 * ## Why this is a second map and not three more screens
 *
 * `finance` is one door onto two collections — `bookstoreStats` and
 * `financeRollups` — and the screen behind it reports on the shop, the camp and
 * the paid forms together. Three flags on `ADMIN_SCREENS` would say that a
 * person can be given "the camp's money" with no reference to the finance
 * screen at all, which is not true: every one of these is read through
 * /admin/finance and through the `finance` grant. So this narrows that grant
 * rather than replacing it. **`finance` is still the door; this decides which
 * rooms are behind it.** Somebody without `finance` sees nothing here whatever
 * their sources say.
 *
 * Named for the part of the church, not the collection, because that is what an
 * administrator on /access is choosing between — and because `bookstoreStats`
 * and the two prefixes inside `financeRollups` are an implementation detail
 * that has already changed once.
 *
 * ## An absent map means all three, and that is not the usual direction
 *
 * `parseScreenAdmin` treats every unknown key as `false`, deliberately, so a
 * screen added to the model is closed until somebody is granted it. This map
 * does the opposite: a member document with no `financeScopes` at all reads as
 * all three sources granted.
 *
 * That is not a relaxation of the rule above, it is the same rule applied to a
 * different question. A member document written before this map existed belongs
 * to somebody who was given `finance` when `finance` meant all three — reading
 * their absent map as "nothing" would silently revoke a grant that was made
 * deliberately, on the day this shipped, for every treasurer in the parish. The
 * safe direction for a *narrowing* is "not yet narrowed".
 *
 * The ambiguity that would otherwise ruin this is handled at the writing end:
 * /access always saves a complete map with all three keys present, so
 * "unticked everything" is stored as three explicit `false`s and is nothing
 * like an absent map. `parseFinanceScopes` keys off whether any known source is
 * named, never off the map being empty. `firestore.rules` makes the same
 * distinction with `keys().hasAny([...])`, and the two must stay in step.
 * ---------------------------------------------------------------------------
 */
export const FINANCE_SOURCES = [
  /** `bookstoreStats` — what the shop took, by month. */
  'bookstore',
  /** The camp seasons in `financeRollups` — fees billed, received and owed. */
  'camp',
  /** The paid forms in `financeRollups` — what each one charged and collected. */
  'forms',
] as const;

export type FinanceSource = (typeof FINANCE_SOURCES)[number];

/** A complete map, one boolean per source. Stored on the member document. */
export type FinanceScopes = Record<FinanceSource, boolean>;

export function isFinanceSource(value: unknown): value is FinanceSource {
  return typeof value === 'string' && (FINANCE_SOURCES as readonly string[]).includes(value);
}

/**
 * All three — what `finance` meant before it could be narrowed.
 *
 * A function rather than a frozen constant, for the reason `defaultScreenAdmin`
 * is one: callers write the result into Firestore, and handing every caller the
 * same object is how one of them mutates it and the next member inherits it.
 */
export function allFinanceScopes(): FinanceScopes {
  return Object.fromEntries(FINANCE_SOURCES.map((source) => [source, true])) as FinanceScopes;
}

/** None — what an administrator who unticks all three has chosen. */
export function noFinanceScopes(): FinanceScopes {
  return Object.fromEntries(FINANCE_SOURCES.map((source) => [source, false])) as FinanceScopes;
}

/**
 * Coerce anything read out of Firestore into a complete map.
 *
 * A value that names none of the three sources — `undefined`, a string, `{}`,
 * `{ nonsense: true }` — is a document that has never been narrowed, and reads
 * as all three. A value that names *any* of them is an explicit choice and is
 * honoured exactly, with the sources it does not name reading as `false`.
 *
 * That one distinction is the whole of this function, and it is why the writer
 * must always write all three keys. See the note on `FINANCE_SOURCES`.
 */
export function parseFinanceScopes(value: unknown): FinanceScopes {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const narrowed = FINANCE_SOURCES.some((key) => key in source);
  if (!narrowed) return allFinanceScopes();
  return Object.fromEntries(
    FINANCE_SOURCES.map((key) => [key, source[key] === true]),
  ) as FinanceScopes;
}

/**
 * Whether this person sees one part of the church's money.
 *
 * ---------------------------------------------------------------------------
 * ## `superadmin` short-circuits the door and deliberately not the source
 *
 * This read `if (claims?.superadmin === true) return true;` on its first line,
 * like every other check on this site, and that made the feature untestable and
 * — as reported — apparently broken: **only a superadmin can reach /access**, so
 * the first person to narrow anybody is narrowing themselves, and the screen
 * then showed them everything anyway.
 *
 * The short-circuit now lives where it belongs, in `canAdminScreen` on the line
 * below: a superadmin always passes the `finance` *door* and never has to be
 * given it. What they do not automatically pass is the source, because the
 * sources are not really a permission — they are the answer to "which part of
 * this do you look after", and a superadmin is as entitled to answer it as
 * anybody.
 *
 * Nothing is lost by default. A member document with no `financeScopes` reads as
 * all three (see `FINANCE_SOURCES`), which is every superadmin who has never
 * touched the rows, and the ones who have can untick their way back in two
 * clicks. `firestore.rules` is untouched by this and still serves a superadmin
 * every document — so this is the one place on the site where the browser is
 * deliberately *stricter* than the policy, and it is a preference rather than a
 * refusal.
 * ---------------------------------------------------------------------------
 */
export function canSeeFinanceSource(
  claims: { superadmin?: boolean } | null | undefined,
  screenAdmin: ScreenAdmin | null | undefined,
  scopes: FinanceScopes | null | undefined,
  source: FinanceSource,
): boolean {
  if (!canAdminScreen(claims, screenAdmin, 'finance')) return false;
  return (scopes ?? allFinanceScopes())[source] === true;
}

/** Which sources this person may see. Empty means the finance screen is bare. */
export function financeSourcesFor(
  claims: { superadmin?: boolean } | null | undefined,
  screenAdmin: ScreenAdmin | null | undefined,
  scopes: FinanceScopes | null | undefined,
): FinanceSource[] {
  return FINANCE_SOURCES.filter((source) => canSeeFinanceSource(claims, screenAdmin, scopes, source));
}
