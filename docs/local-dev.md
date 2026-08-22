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
manager that can mint custom claims, so you can test the `staff` / `clergy`
gating without a real Entra ID tenant.

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

## Working on /admin

`npm run dev` reads the real Firestore, which is right for the public pages and
useless for the admin: every screen there needs a signed-in user with a role,
and the only way to get one against the real project is to be an actual member
of the parish Microsoft directory. So the admin is developed against the
emulators.

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
`scripts/seed-emulator.mjs` first, which creates six accounts with their role
claims already set.

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

| `?as=` | Role |
|---|---|
| *omitted* | `admin` — everything, including role changes |
| `staff` | `staff` — the events admin |
| `servant` | `servant` — the schedule only |
| `father` | `staff` + `clergy` |
| `lead` | `servant`, with a program grant over all of Summercamp |
| `volunteer` | `servant`, with a grant over Summercamp Week 1 only |

That last pair is the point of it: the program-grant model is only testable by
comparing what `lead` and `volunteer` see, and that comparison should be an edit
to the address bar rather than a sign-out and a re-pick.

The branch is guarded on `NODE_ENV` as well as `NEXT_PUBLIC_USE_EMULATORS`, so
it folds out of a production build entirely and cannot be switched back on by an
environment variable — which matters, because `NEXT_PUBLIC_USE_EMULATORS=1` is
the environment every local build of this app runs in. The seeded password is
`emulator-only` if you ever need it directly.

`/admin` also has an "Emulator sign-in" panel for picking an account by hand. It
is rendered only when `NEXT_PUBLIC_USE_EMULATORS=1`, and the production project
has no password provider enabled anyway.

To read emulator Firestore past the security rules — for checking what the admin
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
(`allow write: if false`, verified against an *admin*), the clergy-vs-staff
split on `prayerRequests`, member claim-mirror immutability, and the catch-all.

Two things about these tests are deliberate and worth not "tidying up":

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
