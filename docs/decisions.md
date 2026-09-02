# Decisions

Running log. Resolved items say what was chosen and what it cost, so a future
reader can tell a considered trade-off from an accident.

---

## Resolved

### 1. Prayer request privacy — **withdrawn 2026-08-27: the feature is gone**

The parish no longer takes prayer requests through the site, so there is nothing
left for this decision to govern. The route, the form, `prayerSubmit`,
`prayerList`, the sealing helper, the `prayerRequests` rules block and its index
have all been removed, and `scripts/remove-prayer-requests.mjs` deletes the
stored data and the `forms/prayer-requests` definition.

Kept as a record because two of its conclusions outlived it and are worth not
re-deriving:

- **A choice between one real audience and one that does not exist is worse than
  no choice.** The original `visibility` field offered `public`, described as
  "the prayer team and congregation". The parish has no prayer team, and the
  option implied a congregation would read what somebody wrote. `prayerTeam` is
  gone from `GROUPS` for the same reason.
- **Encrypting without building a read path makes a feature confidential and
  useless.** Sealing the bodies forced *both* directions through Cloud
  Functions, because a clergy member who could previously read a request in the
  Firestore console could no longer do so afterwards. Any future feature that
  seals what it stores inherits that obligation.

The honest limit it never resolved, also worth keeping: whoever holds the
Functions service account can decrypt. Clergy had to be able to read these, so
somebody had to hold a key, which is why true end-to-end was never on the table.

### 6. Frontend stack — **Next.js with `output: 'export'`**

Static export to Firebase Hosting. Rules out server components / ISR / route
handlers; API work goes in Cloud Functions instead. Buys real SEO on the public
pages and free offline behaviour for the PWA.

### 7. Repo layout — **npm workspaces monorepo**

`packages/shared` holds the Firestore schema, the authorization model, and the
provider interfaces so
the website and the app cannot drift on the two things that matter most —
schemas and security rules. (npm workspaces rather than pnpm: npm 10 is already
on the machine, one less dependency.)

---

## Open

### 2. Tithe.ly API — scope now checked against the docs

Docs reviewed. What's actually reachable:

- **Recurring / scheduled giving — yes.** The Giving API's transaction endpoint
  takes a `recurring` parameter (`start_date`, `term`). Test base
  `https://tithelydev.com/api/v1/`, live `https://tithe.ly/api/v1/`. Auth is a
  public/private key pair: the public key tokenizes a card in the browser via
  `tithely.js`, the private key stays in Cloud Functions.
- **People / groups / calendar — only via ChMS (Elvanto).** Separate product,
  separate base URL (`https://api.elvanto.com/v1/`), separate auth (API key as
  the HTTP Basic *username*, or OAuth2). Categories: People, People Flows,
  Groups, Services, Songs, Calendar, Financial.
- **Forms — no API, in either product.** Neither reference exposes a forms
  resource. Tithe.ly Forms can be embedded or linked but not read or created
  programmatically.

**Consequences.** Anything that needs form submissions server-side (registrations,
sign-ups) has to be built natively against our own Firestore — which is roughly
where the schema work already points, so this is a confirmation rather than a
setback. Giving stays an embed/link on the critical path regardless; the API only
buys us reading schedules back.

**Still open, and both are questions for the parish, not the docs:**

1. Is the parish on ChMS at all, or Giving-only? Decides whether 5b in `.env`
   is ever populated.
2. API access is **by request** — email support@tithe.ly describing what we're
   building, then generate keys at `https://tithe.ly/api-setup`. Needs both a
   test and a live Tithe.ly account, with live keys issued separately at go-live.
   Nothing here is buildable until that request is granted.

**Unverified caveat worth raising with support in the same email:** a
third-party integration note claims API key access was removed in Tithe.ly 3.0.
That was written about a different product's integration and may not apply, but
if it does, it changes this entire entry — so ask before building.

Variables are staked out in `.env` §5 and blank until the above resolves.

**Settled 2026-08-26 — giving is live, and it is not an API integration.** The
give action on `/giving` and on the homepage band opens the parish's hosted
Tithe.ly form (`44f1af1b-…`) in an overlay iframe on our own page. Nothing above
is unblocked by it: the payment is still Tithe.ly's, and no key is involved.

Two things about it are worth knowing before touching that code:

- **Tithe.ly's own `give.js` is not used, deliberately.** Its second statement
  bails to `window.open(url, '_blank')` when the browser is Chrome or Safari, or
  the viewport is under 768px — which is nearly every visitor. Their documented
  "modal" embed is a new tab for almost everyone.
- **So the iframe is ours, which overrides that decision.** `?context=modal` is
  still Tithe.ly's own framed mode and `give.tithe.ly` sends no framing headers,
  the form renders and behaves inside the frame, and `allow="payment"` delegates
  the wallet APIs that are the likeliest reason for the gate. But a card entered
  through a path the vendor avoids can fail in ways we never see, so the overlay
  always offers "open in a new tab instead", and **a real gift must be completed
  through the overlay on both Safari and Chrome before the cutover.** That test
  is outstanding.

The form id is committed in `features/giving/config.ts` rather than kept in
`.env`; see the note there for why.

### 3. App Store presence

Does "app" mean a listed native app, or does an installable PWA satisfy it? The
PWA path is already in scope; this only decides whether a React Native shell
gets added later.
**Next action:** confirm with whoever asked for "an app."
**Note:** this is worth settling early — an installable PWA covers most of what
parishioners mean by "app," and a store listing adds an Apple Developer account,
review cycles, and a release process for very little functional gain.

### 4. Build team size

Determines phasing vs. parallel work. Solo ⇒ ship core site + PWA first, layer
in bookstore / Microsoft auth after.

### 5a. Square integration path — Checkout Links vs. Web Payments SDK

Deferred deliberately. Both are implementations of `PaymentProvider` in
[`packages/shared/src/payments/provider.ts`](../packages/shared/src/payments/provider.ts),
so the choice costs a file swap rather than a rewrite of the cart, order schema,
or webhook handler.
**Leaning:** start with Checkout Links. A parish bookstore sells a handful of
items; a redirect to a Square-hosted page that already handles PCI, Apple Pay,
and card errors is worth more than a slightly more native feel.

### 5b. Product catalog source of truth — Square vs. Firestore

`Product` works either way: `squareCatalogObjectId` + `syncedAt` present means
mirrored from Square and read-only; both null means Firestore is authoritative.
**Leaning:** mirror from Square. You're already admin there, staff already know
that UI, and it avoids maintaining a second inventory system.

### 10. `publishAt` is a scheduling instruction, not a read-time filter

**Found by building the website against the live project, 2026-08-07.** The
original public-read rule was:

```
published == true && (publishAt == null || publishAt <= request.time)
```

It compiled. `npm run rules:check` passed. It denied every public list query in
existence — including against an empty collection.

Firestore evaluates a `list` against the query's *potential* result set, not the
documents actually returned, so it must prove from the query constraints alone
that nothing disallowed could come back. `where('published','==',true)` proves
the first clause and says nothing about the second. Measured:

| query | result |
|---|---|
| `where('published','==',true)` | permission-denied |
| `where('published','==',true)` + `where('publishAt','==',null)` | allowed |

The second row is the real danger. It is the only query the old rule admitted,
and it permanently excludes every document that has a `publishAt` — including
long after that time has passed. Scheduled content would simply never appear,
with no error anywhere.

**Decided:** `published` is the switch. `publishAt` is an instruction to a
scheduled Cloud Function that flips `published` to `true` when the time arrives.

**Why this is the right shape anyway, not just a workaround:** the public site
is a static export. A page going live requires a rebuild, and no read-time rule
can trigger one. Scheduling therefore *has* to be a server-side action that
changes data and redeploys — which is exactly what the Function does. The old
rule could never have worked even if Firestore had allowed the query.

**Consequences:**
- A future `publishAt` with `published: true` is now an inconsistent state — the
  document is publicly readable while the site withholds it. `withoutEmbargoed`
  in `apps/website/src/lib/firestore.ts` reports it at build time.
- The scheduled publisher Function does not exist yet. Until it does,
  `publishAt` does nothing and staff must flip `published` by hand.

**The wider lesson, worth acting on:** this is precisely the failure the README
predicted — "a syntax-clean policy can still be wrong." A compile check cannot
find it. Behavioural rules tests would have, on day one.

### 8. Recurring events

`Event.recurrence` is typed `null` for MVP — weekly liturgies are the obvious
use case, but recurrence rules (RRULE, exceptions, per-instance edits) are a
genuine project. MVP: staff create individual entries, possibly via a bulk
helper.

---

### 9. Cross-project integrations — **superseded §6 of the requirements**

The requirements doc says "no deep integration with Taksis — linked via deep link
only." That is **no longer true.** Two external Firebase projects are now in
scope:

- `weeklyannouncements` — separate Firebase project, **read only**. Read
  through, never mirrored: one source of truth, no copy to fall behind, no
  `syncedAt` to reason about. Read from two places now — the build, and the
  `bulletin` Function (decision #12).
- Taksis — **write only**, receiving pending vehicle registrations. **Live since
  Aug 25 2026**, and it is now the *only* home for a registration: `/parking` and
  `/forms/vehicle-registration` write there and nowhere else. Our own `vehicles`
  collection is no longer written to at all.

Shared plumbing is built
([`functions/src/external/secondaryApp.ts`](../functions/src/external/secondaryApp.ts)).
See [`docs/integrations.md`](integrations.md).

**All three resolved, Aug 25 2026.** Kept rather than deleted, because each one
was answered by a fact rather than a preference and the fact is the useful part.

- ~~**Is the Taksis store Realtime Database or Firestore?**~~ — **Firestore.**
  Not inferred from the `datastore.*` permissions this time but demonstrated: a
  working standalone form has been writing these records through the Firestore
  REST API. The record shape came from the same place and is pinned in
  `packages/shared/src/schema/taksis.ts`.
- ~~**Dedupe under write-only.**~~ — **`add()`, and accept duplicates.** A
  deterministic id would be idempotent but needs `update`, which the account does
  not have and which widens the role; and we cannot read to check first. So a
  double-tap makes two pending registrations for one plate, which Taksis's review
  queue can see and dismiss. A duplicate in front of a person beats a silent
  failure in nobody's logs.
- ~~**Does Taksis already do vehicle registration?**~~ — **Yes, and writing to
  their collection is the entire feature.** This went further than the sentence
  anticipated: `vehicles` is not a local cache either, it is simply no longer
  written. Tommy chose Taksis-only knowing an outage loses the submission,
  against the alternative of two lists of who may park here that disagree six
  months later. The obligation that comes with it — a failure must be *visible*,
  never a confirmation screen for a write that did not land — is met in
  `functions/src/forms/taksis.ts`.

---

### 11. Livestream archive freshness — **a scheduled job, and it deploys `main`**

`archive.json` stopped being fetched at build time (see the header of
[`features/livestream/data.ts`](../apps/website/src/features/livestream/data.ts)),
which fixed the empty-archive-on-a-throttled-deploy failure and replaced it with
a quieter one: the twelve services on `/livestream` are only as current as the
last time somebody ran `npm run archive` and committed the result. Nothing on
the page looks stale when it is stale — the dates are real, just old.

[`.github/workflows/refresh-archive.yml`](../.github/workflows/refresh-archive.yml)
runs the command at 06:20 UTC daily and commits the file if it moved.

**Daily rather than weekly**, which was the first instinct and is wrong: the
parish streams most days and twice on many of them, so twelve slots turn over in
roughly eight days. A weekly job is slower than the thing it is tracking. The
cost is thirteen requests a day, against the many-per-day that got the old
build-time fetch throttled.

**What it costs, and this is the part to decide on rather than discover:**

- **The deploy job publishes whatever is on `main`.** A static export cannot
  rebuild one page, so an archive refresh drags every other unpublished commit
  onto the live site with it. "Keep `main` deployable" stops being a convention
  and starts being enforced nightly.
- **It needs most of `.env` mirrored into Actions secrets**, because the pages
  that cannot reach their configuration degrade silently — `lib/config.ts` falls
  back to the committed defaults with a warning, and the bulletin removes itself.
  A robot deploying from a half-populated secret store ships a smaller site than
  a laptop does. The Firebase web config and the announcements key are guarded
  with a hard failure before the build; the rest are not.
- It is off until `FIREBASE_SERVICE_ACCOUNT` exists. The refresh half needs no
  credential and runs regardless, so until then the snapshot lands in git and
  ships with the next manual deploy, and the run summary says exactly that
  instead of letting the absence look like success.

**Revisit if:** the archive ever needs to be current to the hour rather than the
day. That is a different design — a Function caching the feed, with the page
reading it client-side — and it is not worth a service for twelve links.

---

### 12. The homepage schedule follows `config/active_bulletin`, at request time

Two changes, and the first is the one that was actually wrong.

**Which bulletin.** The rule was "sort `bulletins` by week, take the newest",
written when that collection was documented as a singleton the source app
overwrites weekly. It is not one: it holds the active week *plus* whichever
future week staff have started drafting. So on 2026-08-20 the homepage was headed
"August 24, 2026" and listed an unpublished draft, while the screen in the
narthex showed August 17.

The announcements app records its own answer in `config/active_bulletin` — one
field, an id in `bulletins` — and the site now follows it. Nothing about the
dates is used, deliberately: a bulletin is a schedule somebody publishes, not a
calendar range, and the parish is entitled to leave last week's up over a feast
or put next week's up early. Deriving the week from `days[]` overrules that
decision, and `lastPublished` gets the common case right while still being
capable of disagreeing with the narthex.

**When it is read.** Decision #11 above ends by naming the shape this takes — "a
Function caching the feed, with the page reading it client-side… not worth a
service for twelve links." It is worth a service for the bulletin, and the
difference is what the staleness costs. Twelve stale archive links are a page
less complete than it could be. A stale schedule sends somebody to church at the
wrong hour, and does not look stale while doing it.

So `/api/bulletin` is a Hosting rewrite onto the `bulletin` Function, and the
section re-asks it on load, on every return to the tab, and once a minute while
the tab is being looked at. The browser cannot make this read itself — the
bulletin is in another Firebase project, so it needs that project's
service-account key, which is exactly what must not ship to a browser. That
constraint, not a preference, is what makes it a Function.

**The read itself lives in
[`packages/shared/src/bulletinSource.ts`](../packages/shared/src/bulletinSource.ts)
and is imported by both callers.** If the build and the live check ever resolved
"the active bulletin" differently, the homepage would change week a moment after
load, for no reason a reader could see and with nothing in either codebase
looking wrong.

**What the build still does:** it bakes in whatever was active at deploy, and
that is what paints first. The live check then replaces it — and *only* replaces
it. A null answer, a 502, a 503, an offline reader: all leave the week on screen
alone. A section that can empty itself mid-visit takes a band's worth of height
out from under whatever the reader is looking at, and for a switched-off section
the old behaviour was already "gone at the next deploy" rather than "gone now".

**The costs, stated rather than discovered:**

- **A second home for the key.** `ANNOUNCEMENTS_SERVICE_ACCOUNT` is now needed in
  Secret Manager as well as in the build environment. Missing there, the endpoint
  answers 503 and the page keeps its built-in week — which looks exactly like
  nothing being wrong. First thing to check after a deploy.
- **Reads per reader rather than per build.** `s-maxage=30` on the response is
  what keeps a Sunday morning's arrivals from becoming a Sunday morning's worth
  of reads against the announcements project.
- **A client component on the homepage.** The section's contents, heading
  included, now render in the browser. The heading had to move with them:
  `weekLabel` comes out of the same document as the days, and refreshing one
  without the other shows the new week's services under the old week's date.
- **`today` became a prop.** A static export prerenders client components too, so
  reading the clock inside one gives the day of the deploy on one side of
  hydration and the day of the visit on the other. It is read on the server page
  and passed down, which keeps the "Today" flag the build-time value it always
  was. See `todayInParish`.

**Revisit if:** anything else needs request-time freshness. Two such endpoints is
a pattern worth naming; one is a section with an unusual cost of being wrong.

---

### 13. Authorization — **one claim, one allocation; the role ladder is gone**

**Chosen 2026-08-31, at Tommy's direction:** *"get rid of the roles — I want
everyone who signs in to have access to the servants calendar, and every other
privilege is allocated in the admin manager."*

**What went.** The `role` tier (`member < servant < staff < admin`) and the
cross-cutting `groups` claims (`clergy`, `bookstore`, `parking`). Both were
custom claims. `packages/shared/src/roles.ts` is now `claims.ts`, the
`setMemberRole` callable is deleted, and `components/AdminGate.tsx` — a gate that
took a `Role` and had not been imported since /admin was rebuilt as a hub — went
with them.

**What replaced it.**

| | Where it lives | Lag |
|---|---|---|
| Signing in | nothing to store | none |
| An allocation — `screenAdmin`, `programAdmin` | the member document | none |
| `superadmin` | a custom claim, set by `scripts/grant-admin.mjs` | up to an hour |

Signing in is Microsoft-only and restricted to the parish's Entra tenant, so
authenticating at all means being clergy, staff or a servant of this church.
That is now the whole qualification for the servants' rota — `servantEvents` is
`allow read: if signedIn()` — and it buys nothing else. Every other privilege is
a row on /access.

**Why `superadmin` may be a claim when the allocation may not.** A grant changes
in the course of ordinary work, and one that took an hour to arrive would be
reported as broken every time it was used; the maps are therefore on the member
document, read by `firestore.rules` with a `get()`. `superadmin` is set once, by
hand, from a terminal — and it *has* to be the thing that is not grantable from
a screen, because it is the power to grant everything else.

**The costs, stated rather than discovered:**

- **Storage rules cannot read Firestore.** So a bucket rule cannot ask whether
  somebody holds the `events` flag, which would have left every hero image, form
  picture and product photo writable only by a superadmin — or by anyone signed
  in, which is worse. A `screens` claim now mirrors the map, maintained by
  `mirrorGrantsToClaims` (a `members/{uid}` write trigger), read by
  `storage.rules` and **by nothing else**. It lags by a token refresh, so
  `useScreenGrants` compares it against the document it has just read and forces
  a refresh when they disagree. If that comparison is ever removed, the symptom
  is precise and baffling: the person granted Events can create the event and
  cannot upload its photograph.
- **Every Function-side check became a Firestore read.** `httpAuth.ts` answered
  everything from the token because `role` was a claim; there is no role, so
  `mayManageOrders` and `mayReadFinance` are now async wrappers around one
  `mayAdminScreen`. One billed read per privileged call, on calls that are
  already talking to Square over the network — and the point of it is that the
  Functions and the rules decide from the same map.
- **`submissions/` in the bucket widened from `staff` to any signed-in
  account**, and this is the one place the change is a real loosening. Who may
  review a submission is a *program* grant, and the prefix is keyed by
  `programEventId` — a Firestore lookup this file cannot make. `staff` was no
  narrower in kind (it admitted the bookstore volunteer too) and it excluded the
  program leads who actually do the work, so every row showed "no preview". The
  property that mattered is intact: a submitter is anonymous.
- **`products` lost its broad write rule**, which is the one place the change
  made a rule *narrower*. Firestore ORs matching rules, so the old
  `allow write: if hasRole('staff')` beside the bounded `section`-only block
  meant the validation never ran for staff. Promoting shop volunteers into that
  broad line would have let a browser rewrite every price in the catalogue, so
  the line went instead — nothing needed it, since the Square mirror uses the
  Admin SDK.
- **The `members` read narrowed to `isSelf(uid) || isSuper()`.** It was
  `hasRole('staff')`, which handed the whole administrative tier everybody's
  phone number for no caller that wanted it.
- **Rules tests needed their own emulator projects.** A permission is a document
  now, so one suite's `clearFirestore()` landing mid-run in another silently
  revokes every grant in it — 282 passing sequentially, 254 in parallel, before
  `createTestEnv` took a suite name.

**What did not change:** the program-grant axis (`programAdmin`), which was
already a document rather than a claim and was already the model this decision
generalises; `campRegistrations`, which is still gated on a program grant and
must never admit the `finance` flag; and the two undelegable screens, `members`
and `config`.

**Revisit if:** the parish wants more than one or two superadmins, or wants the
role of granting to itself be delegable. Both are one flag away and both give up
the property that makes this arrangement safe.

### 14. Forms — **two the church always has, and the rest can be somebody else's**

Three changes on 2026-09-01, all from the same conversation, plus one bug each
that only a signed-out browser could have found.

**The contact form and the vehicle registration are permanent.** Both addresses
are printed on things this codebase cannot reach — an NFC tag and a card in the
car park, every "ask the church office" link on the site and on the parish's
stationery — so neither may depend on a Firestore document existing. Their
definitions live in `packages/shared/src/schema/builtInForms.ts`; the seeder
writes them, the hub merges them into every render, and `/forms/<slug>` falls
back to them when the document is missing or unreadable. Delete is withheld in
the drawer, refused in `deleteForm`, and refused by `firestore.rules` — the last
of those being the one that holds. Everything else about them stays editable:
blurb, picture, notification address, questions, confirmation.

*What it costs:* two documents in a collection whose whole point is that the
office manages it without a deploy, and a rule naming them by id. The
alternative — accepting that a mis-click at eleven at night can 404 a printed
tag — is worse.

**`kind: 'embed'` replaces the Breeze field importer.** The old importer copied
a Breeze form's questions across as a native draft, through a Function holding
`BREEZE_API_KEY` — a credential that reads the whole member database. What the
parish actually wanted was the *form* on a *parish page*: an address, framed
under our masthead with our photograph, an "open in a new tab" link above it
because a framed page can always refuse, and a line under it naming the host.
Tithe.ly and Breeze both send no `X-Frame-Options` and no CSP
`frame-ancestors`, which is what makes this possible; `give.tithe.ly` gets
Tithe.ly's own `context=modal` and no other host is touched.

*What it costs:* **nothing an embedded form collects reaches this project.** No
submissions row, no notification, no total. That is not a shortcoming of the
implementation — Tithe.ly has no forms API at all (§2) and Breeze's is
read-and-delete — and the form list, the builder and the page each say so. The
importer was removed with the last user of `BREEZE_API_KEY`; **that key can now
be revoked in Breeze.** The parish calendar is unaffected: it scrapes the public
embed token and has never used the API.

**Servants sign themselves up for camp; families are still registered by the
camp.** `/forms/summer-camp` shows a public form to anybody who opens it — no
account, because half the camp's servants are teenagers who have never signed in
to anything of the parish's. It posts to `campServantRequest`, which takes the
season and the ministry from `config/camp` rather than from the request, clears
the safeguarding flag and the assigned roles whatever was sent, and writes to
`campServantRequests`. That collection is closed to every client:
**accepting a sign-up is what writes the registration**, from the accepting
administrator's own browser, under their own uid. Family registrations, and the
children's medical notes they carry, never left the program grant.

One switch was delegated with it. `servantSignUp` on `config/camp` is writable
by a camp administrator through a one-key widening in the rules, because opening
and closing the list is a decision the camp makes several times a season and
`config` is otherwise superadmin-only and deliberately undelegable.

*What it costs:* a queue somebody has to clear, and an open endpoint with a
per-instance rate limit rather than a real one. App Check is the next step if it
is ever needed; it is already initialised for the browser SDK.

**Two bugs, both invisible while signed in.** `readFormBySlug` reads the exact
document id first and falls back to a query on `slug`. For a visitor the `get`
on a missing id *throws* — the public rule dereferences `resource.data`, which
is an evaluation error on a null resource, and an error denies — so the fallback
never ran; and the fallback query itself could return a draft, so it was refused
as unprovable (decision #10 again). Staff never saw either, because their second
`allow read: if hasScreen('forms')` answers without touching `resource`. Both
are fixed and both now have rules tests. Separately, `useCampAdmin` returned the
*committed defaults* to anyone signed out, which on a newly public page meant
the wrong season and a waiver that never appeared; it reads `config/camp` for
everybody now, which costs one world-readable document.

---

## Out of scope

- App Clips / Android Instant Apps (NFC, TapTag hardware). Vehicle registration's
  form + Firestore write is in scope; App Clip packaging is not.
- ~~Taksis integration beyond a deep link.~~ — superseded, see #9 above.
