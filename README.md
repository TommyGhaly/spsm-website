# SPSM — website, app, and shared backend

**SPSM is St. Philopater Mercurius & St. Mina Coptic Orthodox Church**, Wayland,
Massachusetts. Written down because the acronym reads plausibly as several other
saint pairings, and it had been expanded wrongly throughout this repo until
2026-08-07. Use the full name in anything a parishioner will read.

Migration of spsmwayland.org off Wix onto Firebase, plus a companion PWA. One
Firebase backend, two frontends, one shared data layer.

## Current state

Live Firebase project (`spsm-database`, Firestore in `us-east1`), rules and
indexes deployed, and a website that builds against it. Firestore is still
empty, so every page renders its "nothing published yet" state.

```
packages/shared/         # imported by both frontends and by Functions
  src/collections.ts     # every Firestore path, in one place
  src/roles.ts           # role tiers + capability groups (custom claims)
  src/config.ts          # env boundary; public config vs. server secrets
  src/schema/            # document shapes
  src/payments/          # PaymentProvider interface — Square behind a seam
apps/website/            # Next.js static export — home, sections, calendar
  src/lib/content.ts     # build-time Firestore reads
functions/               # Cloud Functions; Square webhook is still a 503 stub
  src/external/          # cross-project plumbing (announcements, Taksis)
firestore.rules          # the actual authorization policy
firestore.indexes.json   # composite indexes for the known queries
scripts/verify-scopes.mjs # proves the credentials work AND are scoped right
docs/api-keys.md         # ← start here: how to get the keys you need
docs/decisions.md        # what's settled, what isn't, and why
docs/integrations.md     # the two external Firebase projects
```

Not yet created: `apps/app` (the PWA). Declared as a workspace so it slots in
without restructuring.

### Credentials

All present except Tithe.ly, which is awaiting an API access request. Check them
against the live services at any time:

```bash
npm run verify:scopes
```

That is not a formality. It caught a wrong `ANNOUNCEMENTS_DATABASE_ID`, and it
is the only thing standing behind the claim that the Taksis key genuinely cannot
read Taksis's data.

## Getting started

```bash
npm install && npm run dev
```

The website comes up at <http://localhost:3000>, against the real Firestore and
the real announcements project. Credentials are already in `.env`.

[`docs/local-dev.md`](docs/local-dev.md) covers the rest — what runs where, and
the three-way split between `.env`, the `config/integrations` document, and
Secret Manager.

## Design notes

**Firestore is the source of truth.** Content is written once and rendered by
both the website and the app. Nothing is duplicated between them, which is why
the schema lives in a shared package rather than in either frontend.

**Authorization is in the rules, not the UI.** Hiding a button is a convenience.
[`firestore.rules`](firestore.rules) is the policy. Roles come from Auth custom
claims and are never read from a Firestore document — a member who could edit
their own profile could otherwise promote themselves.

**Two auth axes.** `role` is a linear tier (`member` < `servant` < `staff` <
`admin`). `groups` are cross-cutting capabilities (`clergy`, `prayerTeam`,
`bookstore`, `parking`). Clergy aren't "more staff than staff" — they hold a
different key. Keeping these separate is what lets clergy-only prayer requests
stay closed to a facilities coordinator who is legitimately `staff`.

**Money is integer cents plus a currency**, never a float or a formatted string.
Square's API works the same way, so the boundary stays lossless.

**Orders are written only by Cloud Functions** reconciling verified Square
webhooks. If the client could write to `orders`, a member could mark their own
order paid.

## Next steps

**Two console actions are blocking work** — neither can be done from the CLI:

- [x] ~~Upgrade to Blaze.~~ Done. Functions deploy. **Still set a budget alert**
      if you haven't — this workload will not leave the free tier, but an alert
      is the cheap insurance.
- [ ] **Authentication → Sign-in method → enable Email/Password** (and Google).
      The Identity Toolkit API is on, so the project *looks* configured, but the
      provider itself is off: a sign-in attempt returns
      `PASSWORD_LOGIN_DISABLED`. Prayer requests, member profiles, and orders
      all need a signed-in user. `npm run verify:scopes` reports this.
- [ ] **Storage → Get started.** `firebase deploy --only storage` fails until
      the bucket exists.

Then:

- [ ] Behavioural rules tests (`@firebase/rules-unit-testing`). This is no
      longer hypothetical: `rules:check` passed a policy that denied *every*
      public list query, and it took building a page against the live project to
      notice. See decision #10. The cases worth pinning down first: a `staff`
      user must be denied on a clergy-only prayer request, an anonymous
      submission must not be writable with a uid attached, and every query the
      website actually issues must be allowed.
- [ ] Scheduled publisher Function — flip `published` when `publishAt` arrives,
      then trigger a rebuild. Until it exists, `publishAt` does nothing.
- [ ] Seed real parish content into `content`, then retire the Wix pages.
- [x] ~~Weekly bulletin on the site.~~ Read directly from the announcements
      project at build time — no copy in our Firestore, no scheduled Function.
      Note the consequence: that source overwrites itself weekly, so **no
      history is kept anywhere**. See `docs/integrations.md`.
- [ ] Rebuild-on-publish. The site is only as current as its last build, and
      the bulletin changes weekly, so something has to trigger a deploy — a
      scheduled build is the simplest version.
- [ ] Decide whether the bulletin's `days[].events[]` should also populate
      `events`. Right now the homepage shows the week from the bulletin and the
      calendar from `events`; once staff start adding events, the same liturgy
      can appear twice. See `docs/integrations.md`.
- [ ] Square: replace the **sandbox** values now sitting in Secret Manager with
      production ones at go-live (`firebase functions:secrets:set`). They were
      set from `.env` only so the webhook stub could deploy — `SQUARE_ENVIRONMENT`
      is still `sandbox`, and `npm run verify:scopes` reports which is in use.
- [ ] Scaffold `apps/app` (the PWA).
- [ ] DNS inventory before touching the registrar: capture the Microsoft 365
      MX/SPF/DKIM records *first*. Breaking parish email is the one
      unrecoverable mistake in this migration.
