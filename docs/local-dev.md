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
browser cannot hold those, so this read only happens during `next build`.

Consequence worth knowing: **`next build` is no longer runnable from public
config alone.** Without that key the site still builds, but the bulletin section
is silently absent and the log says why. Whatever runs your production build
needs the key too.

It is read-only on that project — `npm run verify:scopes` proves it — so a leak
exposes the parish bulletin, which is already public. Still not a reason to be
careless: the variable has no `NEXT_PUBLIC_` prefix precisely so Next will not
inline it into browser code.

## When the bulletin section is missing

```bash
npm run bulletin
```

It reads `config/integrations` and then the source project, printing both. That
covers the realistic causes in one shot: config says `enabled: false`, the
collection path is wrong, the service account is missing or malformed, or the
source really is empty.

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
firebase emulators:start --only auth,firestore --project spsm-database
```

Then the site, pointed at them:

```bash
NEXT_PUBLIC_USE_EMULATORS=1 npm run dev
```

Seed yourself a user and give it a role. The emulator has no Microsoft provider,
so this is a password account — which is why `signInWithEmulatorAccount` exists
and why it throws unless `NEXT_PUBLIC_USE_EMULATORS=1`:

```bash
curl -X POST "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake" \
  -H 'Content-Type: application/json' \
  -d '{"email":"staff@spsmwayland.org","password":"emulator-only","returnSecureToken":true}'
```

Then set the claim, substituting the `localId` from that response:

```bash
curl -X POST "http://localhost:9099/identitytoolkit.googleapis.com/v1/projects/spsm-database/accounts:update" \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer owner' \
  -d '{"localId":"<localId>","customAttributes":"{\"role\":\"staff\",\"groups\":[]}"}'
```

`/admin` now shows an extra "Emulator sign-in" panel. It is rendered only when
`NEXT_PUBLIC_USE_EMULATORS=1`, and the production project has no password
provider enabled anyway.

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
