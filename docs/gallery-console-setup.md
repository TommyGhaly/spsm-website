# Console settings the galleries need

Things that live in the Firebase or Google Cloud console rather than in this
repo, so a developer cannot apply them and a deploy cannot carry them. Each one
below says what it is for and what happens if it is skipped.

Project: `spsm-database`
Bucket: `gs://spsm-database.firebasestorage.app`
Site: `https://www.spsmwayland.org`

**Do #1 and #2 before the upload form goes live.** #3 and #4 can follow.

---

## 1. App Check — required

Program galleries accept photographs from people with no account. There is no
name, no email, and no sign-in, so every social deterrent is gone and the only
thing standing between the parish and a script is App Check. Without it, one
person with a loop uploads until the Storage bill is a problem.

### 1a. Create the reCAPTCHA Enterprise key

1. <https://console.cloud.google.com/security/recaptcha> — project
   `spsm-database`.
2. **Create key**
   - Display name: `spsm-website`
   - Platform type: **Website**
   - Domains: `www.spsmwayland.org`, `spsmwayland.org`, `localhost`
   - Leave **Use checkbox challenge** OFF. Score-based is invisible to the
     parishioner uploading photographs, which is the point — a grandmother with
     forty camp photos should not meet a puzzle.
3. Copy the **site key**.

### 1b. Register it with App Check

1. Firebase console → **Build → App Check → Apps** tab.
2. Find the web app, choose **reCAPTCHA Enterprise**, paste the site key, save.
3. Leave the TTL at the default (1 day).

### 1c. Do not enforce it on any API

App Check → **APIs** tab:

| API | Setting | Why |
|---|---|---|
| Cloud Storage | **Unenforced** | it broke every image on the site — see below |
| Cloud Firestore | **Unenforced** | `next build` reads it from Node — see below |
| Authentication | Unenforced | sign-in is already tenant-restricted |

**This table was the other way round until 2026-09-03**, and the reversal is
the important part of this section rather than a correction to skim.

> **Do not enforce App Check on Cloud Storage.** It was enforced on 2026-09-02
> and turned off on 2026-09-03, because enforcement is per *service* and cannot
> distinguish an upload from an `<img>`. Every public image on the site is a
> plain `<img src="https://firebasestorage.googleapis.com/…?alt=media">` built
> by `lib/storage.ts` — and an image tag cannot send an `X-Firebase-AppCheck`
> header, because nothing in HTML can. So enforcement returned
>
>     401 {"error":{"code":401,"message":"Firebase App Check token is invalid."}}
>
> for every gallery photograph, clergy portrait, event picture and product cover
> on the public site. The staff screens kept working, which is what made it hard
> to see: they resolve images with `getDownloadURL`, and the `&token=` form
> bypasses App Check entirely.
>
> Enforcement changes take up to ~15 minutes and roll out unevenly — a URL will
> flap between 200 and 401 while it lands. Sample it twenty times rather than
> once before concluding anything.

**What replaced it, so that turning it off did not simply remove the wall.**
Both anonymous upload paths now verify an App Check token *in their own code*:
`galleryUploadUrl` and `formUploadUrl`. Both are `onRequest`, so the
`enforceAppCheck` option never applied to them and this setting never reached
them — which is exactly why the wall survives the setting being off. The
storage rules behind them are `create: if false`, so there is no anonymous
client write path left on the bucket for enforcement to have been protecting.

> **Do not enforce App Check on Cloud Firestore either.** `next build` reads Firestore
> as an anonymous client from Node to bake the static pages, and Node has no
> reCAPTCHA token to present. Enforcing it there does not fail loudly at deploy
> — it makes every public read return permission-denied, so the build produces
> a site with every section empty. This is the same failure shape as decision
> #10 and it would be read as a rules bug for a day before anyone suspected App
> Check.
>
> The cost of leaving Firestore unenforced, stated honestly: a script can still
> create `galleryMedia` documents pointing at files that do not exist. Those are
> cheap, they sit in the pending queue, and an administrator deletes them in
> bulk. The expensive half — the actual uploaded bytes — is covered.

### 1d. A debug token, so local development still works

The emulators ignore App Check, but `npm run dev` talks to the real project.

1. App Check → **Apps** → the web app → ⋮ → **Manage debug tokens** → **Add**.
2. Name it after the machine (`tommy-macbook`), copy the value.
3. Put it in `.env` — the key is already in `.env.example`, currently empty:

```
NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN=<the token>
NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY=<the site key from 1a>
```

A debug token is a **bypass**. One per machine, never in CI, and revoke it from
that same screen when a laptop is replaced.

> **Done (Aug 20 2026).** `initializeAppCheck` is wired into
> `apps/website/src/lib/firebase.ts`, started from `db()` and `storage()` so it
> runs before the first request and never during the Node export build. It is
> inert while `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY` is empty and skipped
> entirely under the emulators, and every failure inside it is swallowed — an
> unregistered app must not take the parish website down.
>
> If 1c is ever enforced again for any reason, it still has to come **after**
> 1b, not before: enforcing against an app that is not registered blocks the
> site's own uploads. Read 1c first — the answer to "should we enforce this?"
> is now no.

---

## 2. Lifecycle rule on the quarantine folder — required

`submissions/` collects every file anyone ever sends, approved or not. Nothing
deletes rejected ones, nobody can list them, and the bucket grows forever. This
is the rule that stops that.

Save as `lifecycle.json`:

```json
{
  "lifecycle": {
    "rule": [
      {
        "action": { "type": "Delete" },
        "condition": {
          "age": 120,
          "matchesPrefix": ["submissions/"]
        }
      }
    ]
  }
}
```

Apply it:

```bash
gcloud storage buckets update gs://spsm-database.firebasestorage.app --lifecycle-file=lifecycle.json
```

Check it took:

```bash
gcloud storage buckets describe gs://spsm-database.firebasestorage.app --format="value(lifecycle)"
```

**120 days, not 30.** An approved photograph is *copied* to `galleries/` and the
original stays in `submissions/` as the archive — so this deletes originals of
things still on the site. Four months is long enough that a camp submitted in
July is still recoverable in October, and short enough that a year of rejected
uploads is not sitting there. Nothing on the public site breaks when an original
is deleted; only the ability to re-transcode from it is lost.

---

## 3. Budget alert — strongly recommended

Galleries are the first thing on this site that stores and serves real weight.
Everything else is text.

1. <https://console.cloud.google.com/billing> → **Budgets & alerts** →
   **Create budget**.
2. Scope to project `spsm-database`.
3. Amount: **$25/month**. Not because the parish should spend that — the real
   figure should be near zero — but because it is far enough above normal that
   an alert means something is wrong rather than something is popular.
4. Thresholds: 50%, 90%, 100%. Email the parish office and yourself.

A budget alert does **not** cap spending; it emails you. If a hard stop matters
more than uptime, that needs a billing-disable Function, which is a bigger
decision — ask and I will lay out the trade.

---

## 4. Storage CORS — required

**Set on 2026-09-03.** This section used to say "probably unnecessary", and the
reason it gave was true at the time: the Firebase JS SDK uploaded the bytes, and
`firebasestorage.googleapis.com` sends permissive CORS headers of its own.

The upload chokepoint changed the host. The browser now `PUT`s to a v4 signed
URL, which addresses `storage.googleapis.com` directly — and raw GCS sends **no**
CORS headers at all unless the bucket carries a policy. Worse, the `PUT` sends
`x-goog-content-length-range`, which is not a safelisted header, so the browser
must send a preflight `OPTIONS` first. That preflight came back without an
`Access-Control-Allow-Origin`, the browser refused to send the real request, and
`fetch` rejected with the bare `TypeError: Failed to fetch`.

That error is worth recognising on sight, because it names nothing and looks like
a network fault. **Nothing reaches the Function**, so its logs are empty and the
endpoint answers `curl` perfectly — the request the browser never sent cannot
appear anywhere. If uploads fail and Cloud Logging shows no entry for
`galleryUploadUrl`, check here before anything else.

```json
{
  "cors": [
    {
      "origin": [
        "https://spsm-database.web.app",
        "https://spsm-database.firebaseapp.com",
        "http://localhost:3000"
      ],
      "method": ["PUT", "GET", "HEAD", "OPTIONS"],
      "responseHeader": [
        "Content-Type",
        "Content-Length",
        "x-goog-content-length-range",
        "x-goog-resumable",
        "ETag"
      ],
      "maxAgeSeconds": 3600
    }
  ]
}
```

`x-goog-content-length-range` in `responseHeader` is the load-bearing entry —
it is what populates `Access-Control-Allow-Headers`, and the preflight names
that header because `submitOne` sends it. Drop it and the policy looks correct
and still fails. The live policy also lists every `PORT=` in
`apps/website/package.json`, because a `dev:real` server talks to this bucket
too; `gcloud storage buckets describe gs://spsm-database.firebasestorage.app
--format='value(cors_config)'` is the current list.

```bash
gcloud storage buckets update gs://spsm-database.firebasestorage.app --cors-file=cors.json
```

Verify it without a browser — a preflight is just a request:

```bash
curl -s -i -X OPTIONS \
  -H "Origin: https://spsm-database.web.app" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type,x-goog-content-length-range" \
  https://storage.googleapis.com/spsm-database.firebasestorage.app/submissions/probe/probe.jpg \
  | grep -i "^access-control"
```

An origin that is not on the list also gets a `200`, with no
`Access-Control-Allow-Origin` header — so check for the header, never the status.

### This is the third domain allowlist, and it is the one nobody remembers

The other two are Firebase Auth's authorized domains and the reCAPTCHA
Enterprise key's own list. **A custom domain has to be added to all three.**
There is no Hosting custom domain today — `spsm-database.web.app` is the only
origin the site is served from — so when the parish cuts over to
`www.spsmwayland.org`, this file is one of the three places that will not
notice on its own. CORS is not what authorises the upload; the signed URL is,
and it is pinned to one object, one content type and one exact length. This
list only decides which origins a *browser* will let make the request.

---

## What I still deploy from here

Not console work — listed so the two halves are not confused:

```bash
firebase deploy --only firestore:rules,storage,firestore:indexes
```

The indexes matter as much as the rules on this feature. Gallery pages are
client-rendered, so a missing composite index is not a build that fails in front
of a developer — it is a page that spins in front of a visitor.

---

## Checklist

- [x] 1a reCAPTCHA Enterprise key created — `SPSM Database`, SCORE, domains
      `www.spsmwayland.org` / `spsmwayland.org` / `localhost`. Site key is in
      `.env` as `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY`.
- [x] *(`initializeAppCheck` wired — see the note in 1d)*
- [x] **1b key registered in App Check** — done 2026-09-03, and it was skipped
      for a fortnight while 1c below was ticked. That ordering is what broke
      the live site: 1c enforced Cloud Storage on 2026-09-02 against an app
      that had no attestation provider, so no browser could mint a token and
      every Storage request came back 401 — surfacing as
      `storage/unauthenticated`, "please authenticate", to people who were
      signed in. **1c must never be ticked before 1b.** Verify with:

          curl -s -X POST -H 'Content-Type: application/json' \
            -d '{"recaptchaEnterpriseToken":"bogus"}' \
            "https://firebaseappcheck.googleapis.com/v1/projects/spsm-database/apps/$APP_ID:exchangeRecaptchaEnterpriseToken?key=$WEB_API_KEY"

      `App not registered` means 1b is undone. `App attestation failed` is the
      healthy answer — the app is registered and rejected a fake token.
- [ ] 1d debug token created and put in `.env` (needed for `npm run dev`
      against the real project; irrelevant under the emulators)
- [x] 1c **enforcement is OFF on every API** — reversed 2026-09-03. It was
      enforced on Cloud Storage on 2026-09-02 and that broke every `<img>` on
      the public site; an image tag cannot present an App Check token. Both
      upload endpoints verify their own token in code, so the wall does not
      depend on this setting. **Do not turn it back on for Storage.**
- [ ] 2 lifecycle rule applied and verified
- [ ] 3 budget alert at $25
- [x] 4 **bucket CORS** — done 2026-09-03. Not optional any more: the browser
      now PUTs to `storage.googleapis.com`, not through the SDK. Until it was
      set, every upload died in the preflight as `TypeError: Failed to fetch`
      with nothing in the Function's logs.
- [x] **5 `roles/iam.serviceAccountTokenCreator`** — done 2026-09-03, on
      `778458603931-compute@developer.gserviceaccount.com` (the Compute Engine
      default, *not* the appspot account this file used to name).

4 and 5 fail identically from the outside — the upload stops and the site says
something vague — and they fail in opposite places. 5 throws *inside* the
Function, so Cloud Logging has a stack trace and the browser sees a 500. 4 stops
the browser *before* it sends anything, so the browser sees `Failed to fetch`
and Cloud Logging has nothing at all. **Empty logs point at 4; a 500 points at
5.**

---

## 5. Let the Functions service account sign a URL

New with the upload chokepoint, and the one item on this list that stops the
feature dead rather than merely weakening it. `POST /api/gallery/upload-url`
finishes by calling `getSignedUrl({ version: 'v4', action: 'write', … })`, and
v4 signing requires the runtime service account to be able to sign **as
itself**. Without the grant that call throws at runtime, every upload returns a
500, and nothing in the console says why.

**Granted on 2026-09-03**, and on the service account rather than the project:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  778458603931-compute@developer.gserviceaccount.com \
  --member="serviceAccount:778458603931-compute@developer.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project=spsm-database
```

The member is the Compute Engine default account, **not**
`spsm-database@appspot.gserviceaccount.com`, which is what this section used to
name and what every Firebase document suggests. Read the account off a function
that is already running rather than assuming either — `gcloud functions
describe bulletin --gen2 --region=us-central1 --format='value(serviceConfig.serviceAccountEmail)'`
— because a grant on the wrong account fails in exactly the same silent way as
no grant at all.

Scoped to the one account signing as itself, which is all v4 signing needs. The
project-level form works too and is what most instructions show; it also lets
that account impersonate every other service account in the project, which is a
larger thing than this feature is asking for.

**This creates no key file.** `docs/integrations.md` is right that a service
account key is a bearer credential and that this project should not be minting
them; this grant is a different thing entirely — it lets an account that is
already running sign with its own identity, and there is nothing to leak. The
distinction is worth keeping straight, because "grant a service account role" and
"download a service account key" read similarly and only one of them is safe.

### Why the upload path needs a signed URL at all

Because browsers no longer write to Cloud Storage. `storage.rules` refuses every
client write to `submissions/` and `firestore.rules` refuses every client create
of `galleryMedia`, so the endpoint is the only door.

That closed a hole no rule could have closed. Uploads used to write the bytes
first and the document second — the right order, since a document with no file
behind it is worse than the reverse — but it meant every check the project had
lived in the *second* step. A script that uploaded a file and never wrote a
document skipped all of them, and the orphaned objects never appeared in the
review queue for anyone to notice.

A signed URL addresses the GCS API directly and is not evaluated against
`storage.rules`, which is exactly why shutting that door does not shut the
feature.
