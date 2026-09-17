# App Clip experiences

The parish's tags, and what each one opens without an install.

Everything the church invokes lives under **`/c/*` on this domain**, at
`https://www.spsmwayland.org/c/<slug>` — **with the `www.`**. The apex answers
301 to it for every path, `.well-known/` included, and Apple follows no redirect
from an invocation URL or when fetching the association file, so a tag printed
without it opens Safari and never the clip. The same applies to Android's
`assetlinks.json`, which is why the app's `associatedDomains` and intent filters
name the `www` host and not the apex.

`/c/*` was already a shipped App Clip namespace before SPSM Connect had one:
Taksis's vehicle registration is `/c/register-vehicle`, printed on every
car-park tag, and `public/c/register-vehicle.html` is its live fallback. Nothing
here touches it. Vehicle registration is Taksis's clip and stays Taksis's clip.

## Three constraints that decided the shape of this

**One binary, many invocations.** There is no such thing as eight App Clips.
There is one clip target — `org.spsm.connect.Clip` — and eight *experiences*
registered against it in App Store Connect, each with its own URL, card title,
subtitle and image. All eight share one budget.

**15 MB, uncompressed.** Every invocation below is *physical* — a tag by a door,
a code on a printed card — and physical invocations do not get the larger budget
iOS 17 introduced. That one is for digital invocations only: a link tapped in
Safari or Messages. `deploymentTarget: '16.4'` in the app's Expo config is what
buys 15 MB rather than the 10 MB an iOS 15 floor allows.

**No PhotoKit.** PhotoKit provides no functionality at runtime inside an App
Clip. The camera works; "choose from my library" does not exist. This is why the
photographs experience is camera-only, why `expo-media-library` is in the clip's
`excludedPackages`, and why the clip build resolves `expo-image-picker` to a
shim that answers a library request with the camera.

## The eight

| # | Invocation URL | Card title | What the clip does |
|---|---|---|---|
| 1 | `/c/give` | Give | The giving screen, and Tithe.ly's form in Safari over it. |
| 2 | `/c/schedule` | This Week | Week and month views over `/api/calendar`, read-only. |
| 3 | `/c/apps` | The Parish’s Apps | Taksis and Tithe.ly with store links, plus a card for SPSM Connect that the full app does not show. |
| 4 | `/c/welcome` | Welcome | The liturgy tour, for a visitor at the door. |
| 5 | `/c/plans` | Our Expansion Plans | Renderings, and the flythrough in Safari. |
| 6 | `/c/bookstore` | The Bookstore | **Hands off.** Explains, then offers the app or the website. |
| 7 | `/c/forms` | Parish Forms | Opens on `config/forms.nfcFormSlug`; the list is one press away. |
| 8 | `/c/photos` | Send a Photograph | Camera, filed against `config/events.mainSection`, changeable from the pill. |

The table in the app is `src/clip/experiences.ts` in the SPSM-Connect repo, and
it is the one to change first: its header lists the four places outside itself
that every row has to agree with, and this file is one of them.

### Why the URLs are `/c/*` and not the real pages

An earlier version of this file registered each experience against the site page
it corresponds to — `/calendar`, `/giving`, `/bookstore` — so that seven of nine
needed no new page. The reasoning was that the fallback should be a page the
parish already maintains. That is still true, and it is what the `/c/*` pages
link to; what changed is where the *invocation URL* points.

Three properties made the move worth it:

1. **An invocation URL can never be renamed.** It is stamped into the experience
   in App Store Connect and printed on physical tags. `/c/<slug>` is a namespace
   that exists to be permanent. `/calendar` is a website route, and a website
   route is somebody's to reorganise — the day `/calendar` becomes
   `/parish/calendar`, a plaque on a wall stops working.
2. **Apple will not follow a redirect from one**, so that day has no remedy
   short of re-printing.
3. **It keeps the two apps apart.** Both apps live on this domain and both have
   clips. `/c/register-vehicle` is Taksis's and the eight above are SPSM
   Connect's, with no glob claimed by either — see the association file.

### The fallback pages

`public/c/<slug>.html`, written by `npm run clip:pages` from the table in
`scripts/make-clip-pages.mjs`. Committed outputs; re-run it when copy changes.

They are deliberately thin — the name of the thing, one sentence, and a link to
the site page that does it. They are what an Android phone, a laptop, or anybody
who dismisses the App Clip card sees, so they are not allowed to be a "get the
app" stub; and they are not allowed to be a second copy of the real page either,
kept in step by memory. `<link rel="canonical">` points at the real page.

Static HTML rather than Next routes on purpose: `cleanUrls` and
`trailingSlash: false` decide what an exported route is actually served at, and
an invocation URL that is wrong by a slash is a tag that has to be reprinted. A
file at `public/c/give.html` is served at `/c/give` and nowhere else.

### Two of them open on a setting the office controls

`/c/forms` opens on `config/forms.nfcFormSlug` rather than on a list — the same
field the website's own tag page redirects by, and the reason it exists is the
reason all of these URLs are `/c/*`: a tag cannot be reprogrammed, so it points
at one URL for ever and the office changes the answer in one field. The parish
default is the vehicle registration. `‹ All forms` is one press away and marks
which form the tag was pointing at.

`/c/photos` does the same with `config/events.mainSection` — "the thing
happening now" — and the pill under the viewfinder changes it, using the app's
own `DestinationBar`. The rule that component carries is worth repeating because
a clip makes it literal: *the church's answer is live, the sender's answer wins,
and the sender's answer does not outlive the visit.* A clip is one visit.

### Two of these were argued against, and one of them changed its mind

- **6, bookstore** — physical goods cannot use IAP, so the only way to take money
  for a book is Square's native SDK, which is a large framework in a 15 MB
  budget and is excluded from the clip target. The shelf *would* render — 
  `payments/square.ts` degrades honestly in a binary without the SDK — but a shop
  that cannot sell is a worse card than an honest one. It is the only handoff of
  the eight. Revisit with a measurement, not before.
- **1, giving** — the old objection was that a third-party hosted web form inside
  a clip is a web view under guideline 4.2, and that it is not Apple Pay. Half of
  that was wrong about this app: the giving screen does not embed anything. It
  opens `give.tithe.ly` in `SFSafariViewController`, with the address visible,
  which is the mechanism Apple names for a nonprofit collecting donations outside
  in-app purchase — and the wallets work there, which is precisely why the app
  refuses to use a `WebView` for it. See `giving/open.ts`.
- **3, apps** — still circular: an App Clip *is* an App Store card. It stays
  because the printed card it opens from lists four things, only one of which is
  this app, and a Smart App Banner cannot introduce Taksis.

**Camp attendance is no longer on the list.** It was #9: gated on the `camp`
screen flag, so a servant would re-authenticate with Microsoft at every tap
because a clip's storage does not survive between invocations. They are staff;
they have the full app.

## Before any of it works

**1. ~~Verify the team ID.~~ Confirmed 2026-09-11.** `5ZRM8X66TN`, read off the
signing certificate's organizational unit on the build machine:

```
organizationalUnitName = 5ZRM8X66TN
organizationName       = ST. PHILOPATER MERCURIUS & ST. MINA COPTIC ORTHODOX CHURCH, INC.
```

The team is the parish's own organisation account, and Taksis is registered under
it as well — which is why both apps share a prefix in the association file.

**2. Register the App Clip's App ID.** Certificates, Identifiers & Profiles →
Identifiers → new → type **App Clip**, parent `org.spsm.connect`, product name
exactly `Clip`. Apple requires that string; it is what makes the bundle id
`org.spsm.connect.Clip`.

**3. Register the experiences.** App Store Connect → the app → App Clip →
Advanced App Clip Experiences. One per row above, each with a 3:2 image and a
call to action, at `https://www.spsmwayland.org/c/<slug>` — the `www.` is not
optional; see the top of this file. Reports of NFC invocation
failing start around fifty configured experiences; eight is comfortable.

**4. The association file.** `public/.well-known/apple-app-site-association`
carries all of it:

- `appclips` names both clips — Taksis's and ours.
- `applinks` gives Taksis exactly `/c/register-vehicle` and gives SPSM Connect
  the eight slugs plus the app's other deep links. **Neither app claims a glob
  under `/c/`.** Two apps claiming the same path is undefined behaviour when
  both are installed, which is the ordinary case in this parish. If Taksis ever
  gains a second clip URL, it is added to its own list by name.
- The app side of the same association is `ios.associatedDomains` in the app's
  `app.config.ts`, which now lists both `applinks:` and `appclips:` for
  `spsmwayland.org` and `spsm-database.web.app`. `react-native-app-clip` copies
  that array onto the clip target's entitlements, so both targets stay in step.

What an installed app does with `/c/<slug>` is `app/c/[slug].tsx` in the app
repo: it reads the same table and redirects to the screen that draws the thing.

**5. Add the Smart App Banner** to the eight pages once SPSM Connect has an App
Store id:

```bash
SPSM_CONNECT_APP_STORE_ID=1234567890 npm run clip:pages
```

The script writes the `apple-itunes-app` meta only when that variable is set. It
cannot be added yet — the app is unreleased and has no id, and an `app-id` that
is wrong offers a stranger's app above the church's own page.
`features/apps/stores.ts` carries the same gap and says so.

**6. Do not break `.well-known/`.** `firebase.json` carries two warnings that
matter more now that a second app depends on this file: `**/.*` must never enter
the hosting `ignore` array, or `.well-known/` vanishes silently and every tag in
the car park and every tag in the church dies with no diagnostic; and the
`/.well-known/*` content-type headers must stay **last** in the headers array.

## The unresolved question

Whether Firebase App Check can mint a token inside an App Clip at all. Apple's
App Attest, used in a clip, attests against the **parent** app's bundle
identifier, while Firebase builds its request from the bundle it is running in —
so the two disagree by construction.

It decides experiences 7 and 8, because `formSubmit` and `galleryUploadUrl` read
`X-Firebase-AppCheck` by hand and answer `401 {"error":"unattested"}` without it.
No token, no photographs and no forms; the other six are unaffected.

`src/clip/AppCheckSpike.tsx` in the SPSM Connect repo answers it, and is reachable
in a built clip at the unregistered URL `/c/appcheck` — put that in Xcode's App
Clip invocation field. It must run on a real device: App Attest refuses a
simulator, and a debug token would make the simulator pass while proving nothing.
See that repo's README.
