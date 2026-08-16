# SPSM — website, app, and shared backend

**St. Philopater Mercurius & St. Mina Coptic Orthodox Church**, Wayland,
Massachusetts. Migration of [spsmwayland.org](https://spsmwayland.org) off Wix
onto Firebase, plus a companion PWA — one backend, two frontends, one shared
data layer.

> The acronym reads plausibly as several other saint pairings, so use the full
> name in anything a parishioner will see. St. Philopater Mercurius is also
> known as Abu Sefein; the same saint may appear under either name in parish
> content.

## Quick start

```bash
npm install && npm run dev
```

The website comes up at <http://localhost:3000>, reading the real Firestore and
the real announcements project. You need `.env` — it is gitignored and not in
this repo; copy `.env.example` and fill it in, or get the existing one from
Tommy. Without it the site still builds and tells you what is missing instead of
crashing.

| Command | What it does |
|---|---|
| `npm run dev` | Website at :3000, against live Firestore |
| `npm run dev:backend` | Emulator suite — rules and Functions work only |
| `npm run build` | Everything; site lands in `apps/website/out` |
| `npm run typecheck` | All workspaces |
| `npm test` | Parsers and validators — no emulator, ~1s |
| `npm run test:rules` | `firestore.rules` against the emulator (needs JDK 21) |
| `npm run verify:scopes` | Checks every credential against the live services |
| `npm run bulletin` | Prints this week's bulletin as the build sees it |
| `npm run config` | Shows `config/integrations`; `-- --write` creates it |
| `npm run rules:check` | Compile-checks the security rules (only compiles) |

[`docs/local-dev.md`](docs/local-dev.md) has the detail.

## Layout

```
packages/shared/          imported by both frontends and by Functions
  src/collections.ts      every Firestore path, in one place
  src/roles.ts            role tiers + capability groups (custom claims)
  src/schema/             document shapes, incl. config and bulletin parsing
  src/payments/           PaymentProvider interface — Square behind a seam
apps/website/             Next.js static export
  src/features/           one folder per thing the site does; each owns its data
  src/features/*/data.ts  build-time reads — content, events, bulletin, …
  src/lib/config.ts       runtime config, read from Firestore
  src/lib/firestore.ts    safely(), docOf(), withoutEmbargoed()
functions/                Cloud Functions; Square webhook is a 503 stub
  src/external/           cross-project plumbing (Taksis)
scripts/verify-scopes.mjs proves credentials work AND are scoped correctly
firestore.rules           the authorization policy
docs/                     api-keys, local-dev, decisions, integrations
```

`apps/app` (the PWA) does not exist yet. It is declared as a workspace so it
slots in without restructuring.

## Where configuration lives

Three places, and the split is deliberate:

| | Holds | Changed by |
|---|---|---|
| `.env` (gitignored) | Firebase web config, service-account keys, Square | editing the file |
| Firestore `config/integrations` | integration endpoints, livestream, feature switches | staff, in the console — **no deploy** |
| Firestore `config/parish` | address, phone, email, office hours, service times | staff, in the console — **no deploy** |
| Secret Manager | production secrets for deployed Functions | `firebase functions:secrets:set` |

Only what you need *before* you can reach the database stays in `.env`.
Everything else is a Firestore document so it can change without a release.

**`config` is world-readable** — the website build reads it anonymously, before
it holds any other credential. A project id authorizes nothing; a
service-account key would authorize everything. Nothing secret goes there.

## Design notes

**Firestore is the source of truth.** Content is written once and rendered by
both the website and the app, which is why the schema lives in a shared package
rather than in either frontend.

**Authorization is in the rules, not the UI.** Hiding a button is a convenience.
[`firestore.rules`](firestore.rules) is the policy. Roles come from Auth custom
claims and are never read from a Firestore document — a member who could edit
their own profile could otherwise promote themselves.

**Two auth axes.** `role` is a linear tier (`member` < `servant` < `staff` <
`admin`). `groups` are cross-cutting capabilities (`clergy`, `prayerTeam`,
`bookstore`, `parking`). Clergy aren't "more staff than staff" — they hold a
different key. That separation is what lets clergy-only prayer requests stay
closed to a facilities coordinator who is legitimately `staff`.

**There is no public sign-in.** A parishioner never authenticates: the calendar,
bulletin, giving, and contact details are public, and prayer requests and
vehicle registrations are written anonymously. Sign-in is Microsoft-only and
exists for the servants schedule and the admin surface. Because only clergy,
staff, and servants have a parish M365 address, **tenant membership is the
qualification** and a first sign-in grants `servant`. `staff` and `admin` are
granted per person and never inferred. See [`docs/api-keys.md`](docs/api-keys.md) §3.

**`publishAt` is a scheduling instruction, not a read-time filter.** Gating
public reads on it compiled cleanly and denied every anonymous list query:
Firestore judges a `list` by what the query *could* return, and cannot prove a
clause the query does not constrain. `published` is the switch. See
[decision #10](docs/decisions.md).

**Money is integer cents plus a currency**, never a float or a formatted string.
Square's API works the same way, so the boundary stays lossless.

**Orders are written only by Cloud Functions** reconciling verified Square
webhooks. If the client could write to `orders`, a member could mark their own
order paid.

## Credentials

All present except Tithe.ly, which is awaiting an API access request.

```bash
npm run verify:scopes
```

Not a formality. It caught an `ANNOUNCEMENTS_DATABASE_ID` set to a project's
*display name* — which fails as a bare `5 NOT_FOUND` that reads like a missing
collection — and it is the only thing standing behind the claim that the Taksis
key genuinely cannot read Taksis's data.

Nothing secret is committed. `.gitignore` denies all `.env*` by default and adds
back only `.env.example`, and matches key material by shape (`*-key.json`,
`*.pem`, …) rather than by the specific names we happened to hit.

## Status

Done: Firebase project (`spsm-database`, Firestore `us-east1`), rules and
indexes deployed, Blaze enabled, website building, weekly bulletin live on the
homepage. **Email/Password and Google sign-in are enabled, and Storage is
turned on** — the two console actions that used to block everything else.

Worth stating plainly, because the repo reads as more finished than it is: the
*authorization* model is complete and the *authentication* half is greenfield.
Nothing imports `firebase/auth`, no Function calls `setCustomUserClaims`, and
`functions/` is a single 503 stub. Every role check in `firestore.rules` and
`storage.rules` is live policy against an identity nobody can obtain yet.

Next, roughly in order:

- [ ] **Fill in `config/parish`** — address, phone, email, office hours, and the
      regular service times. Deliberately left blank rather than guessed: a
      plausible wrong address is one nobody thinks to check. `/contact` renders
      an honest "not published yet" until it is filled in.
      `npm run config` shows the current state.
- [ ] **Point the livestream at something.** `config/integrations.livestream` —
      set `enabled: true`, pick `platform` (`youtube` / `facebook` / `custom`),
      and give a `target`. For YouTube a channel id (`UC…`) is better than a
      video id, because it resolves to whatever is live now and survives the
      video changing every Sunday.
- [ ] Write the About / Our Faith / Clergy pages into the `content` collection.
      Those routes work; they have nothing to show.

- [x] **Behavioural rules tests** (`@firebase/rules-unit-testing`). 40 of them,
      `npm run test:rules`. They cover every query the site actually issues, the
      `vehicles` write path, `orders` being unwritable even by an admin, the
      clergy-vs-staff split, and member claim-mirror immutability. Verified by
      mutation: reintroducing the `publishAt` read-time filter turns five red,
      and opening `vehicles` to public reads turns three red.
- [ ] **Rebuild on publish.** The site is only as current as its last build and
      the bulletin changes weekly, so something has to trigger a deploy.
- [ ] **Scheduled publisher** — flip `published` when `publishAt` arrives. Until
      it exists, `publishAt` does nothing.
- [ ] Seed real parish content into `content`, then retire the Wix pages.
- [ ] Decide whether the bulletin's `days[].events[]` should also populate
      `events` — otherwise the same liturgy can appear twice once staff start
      adding events. See [`docs/integrations.md`](docs/integrations.md).
- [ ] Taksis push — blocked on the shape of one `pending_registrations` record.
      We cannot read it ourselves; that is the write-only design working.
- [ ] Square: replace the **sandbox** values now in Secret Manager with
      production ones at go-live. They were set only so the webhook stub could
      deploy.
- [ ] Scaffold `apps/app` (the PWA).
- [ ] **DNS inventory before touching the registrar** — capture the Microsoft
      365 MX/SPF/DKIM records *first*. Breaking parish email is the one
      unrecoverable mistake in this migration.
