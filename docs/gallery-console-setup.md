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

### 1c. Enforce it — on Cloud Storage only

App Check → **APIs** tab:

| API | Setting | Why |
|---|---|---|
| **Cloud Storage** | **Enforce** | this is the one that matters — it is where the bytes and the bill are |
| Cloud Firestore | **leave Unenforced** | see the warning below |
| Authentication | Unenforced | sign-in is already tenant-restricted |

> **Do not enforce App Check on Cloud Firestore.** `next build` reads Firestore
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

> Neither variable is read by any code yet. Wiring `initializeAppCheck` into
> `apps/website/src/lib/firebase.ts` is mine to do, and enforcement in 1c should
> be switched on **after** that ships — enforcing first blocks the site's own
> uploads. Tell me when 1a–1b are done and I will wire it.

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

## 4. Storage CORS — only if uploads fail

Probably unnecessary. The Firebase JS SDK uploads and `getDownloadURL()` images
in `<img>` tags both work without a CORS policy, which covers everything the
galleries do today.

You would need it if a browser console shows a CORS error on upload, or once
anything reads bytes directly (`getBytes`, a canvas crop, a client-side
thumbnailer). Save as `cors.json`:

```json
[
  {
    "origin": [
      "https://www.spsmwayland.org",
      "https://spsmwayland.org",
      "http://localhost:3000"
    ],
    "method": ["GET", "HEAD", "PUT", "POST"],
    "responseHeader": ["Content-Type", "Content-Range", "x-goog-resumable"],
    "maxAgeSeconds": 3600
  }
]
```

```bash
gcloud storage buckets update gs://spsm-database.firebasestorage.app --cors-file=cors.json
```

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

- [ ] 1a reCAPTCHA Enterprise key created, site key copied
- [ ] 1b key registered in App Check
- [ ] 1d debug token created and both values in `.env`
- [ ] *(then tell me — I wire `initializeAppCheck`)*
- [ ] 1c **enforce on Cloud Storage**, leave Firestore unenforced
- [ ] 2 lifecycle rule applied and verified
- [ ] 3 budget alert at $25
- [ ] 4 CORS — only if a CORS error appears
