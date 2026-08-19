# Decisions

Running log. Resolved items say what was chosen and what it cost, so a future
reader can tell a considered trade-off from an accident.

---

## Resolved

### 1. Prayer request privacy — **Option A, Firestore at-rest encryption**

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

**Revisit if:** the parish ever wants to promise true confidentiality. That's a
schema migration, but the `body` field is deliberately a single opaque string,
so it's a contained one.

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

- `weeklyannouncements` — separate Firebase project, **read only**, mirrored into
  our `announcements` collection.
- Taksis — **write only**, receiving pending vehicle registrations.

Shared plumbing is built
([`functions/src/external/secondaryApp.ts`](../functions/src/external/secondaryApp.ts));
both syncs are unimplemented pending schemas. See
[`docs/integrations.md`](integrations.md).

**Still open, and consequential:**

- **Is the Taksis store Realtime Database or Firestore?** "A root branch in the
  database" sounds like RTDB. This changes the admin API *and* how write-only is
  enforced (RTDB security rules vs. Firestore IAM). Blocked on a walkthrough.
- **Dedupe under write-only.** A create-only identity can't check for an existing
  record or use a transaction. Either dedupe on the Taksis side, use a
  deterministic id (which needs `update` too, slightly widening the role), or
  grant read access and give up write-only. Genuine trade-off.
- **Does Taksis already do vehicle registration?** Flagged in the original
  requirements, still unverified, and now more urgent: if yes, writing to their
  branch may be the entire feature and our `vehicles` collection becomes a local
  cache rather than the source of truth.

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

## Out of scope

- App Clips / Android Instant Apps (NFC, TapTag hardware). Vehicle registration's
  form + Firestore write is in scope; App Clip packaging is not.
- ~~Taksis integration beyond a deep link.~~ — superseded, see #9 above.
