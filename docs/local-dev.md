# Running locally

## The short version

```bash
npm install && npm run dev
```

That serves the website at <http://localhost:3000>. It reads the **real**
Firestore and the **real** announcements project — not emulators. For a parish
site with no destructive client writes, that is the fastest way to see what you
are actually shipping.

Everything it needs is already in `.env`. If that file is missing you get a
"Firebase isn't configured" panel on the page rather than a stack trace, which
is the intended behaviour.

## What runs where

| Command | What it does |
|---|---|
| `npm run dev` | Website at :3000, against live Firestore. **Start here.** |
| `npm run dev:backend` | Emulator suite, for rules and Functions work |
| `npm run build` | Builds everything; website output lands in `apps/website/out` |
| `npm run verify:scopes` | Checks every credential against the live services |
| `npm run bulletin` | Prints this week's bulletin as the build sees it |
| `npm run config` | Shows `config/integrations`; `-- --write` creates it |

Note the `--` in `npm run config -- --write`. Without it npm eats the flag.

## Where configuration actually lives

Three places, and the split is deliberate:

**1. `.env` at the repo root** — only what you need *before* you can reach the
database:

- the six `NEXT_PUBLIC_FIREBASE_*` values (public; they identify the project)
- `ANNOUNCEMENTS_SERVICE_ACCOUNT` (**secret**; a private key)
- Square and Entra values

**2. Firestore, `config/integrations`** — everything else. Which project the
bulletin lives in, which collection, and whether to show it at all. Staff can
edit this in the Firebase console and the next build picks it up, no deploy
needed.

```
config/integrations
  announcements:
    enabled        true            ← flip to false to hide the bulletin
    projectId      weeklyannouncements-1d046
    collectionPath bulletins
    databaseId     ""              ← empty means (default)
```

If the document is missing, the build falls back to the defaults committed in
`packages/shared/src/schema/config.ts` and says so in the log. Create it with:

```bash
npm run config -- --write
```

**Nothing secret goes in `config`.** It is world-readable, because the website
build reads it anonymously before it holds any other credential. A project id
authorizes nothing; a service-account key would authorize everything.

**3. Secret Manager** — production secrets for deployed Cloud Functions
(`npx firebase functions:secrets:set NAME`).

## The one credential the build genuinely needs

`ANNOUNCEMENTS_SERVICE_ACCOUNT`. The weekly bulletin lives in a different
Firebase project, and reaching another project requires its credentials — a
browser cannot hold those, so a browser never does this read.

Consequence worth knowing: **`next build` is no longer runnable from public
config alone.** Without that key the site still builds, but the bulletin section
is silently absent and the log says why. Whatever runs your production build
needs the key too.

**It is needed in two places now, not one.** The build bakes in whichever
bulletin was active at deploy, and the `bulletin` Cloud Function re-reads the
source at request time so the homepage stops being as old as the last deploy.
Same key, second home:

```bash
npx firebase functions:secrets:set ANNOUNCEMENTS_SERVICE_ACCOUNT
```

Without it the endpoint answers 503, the page keeps showing the week it was
built with, and nothing looks wrong. Check it after a deploy.

It is read-only on that project — `npm run verify:scopes` proves it — so a leak
exposes the parish bulletin, which is already public. Still not a reason to be
careless: the variable has no `NEXT_PUBLIC_` prefix precisely so Next will not
inline it into browser code.

## Which bulletin the homepage shows

**`config/active_bulletin` in the announcements project, and nothing else.**

That document is a single field — `{ id: "318bf22a-…" }`, an id in `bulletins` —
and the announcements app writes it when staff make a bulletin active. The
website follows it, so the homepage and the screen in the narthex agree by
construction.

Nothing about the *dates* is used to decide this, and that is deliberate. The
`bulletins` collection normally holds the active week plus whichever future week
somebody has started drafting, so "the newest document" is reliably the draft —
which is how the homepage once came to be headed "August 24, 2026" on the 20th,
showing services nobody was holding. And a bulletin is a schedule somebody
publishes rather than a calendar range: the parish is entitled to leave last
week's up over a feast, or to put next week's up early, and deriving the week
from `days[]` would silently overrule that.

If the pointer is missing or names something unusable, the fallback is the most
recently **published** week — never the newest, for the reason above. If nothing
has ever been published, the section is absent. See `readActiveBulletin` in
[`packages/shared/src/bulletinSource.ts`](../packages/shared/src/bulletinSource.ts),
which is where both the build and the Function get their answer.

## When the bulletin section is missing or stale

```bash
npm run bulletin
```

It reads `config/integrations`, then the pointer, then the source collection,
printing all three and marking which document is `<-- ON THE SITE`. That covers
the realistic causes in one shot: config says `enabled: false`, the collection
path is wrong, the service account is missing or malformed, the pointer names a
deleted document, or the source really is empty.

That script covers the **build-time** read. If the HTML on disk is right and the
page is still wrong, the live read is the other half:

```bash
curl -s https://<host>/api/bulletin | head -c 300
```

| What comes back | What it means |
|---|---|
| `{"bulletin":{...}}` | Working. This is what the page puts on screen. |
| `{"bulletin":null,"reason":"disabled"}` | `announcements.enabled` is false in `config/integrations`. |
| `{"bulletin":null,"reason":"nothing-active"}` | No pointer and nothing published, or the collection is empty. |
| `503` | `ANNOUNCEMENTS_SERVICE_ACCOUNT` is not in Secret Manager. |
| `502` | The source project could not be read — IAM, or a malformed key. The Function's log names the cause; the response deliberately does not. |
| `404` | The Hosting rewrite is missing, or you are on `next dev` without the Functions emulator running. |

**Every one of those non-answers leaves the page alone.** The live read only ever
*replaces* the week on screen — it never removes it. A schedule a few days old
still tells you when the Liturgy is; an empty band tells you nothing. So a broken
endpoint shows up as a page that stops updating, not as a page that breaks, which
is why the `curl` above is worth running rather than trusting your eyes.

### Why the live read finds nothing locally

`npm run dev` proxies `/api/bulletin` to the Functions emulator, and the Functions
emulator sets `FIRESTORE_EMULATOR_HOST` for its whole process. The Admin SDK
honours that for *every* app — including the one opened with the announcements
project's key — so the live read never leaves your machine, no matter what
credential it holds. It answers `nothing-active`, and the page keeps the week the
dev server read from the real project. Correct, and worth knowing before you spend
an afternoon on it.

To exercise the live path locally, copy the pointer and the bulletins into the
emulator under **the announcements project's own id**, not ours — that is where
the redirected read looks:

```
weeklyannouncements-1d046/config/active_bulletin
weeklyannouncements-1d046/bulletins/<id>
```

The Functions emulator also needs the key in `functions/.secret.local`
(gitignored, and excluded from deploys):

```
ANNOUNCEMENTS_SERVICE_ACCOUNT=<the same one-line JSON as in .env>
```

## Emulators

Only needed for security rules and Cloud Functions.

```bash
npm run dev:backend
```

| Emulator | URL |
|---|---|
| Emulator UI | http://127.0.0.1:4000 |
| Hosting | http://127.0.0.1:5002 |
| Functions | http://127.0.0.1:5001 |
| Firestore | 127.0.0.1:8080 |
| Auth | 127.0.0.1:9099 |
| Storage | 127.0.0.1:9199 |

The UI at :4000 is the useful one — a Firestore data browser and a fake user
manager that can mint custom claims — which since the role ladder was removed
means one claim, `superadmin`. Everything else is a flag or a program id on the
member document, so to test a *delegated* administrator you edit
`members/{uid}` in the data browser rather than the claims on the account.

Two machine-specific things:

**`firebase-tools` needs JDK 21+; the default `java` here is 17.**

```bash
export JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home
```

**Port 5000 is taken by macOS ControlCenter (AirPlay).** Already handled —
hosting is on 5002 in `firebase.json`.

**`AZURE_TENANT_ID` has to be readable by the Functions runtime.** The sign-in
blocking function fails closed without it, so every sign-in is refused — which
is the correct behaviour for an unset security control, and confusing if you
don't know that's what you're looking at. It's a `defineString` param, not a
secret, and `functions/.env*` is gitignored, so set it locally:

```bash
echo "AZURE_TENANT_ID=$(grep '^NEXT_PUBLIC_AZURE_TENANT_ID=' .env | cut -d= -f2)" > functions/.env.local
```

The same value has to exist wherever Functions are deployed from.

`functions/.secret.local` holds dummy values for secrets declared with
`defineSecret`. Without it the emulator prompts for each one on startup and
appears to hang. It is gitignored; keep only dummy or sandbox values in it.

### The two endpoints anybody can post to

Both are Cloud Functions behind a Hosting rewrite, proxied to the Functions
emulator by `next dev`:

| Path | Function | Sends |
|---|---|---|
| `/api/forms/submit` | `formSubmit` | every native form, and the vehicle registration into Taksis |
| `/api/camp/servant-request` | `campServantRequest` | a servant's own camp sign-up |

With no Functions emulator running, both answer HTML instead of JSON and the
page says so in plain words while the console carries the detail. Neither can
be exercised by pointing the dev server at the real project: they are rewrites
in production and a dev-only Next proxy locally.

`campServantRequest` reads `config/camp` before it writes anything — it takes
the season and the ministry from there rather than from the request, and refuses
outright when `servantSignUp` is false. So an emulator with no `config/camp`
answers 503 with "camp sign-ups are not set up yet"; `npm run seed:emulator`
writes one with the switch on.

## Working on anything that needs a signed-in user

There is no /admin section any more — it was deleted, and the site is edited in
place on the pages themselves. What has not changed is the problem it had:
`npm run dev` reads the real Firestore, which is right for the public pages and
useless for editing. Pressing Edit needs a signed-in user with an allocation,
and the only way to get one against the real project is to be an actual member
of the parish Microsoft directory. So editing — the event pages, the galleries,
and the ministries — is developed against the emulators.

The servants calendar is the one gated surface that is *not* on this list any
more. It used to be `/servants`, a page behind a role gate; it is now the extra
entries `/calendar` shows anybody signed in, fetched from the `calendar`
Function. To see it locally you need the **Functions** emulator as well, and
`servantsConfig/schedule` seeded — see `SPSM_BREEZE_PARISH_EMBED_URL` in
`scripts/seed-emulator.mjs`.

Two terminals. First the emulators — **use the real project id**, because the
web app's config points at it and the client would otherwise talk to a different
emulator namespace than the one you seed:

```bash
npm run dev:backend
```

Then the site, seeded and pointed at them:

```bash
npm run dev:local
```

There is no longer any account to create by hand: `dev:local` runs
`scripts/seed-emulator.mjs` first, which creates six accounts with their
allocations already written — one claim on the superadmin, and a `screenAdmin`
map plus a `programAdmin` grant on each of the others.

### The seeded galleries have real photographs in them

They did not, and it mattered more than it sounds. The seed used to write
`galleryMedia` documents whose `renditionPath` pointed at objects nobody ever
uploaded, so every gallery rendered as a lattice of broken-image icons — and the
whole subject of those pages is the *arrangement* of the pictures. You could not
tell a packing bug from a missing file.

The seed now uploads the site's own webp images from `apps/website/public/img`
into the Storage emulator under `galleries/`, reads their real dimensions off
disk so the packer sees true aspect ratios, and marks one item as a video. No new
binaries are committed to get this.

The video's own file is generated with `ffmpeg` if you have it. Without it, the
document is still seeded and its poster frame still renders — which is exactly
what an approved photograph looks like while its transcode is still running, and
worth being able to see on purpose.

Re-running the seed is safe and idempotent; it overwrites the same paths.

### Signing in locally never contacts Microsoft

This is the part that reads as a bug and is not. The emulator has no Microsoft
provider, so the masthead's "Sign in with Microsoft" button takes the
`signInWithEmulatorAccount` branch in `lib/authStore.ts` instead — no popup, no
account picker, no trip to Entra. One click and you are
`admin@spsmwayland.org`.

Which account is a URL question. `?as=` on any page picks one:

| `?as=` | What they hold |
|---|---|
| *omitted* | `superadmin` — everything, and the only one who can allocate at /access |
| `staff` | every area /access can hand out, plus Summercamp's ministry |
| `servant` | nothing at all — the servants' rota, and that is the whole of it |
| `father` | one area, About pages. To see that one flag opens one screen |
| `camp` | the camp's back office: registrations, groups, register. No money |
| `treasurer` | `finance` narrowed to the camp: its totals, and no registration |
| `lead` | a program grant over all of Summercamp, and no area |
| `volunteer` | a grant over Summercamp Week 1 only |

`staff` is not a tier and does not mean one — it is ten ticked boxes on a member
document, which is now all any administrator is. `servant` is the most useful
fixture on the list: it is what nearly every account in the parish will be, and
what almost every page should show it is the signed-out view plus a rota.

**`camp`, `treasurer` and `lead` are three accounts about one summer, and they
are the only way to see the split made on 2 Sep 2026.** The camp's back office,
its money and its photographs are three separate grants now (decision #15), and
each of them looks correct from the inside — what has to be checked is what the
*other two* cannot reach. Open /admin/camp as each: `camp` gets the screen with
the balances taken out and one box for recording a payment, `treasurer` gets
refused and finds the same figures on /admin/finance, and `lead` — which is the
grant that used to open all of it — is refused outright and keeps the camp's
gallery.

The last pair is the other point of it: the program-grant model is only testable
by comparing what `lead` and `volunteer` see, and that comparison should be an
edit to the address bar rather than a sign-out and a re-pick.

The branch is guarded on `NODE_ENV` as well as `NEXT_PUBLIC_USE_EMULATORS`, so
it folds out of a production build entirely and cannot be switched back on by an
environment variable — which matters, because `NEXT_PUBLIC_USE_EMULATORS=1` is
the environment every local build of this app runs in. The seeded password is
`emulator-only` if you ever need it directly.

`AdminGate` also has an "Emulator sign-in" panel for picking an account by hand,
rendered only when `NEXT_PUBLIC_USE_EMULATORS=1` — the production project has no
password provider enabled anyway. Nothing renders that gate at the moment:
`/servants` and then `/staff/events` were the two pages that did, and both are
gone.

To read emulator Firestore past the security rules — for checking what an edit
actually wrote — the emulator accepts `Authorization: Bearer owner` as admin:

```bash
curl -H "Authorization: Bearer owner" \
  "http://localhost:8080/v1/projects/spsm-database/databases/(default)/documents/events"
```

Without that header you get a rules denial, which looks like a bug and is not.

## Tests

```bash
npm test
```

Pure functions from `@spsm/shared` — parsers and validators. No emulator, no
network, no credentials, about a second.

```bash
npm run test:rules
```

`firestore.rules` evaluated against a real emulator, so it needs the JDK 21
above. **This is the suite that matters.** `npm run rules:check` compiles the
policy and nothing more — a policy that passed *that* check denied every public
list query on the live project, and it took building a page to notice
(decision #10).

So `tests/rules/public-reads.test.ts` asserts the queries the site actually
issues, and going back to a `publishAt` read-time filter turns five of them red
immediately. `tests/rules/writes.test.ts` covers the write paths that would be
expensive to get wrong: `vehicles` (the only unauthenticated write on the site,
and a plate-to-name map that must never be enumerable), `orders`
(`allow write: if false`, verified against the *superadmin*), member
claim-mirror immutability, and the catch-all.

`tests/rules/access.test.ts` is the one to read first if you are changing
authorization at all: it is where "signing in is worth nothing but the rota" and
"one flag opens one screen" are actually asserted, one area at a time.

Two things about these tests are deliberate and worth not "tidying up":

- **Each suite passes its own name to `createTestEnv`, which puts it in its own
  emulator project.** These files run in parallel and each clears Firestore, and
  the emulator scopes data *and* the loaded ruleset by project id — so one id
  shared between them means one suite's clear deletes another's fixtures. That
  was survivable while a fixture was only the document under test; it stopped
  being survivable when a permission became a document, because a stray clear
  silently revokes every grant in the suite and thirty correct rules report
  `permission-denied`. Measured: 282 passing sequentially, 254 in parallel,
  before the argument existed.
- **Firestore is cleared once per file in `beforeAll`, never in `beforeEach`.**
  A clear immediately followed by a seed write races, and the lost fixture makes
  `assertFails` pass *for the wrong reason* — NOT_FOUND counts as a failure the
  same as PERMISSION_DENIED. A green test that never exercised the policy is
  worse than no test. Seeds are idempotent `setDoc` upserts instead.
- **`setLogLevel('silent')`** in `tests/rules/helpers.ts`. Half these tests
  assert a denial and the SDK logs each one at error level; left on, a passing
  run buries any real failure in stack traces.

When changing a rule, check the test can actually fail: break the rule on
purpose, watch it go red, then restore it.

```bash
npm run rules:check
```

Still useful — it catches a syntax error faster than a full emulator run.

## Expected on a fresh clone

- **Hosting emulator returns 404.** It serves `apps/website/out`; run a build
  first.
- **`squareWebhook` returns 503.** Deliberate. It returns 503 rather than 200 so
  that if it is ever pointed at the real Square dashboard before the logic
  exists, Square *retries* the event instead of discarding it as delivered.
- **Most of the site says "Nothing here yet."** Correct — `content`, `events`,
  and `announcements` are empty. The bulletin section is the exception, because
  it comes from a project that already has data.

## Gotcha worth knowing about

`@firebase/app` is an unmet peer dependency of `@firebase/database-compat`
(inside `firebase-admin`), and npm's workspace hoisting doesn't install it
automatically. The emulator's functions runtime loads the `firebase-functions`
barrel — which pulls in the database provider — so the function crashes on
invocation with `Cannot find module '@firebase/app'` even though our code only
imports `firebase-functions/v2/https`.

It's therefore listed as an explicit dependency in `functions/package.json`. If
you ever see that error again after a dependency bump, that's why.

## Deploying

```bash
npx firebase deploy --only firestore:rules,firestore:indexes
```

```bash
npm run build && npx firebase deploy --only hosting
```

Cloud Functions are bundled with esbuild before upload — see the comments in
`functions/package.json` for why a workspace dependency cannot be deployed
as-is.
