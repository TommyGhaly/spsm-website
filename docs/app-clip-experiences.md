# App Clip experiences

The parish's tags, and what each one opens without an install.

This is the SPSM Connect half of a file that already had a Taksis half:
`/c/*` on this domain is **already** a shipped App Clip namespace, and
`public/c/register-vehicle.html` is the live fallback printed on the car-park
tags. Nothing here touches it. Vehicle registration is Taksis's clip and stays
Taksis's clip.

## Three constraints that decided the shape of this

**One binary, many invocations.** There is no such thing as nine App Clips. There
is one clip target — `org.spsm.connect.Clip` — and nine *experiences* registered
against it in App Store Connect, each with its own URL, card title, subtitle and
image. All nine share one budget.

**15 MB, uncompressed.** Every invocation below is *physical* — a tag by a door,
a code on a printed card — and physical invocations do not get the larger budget
iOS 17 introduced. That one is for digital invocations only: a link tapped in
Safari or Messages. `deploymentTarget: '16.0'` in the app's Expo config is what
buys 15 MB rather than the 10 MB an iOS 15 floor allows, and is the only reason
it is set.

**No PhotoKit.** PhotoKit provides no functionality at runtime inside an App
Clip. The camera works; "choose from my library" does not exist. This is why the
photographs experience below is camera-only, and why `expo-media-library` is in
the clip's `excludedPackages`.

## The nine

Each URL is a **real page on this website**, not a purpose-built landing page.
That is deliberate: the fallback for somebody on Android, or on an iPhone who
dismisses the card, is the page the parish already publishes and already
maintains. Seven of the nine needed no new page at all.

| # | Invocation URL | Card title | What the clip does |
|---|---|---|---|
| 1 | `/events/*` | Send a photograph | Camera, then straight into the ministry's queue. The door tag. |
| 2 | `/forms/*` | Parish forms | Renders the form from its `FormDefinition` and submits it. |
| 3 | `/calendar` | This week at St. Philopater & St. Mina | The schedule, read-only. |
| 4 | `/about/welcome-newcomers` | Welcome | For a visitor at the door. |
| 5 | `/about/future-plans` | Our expansion plans | Renderings and the flythrough. |
| 6 | `/apps` | The parish's apps | Taksis, Tithe.ly, SPSM Connect. |
| 7 | `/giving` | Give | Hands off to Tithe.ly's hosted form. |
| 8 | `/bookstore` | The bookstore | The shelf, and checkout. |
| 9 | `/admin/camp/attendance` | Camp register | Signing children in and out. |

### Four of these were argued against, and are here anyway

Recorded so the reasoning is not lost, not to relitigate it:

- **7, giving** — a third-party hosted web form inside a clip is a web view, and
  App Review treats those under guideline 4.2. It is also not Apple Pay.
- **8, bookstore** — the app takes card payments through Square's native SDK,
  which is a large framework in a 15 MB budget. Physical goods cannot use IAP,
  so Apple Pay is the only in-clip option.
- **9, attendance** — gated on the `camp` screen flag, so it needs a Microsoft
  sign-in. A clip's storage does not survive between invocations, so a servant
  re-authenticates at every tap. They are staff; they have the full app.
- **6, apps** — an App Clip *is* an App Store card, so a clip that advertises
  apps is circular. A Smart App Banner does it with no budget.

If the binary will not fit, these four are the order to drop them in.

## Before any of it works

**1. ~~Verify the team ID.~~ Confirmed 2026-09-11.** `5ZRM8X66TN`, read off the
signing certificate's organizational unit on the build machine:

```
organizationalUnitName = 5ZRM8X66TN
organizationName       = ST. PHILOPATER MERCURIUS & ST. MINA COPTIC ORTHODOX CHURCH, INC.
```

The team is the parish's own organisation account, and Taksis is registered
under it as well — which is why both apps share a prefix in the association
file. That was an assumption when this file was written and is now a fact.

**2. Register the App Clip's App ID.** Certificates, Identifiers & Profiles →
Identifiers → new → type **App Clip**, parent `org.spsm.connect`, product name
exactly `Clip`. Apple requires that string; it is what makes the bundle id
`org.spsm.connect.Clip`.

**3. Register the experiences.** App Store Connect → the app → App Clip →
Advanced App Clip Experiences. One per row above, each with a 3:2 image and a
call to action. There is no documented cap, but reports of NFC invocation
failing start around fifty configured experiences — nine is comfortable.

**4. Add the Smart App Banner** to the nine pages once SPSM Connect has an App
Store id, the way `public/c/register-vehicle.html` already does it:

```html
<meta name="apple-itunes-app" content="app-id=NNNNNNNNNN, app-clip-bundle-id=org.spsm.connect.Clip">
```

It cannot be added yet — the app is unreleased and has no id. `features/apps/stores.ts`
carries the same gap and says so.

**5. Do not break `.well-known/`.** `firebase.json` carries two warnings that
matter more now that a second app depends on this file: `**/.*` must never enter
the hosting `ignore` array, or `.well-known/` vanishes silently and every tag in
the car park and every tag in the church dies with no diagnostic; and the
`/.well-known/*` content-type headers must stay **last** in the headers array.

## The unresolved question

Whether Firebase App Check can mint a token inside an App Clip at all. Apple's
App Attest, used in a clip, attests against the **parent** app's bundle
identifier, while Firebase builds its request from the bundle it is running in —
so the two disagree by construction.

It decides experiences 1 and 2, because `galleryUploadUrl` and `formUploadUrl`
read `X-Firebase-AppCheck` by hand and answer `401 {"error":"unattested"}`
without it. No token, no photographs and no forms.

`src/clip/AppCheckSpike.tsx` in the SPSM Connect repo answers it. It must run on
a real device — App Attest refuses a simulator, and a debug token would make the
simulator pass while proving nothing. See that repo's README.
