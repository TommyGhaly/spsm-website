# Console settings notifications need

Things that live in the Apple Developer portal or the Firebase console rather
than in this repo, so a developer cannot apply them and a deploy cannot carry
them. Each one below says what it is for and what happens if it is skipped.

Project: `spsm-database`
App: `org.spsm.connect` (and `org.spsm.connect.dev` for the dev variant)
Team: `5ZRM8X66TN`

**Nothing in the admin half of notifications works until #1 is done.** The
calendar-reminder half needs none of this — reminders are local notifications
scheduled on the phone, so they work on a device the moment the app is
installed. That asymmetry is deliberate and is explained at the top of
`packages/shared/src/schema/notifications.ts`.

---

## 1. APNs authentication key — required for iOS

Firebase Cloud Messaging does not talk to iPhones. It talks to **APNs**, which
is Apple's, and it needs a credential of the parish's own to do that. Without
one, every iOS send fails and **Android carries on working perfectly**, which is
the most confusing possible way for this to be broken: nothing appears in the
app's logs, nothing appears on the phone, and the Functions log shows
`messaging/third-party-auth-error` per device if anybody thinks to look.

### 1a. Create the key

1. <https://developer.apple.com/account/resources/authkeys/list> — team
   `5ZRM8X66TN`.
2. **Keys → +**
   - Name: `SPSM Connect push`
   - Tick **Apple Push Notifications service (APNs)**
3. **Continue → Register**, then **Download**. You get `AuthKey_XXXXXXXXXX.p8`.
4. Note the **Key ID** (the `XXXXXXXXXX`) and the **Team ID** (`5ZRM8X66TN`).

**The `.p8` downloads exactly once.** Apple will not offer it again, and losing
it means revoking the key and repeating this. Put it in the parish's password
manager, not in this repo — `.gitignore` does not know about it and a key in git
history is a key that has to be revoked.

A **key** rather than a certificate, deliberately: an APNs key does not expire,
works for every app on the team, and covers sandbox and production together. The
older per-app certificates expire annually, and an expired one takes
notifications down on a morning nobody is expecting it.

### 1b. Upload it to Firebase

1. Firebase console → **Project settings → Cloud Messaging**.
2. Under **Apple app configuration**, find the iOS app, **APNs Authentication
   Key → Upload**.
3. Upload the `.p8`, and enter the Key ID and Team ID from above.

Repeat for `org.spsm.connect.dev` if the dev variant is being used to test.

### What happens if skipped

Android receives everything. iOS receives nothing, silently.

---

## 2. `aps-environment` must match how the build is signed

This one is in the repo — `app.config.ts` sets it — but it is listed here
because the failure looks like a console problem and is not.

| How it is built | Value needed |
| --- | --- |
| Locally signed, on a cable | `development` |
| TestFlight | `production` |
| App Store | `production` |

It is defaulted off `APP_VARIANT`, which is right for both ordinary cases, and
overridden by `APPATTEST_ENV` for the case that is neither — a production-bundle
build run locally on a device. The same override drives App Attest's
environment, because a build that needs the sandbox for one needs it for the
other.

**TestFlight is the trap.** A build that received notifications perfectly on a
cable stops the moment it is uploaded, because TestFlight is `production` and a
`development` entitlement points at the APNs sandbox. Nothing about the symptom
says so.

---

## 3. Nothing to do for FCM credentials

Worth stating because it is the step people go looking for. The fan-out sends
through the Admin SDK, which is already credentialed by `initializeApp()` in
`functions/src/index.ts` — the same credential that writes Firestore. There is
no server key, no `FCM_SERVER_KEY`, and nothing to add to `api-keys.md` or to
Secret Manager.

---

## 4. Android needs nothing

`google-services.json` already carries everything FCM needs, and it is already
in the app repo. Channels are created by the app on launch
(`src/notify/channels.ts`).

The one Android thing worth checking on a device is the **notification icon**.
Android draws it as a flat silhouette — alpha only, colours discarded — and the
parish seal does not reduce to one colour. `scripts/make-icons.mjs` generates
`assets/notification-icon.png` and says so in its own note; if it reads as a
white blob in the status bar, that glyph wants drawing by hand.

---

## 5. Checking it actually works

There is no "send test notification" path in this codebase, on purpose — a test
endpoint that sends a push to an arbitrary token is an endpoint worth attacking.
So the check is an end-to-end one:

1. Sign in to the app as somebody holding a grant — `forms` is the easiest.
2. Open the drawer → **Notifications**, and turn on **Forms signed**. This is
   the moment iOS asks for permission; allow it. (Every row there is
   independent — somebody who looks after the shop and the forms ticks both.)
3. Submit any native form on the website.
4. The push should arrive within a few seconds.

If nothing arrives, in this order:

- **Functions log** for `[notify]`. `told 0 device(s)` means the audience
  resolved to nobody — check the grant on `members/{uid}`, and that the switch
  was actually saved (the endpoint intersects the request with the grants and
  echoes back what it stored).
- `messaging/third-party-auth-error` in the log is #1 above, undone.
- **iOS with `told 1 device(s)` and still nothing on the phone** is #2 above:
  the entitlement does not match the signing.
- **A real device.** The iOS simulator cannot register for remote notifications
  at all, so `pushToken()` returns null there and the switch will not stick —
  the same constraint App Attest and the background upload drain already put on
  this app.

---

## 6. What is deliberately not here

**No per-person email fallback.** A servant who has not opted in is not
notified, and that is the design: these are opt-in, so that shipping the feature
did not push a fortnight of backlog at every servant in the parish. Form
submissions do still email `form.notifyEmails`, which is a separate and older
mechanism — see `functions/src/forms/email.ts`.

**No notification for the servants' rota.** Reminders cover the church calendar
only. The rota is readable in the app's calendar screen and deliberately
produces no notifications — removed at Tommy's direction on 2026-09-16, after
being built and then taken back out, so do not treat its absence as an
oversight.

**No scheduled reminder sender.** Calendar reminders are local. Do not add a
scheduler without reading the header of
`packages/shared/src/schema/notifications.ts`, which sets out why the parish
calendar cannot be the thing one triggers from: it is read out of Breeze at
request time, capped at 62 days a request, and most people using the app are
anonymous and have no document to hang a preference on.
