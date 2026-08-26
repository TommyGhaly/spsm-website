# Decisions

Running log. Resolved items say what was chosen and what it cost, so a future
reader can tell a considered trade-off from an accident.

---

## Resolved

### 1. Prayer request privacy — ~~Option A~~ → **superseded 2026-08-26: application-level encryption**

Bodies are stored as plaintext in Firestore. Confidentiality comes from
[`firestore.rules`](../firestore.rules), not cryptography.

**Why:** clergy need to actually read and follow up on prayer requests. True
end-to-end encryption would have required distributing keys to clergy anyway —
which reintroduces the same trust boundary while giving up search,
server-side notifications, and any hope of recovering data after a lost key.

**What it costs — state this plainly in the submission UI, don't paper over it:**
- Anyone with the Firebase service account can read every request.
- So can a Firestore console admin.

**Mitigations built in:**
- `visibility: 'clergy'` requires the `clergy` group or `admin` — the `staff`
  tier alone is not sufficient. A facilities coordinator cannot read them.
- `anonymous: true` genuinely omits the uid rather than hiding it behind a flag,
  so an anonymous request cannot be traced later. The trade-off is that the
  submitter can't edit or withdraw it either.
- `auditLog` collection exists for recording staff reads of sensitive data.

~~**Revisit if:** the parish ever wants to promise true confidentiality.~~ —
**the parish asked, on 2026-08-26.** Everything above is history; read it for the
reasoning, not the current state.

**What ships now.** `body`, `authorName` and `contactEmail` are AES-256-GCM
envelopes sealed under `PRAYER_KEY` in Secret Manager. Firestore holds
ciphertext. The prediction in the sentence above held exactly: `body` was one
opaque string and became one sealed string, so the migration was contained.

`authorName` is sealed too, which the original decision did not anticipate — on a
commemoration the name *is* the disclosure, because it says someone has died and
who. `kind`, `commemoration`, `visibility` and the timestamps stay readable so a
priest can filter to "forty days" without decrypting the collection.

**Both directions are Cloud Functions.** Sealing needs the key and a key in a
browser is not a key, so the write moved to `prayerSubmit`. Reading moved to
`prayerList` for a less obvious reason: a clergy member could previously read a
request in the Firestore console, and after sealing they cannot, so encrypting
without building a read path would have made the feature confidential and
useless. `firestore.rules` now closes the collection to clients in both
directions.

**What did NOT change, and is still the honest limit.** Whoever holds the
Functions service account can decrypt. The objection this decision was originally
built on — clergy must be able to read these, so somebody must hold a key — is
still true and is still why true end-to-end was not chosen. What changed is that
the *database* is no longer a place the plaintext exists. `PrivacyDisclosure.tsx`
says exactly this to the person before they type, and must not be softened into
promising secrecy from the parish's own administrators.

**The new risk this creates:** losing or rotating `PRAYER_KEY` orphans every
request sealed under the old version. `prayerSubmit` proves the key round-trips
before it will store anything, because sealing under a key that cannot open is
the one failure here with no recovery.

### 6. Frontend stack — **Next.js with `output: 'export'`**

Static export to Firebase Hosting. Rules out server components / ISR / route
handlers; API work goes in Cloud Functions instead. Buys real SEO on the public
pages and free offline behaviour for the PWA.

### 7. Repo layout — **npm workspaces monorepo**

`packages/shared` holds the Firestore schema, roles, and provider interfaces so
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

## Out of scope

- App Clips / Android Instant Apps (NFC, TapTag hardware). Vehicle registration's
  form + Firestore write is in scope; App Clip packaging is not.
- ~~Taksis integration beyond a deep link.~~ — superseded, see #9 above.
