# Getting the keys

You mentioned needing the Square and Firebase keys. Read this first, because the
two are not the same kind of thing and treating them the same is the most common
way this goes wrong.

## The one distinction that matters

| | Firebase web `apiKey` | Square access token |
|---|---|---|
| Secret? | **No** | **Yes** |
| Ships to the browser? | Yes, by design | Never |
| What protects you | Firestore Security Rules | Keeping the token server-side |
| If it leaks | Nothing happens | Someone can charge the parish's account |

The Firebase web API key is an *identifier*, not a credential. Google publishes
it in their own docs and sample apps. You will see it in the network tab of every
Firebase site on the internet. Don't spend effort hiding it — spend that effort
on [`firestore.rules`](../firestore.rules), which is what actually stops someone
reading the prayer requests.

The Square access token is the opposite. It authorizes money movement. It must
live only in the Cloud Functions runtime.

---

## 1. Firebase (do this first — nothing runs without it)

Nothing here costs money on the Spark (free) plan, but Cloud Functions require
Blaze (pay-as-you-go). Blaze has a free tier that a parish site will not exceed;
still, set a budget alert.

1. <https://console.firebase.google.com> → **Add project**.
   - Name it something like `spsm-parish`. The project ID is permanent.
   - Analytics is optional; skip it for now, you can add it later.
2. **Build → Firestore Database → Create database.**
   - Start in **production mode** (locked). We ship real rules, so don't start
     in test mode — test mode expires after 30 days and fails confusingly.
   - Location: `us-east1` or `nam5`. **Permanent, cannot be changed.**
3. **Build → Authentication → Get started.** Enable:
   - Email/Password
   - Google
   - Microsoft (needs the Entra ID app from step 3 below — come back to it)
4. **Build → Storage → Get started.** Same location as Firestore.
5. **Project settings (gear) → General → Your apps → Web app (`</>`)**.
   - Register the app. Do **not** check "Firebase Hosting" here; we configure
     hosting from the CLI.
   - Copy the `firebaseConfig` object it shows you. Those six values map
     one-to-one onto the `NEXT_PUBLIC_FIREBASE_*` vars in `.env.example`.
6. Locally:

```bash
cp .env.example .env.local
```

Then paste the six values in. Verify with:

```bash
npx firebase login && npx firebase use --add
```

### Upgrade to Blaze when you get to Cloud Functions

Functions, the Square webhook, and scheduled catalog sync all need Blaze.
Set a budget alert at whatever number makes you comfortable — $5/mo is plenty of
headroom for this workload.

---

## 2. Square

You already have admin on the parish's Square account, so this is a matter of
creating a *developer application* that talks to it — not a new account.

1. <https://developer.squareup.com/apps> → sign in with the parish Square
   credentials → **Create app** (name it `SPSM Bookstore`).
2. The app has **two credential sets**, and mixing them up is the classic
   mistake. Note which one you're copying:
   - **Sandbox** — fake money, test cards. Use this for all development.
   - **Production** — real money. Only at launch.
3. From **Credentials**, copy for sandbox first:
   - **Access token** → `SQUARE_ACCESS_TOKEN`
   - **Application ID** → `NEXT_PUBLIC_SQUARE_APPLICATION_ID` (public, safe)
4. **Locations** tab → copy the location ID → `SQUARE_LOCATION_ID`.
5. **Webhooks → Subscriptions → Add subscription.** You can't finish this until
   the Functions endpoint is deployed, so it's fine to defer. When you do:
   - URL: `https://<your-domain>/api/square/webhook`
   - Events: `payment.created`, `payment.updated`, `refund.created`,
     `refund.updated` — the four `interpretSquareWebhook` acts on.

     Both `.created` and `.updated`, deliberately. A card payment that
     completes in one step can carry its terminal `COMPLETED` state on
     `payment.created`, so subscribing only to `.updated` can miss a payment
     and leave the order stuck at `pending` while the money has moved. The two
     events have distinct ids, so the `appliedEventIds` guard does not suppress
     the second — but both write the same status, so the duplicate is a no-op.

     **Not** `order.updated`, which earlier revisions of this list included.
     Order status tracks the order's lifecycle rather than whether money moved,
     the handler ignores it, and every delivery would be a 200 that does
     nothing.

     Not handled at all: `dispute.*`. A chargeback currently changes nothing on
     the order and is only visible in the Square dashboard.
   - Copy the **signature key** → `SQUARE_WEBHOOK_SIGNATURE_KEY`.
     Without verifying this signature, anyone who finds the URL can mark orders
     paid. It is not optional.

### Where the production token actually goes

Not in `.env.local`. In Secret Manager, read by the Function at runtime:

```bash
npx firebase functions:secrets:set SQUARE_ACCESS_TOKEN
```

```bash
npx firebase functions:secrets:set SQUARE_WEBHOOK_SIGNATURE_KEY
```

Sandbox credentials in `.env.local` are fine — that's the whole point of
sandbox.

---

## 3. Microsoft Entra ID — the only way to sign in

Done: the app registration exists, and `NEXT_PUBLIC_AZURE_CLIENT_ID` /
`NEXT_PUBLIC_AZURE_TENANT_ID` are in `.env`. Recorded here for the next person.

1. Azure portal → **Microsoft Entra ID → App registrations → New registration**.
2. **Supported account types: "Accounts in this organizational directory only"**
   (single tenant). See the warning below — this one is not cosmetic.
3. Redirect URI (**Web** platform, not SPA): for this project, literally
   `https://spsm-database.firebaseapp.com/__/auth/handler`. It is the Firebase
   auth handler, *not* the site's own address — `www.spsmwayland.org` does not
   belong in this box. Confirm what to paste rather than trusting the pattern:

   ```bash
   curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=$NEXT_PUBLIC_FIREBASE_API_KEY" \
     -H 'Content-Type: application/json' \
     -d '{"providerId":"microsoft.com","continueUri":"https://spsm-database.firebaseapp.com/__/auth/handler"}'
   ```

   The `redirect_uri` in the `authUri` it returns is the exact string Entra
   must have. Getting this wrong is **AADSTS50011**, and it does not surface
   until *after* someone types their password — Entra serves a normal-looking
   sign-in page for an unregistered redirect URI and only rejects at the end,
   so it cannot be caught by probing the authorize endpoint. Nor can anything
   else: on this tenant the authorize endpoint answers `AADSTS50058` ("no
   session, here is a sign-in page") for a bad redirect URI, an unregistered
   client id, and a well-formed request alike. Do not spend an afternoon
   probing it, as has now been done twice.
4. Copy **Application (client) ID** and **Directory (tenant) ID**.
5. **Certificates & secrets → New client secret.** Copy the *value* immediately;
   it's shown once.
6. Paste the client ID + secret into Firebase console → Authentication →
   Microsoft provider. The secret lives there, not in this repo.
7. **`NEXT_PUBLIC_AZURE_CLIENT_ID` in `.env` is stale, and nothing reads it.**
   The client ID that matters is the one in the Firebase console, not the one in
   this repo: the browser never sends a client ID of its own, and the only code
   that so much as mentions the variable is `verify-scopes.mjs`, which checks
   that it is non-empty. Two values were in play on 2026-08-19:

   | | Client ID |
   |---|---|
   | What Firebase sends — the live one | `9a20458c-d5fd-4b44-80e7-f47ad7bae311` |
   | What `.env` and step 4 say | `149615d2-4f88-4222-b69c-f3b82f2b8901` |

   A real Microsoft sign-in against the live project completed on 2026-08-19 at
   15:46 and was granted `admin`, so `9a20458c…` is the app registration that
   is actually wired up, and it already carries the handler redirect URI. Which
   also means the redirect URI added on 2026-08-18 went onto `149615d2…` — a
   second registration nothing uses — and did nothing. Point `.env` at the live
   id so the next person is not sent to the wrong blade, and delete the spare.

### Why single-tenant is a security control here

There is no public sign-in on this site. A parishioner never authenticates —
the calendar, bulletin, giving, and contact details are public, and prayer
requests and vehicle registrations are written anonymously. Sign-in exists only
for the servants schedule and the admin surface.

So **tenant membership is the qualification**: only clergy, staff, and servants
have a parish M365 address, and a first sign-in therefore grants `servant`
automatically ([`DEFAULT_SIGNIN_ROLE`](../packages/shared/src/roles.ts)).

Which means: **if that app registration is ever switched to multi-tenant, every
Microsoft account on earth becomes a servant.** `enforceTenantOnCreate` in
[`functions/src/auth.ts`](../functions/src/auth.ts) re-checks the `tid` claim on
every account creation for exactly that reason, so a change in the Azure portal
cannot silently open the door — but keep both in agreement.

`staff` and `admin` are never inferred. They come from `setMemberRole`, per
person. Bootstrap the first one with:

```bash
node scripts/grant-admin.mjs someone@spsmwayland.org --write
```

### One operational gap worth knowing

When someone leaves the parish, Entra stops them signing in *afresh* — but their
existing Firebase account and its refresh token survive, and Firebase does not
re-check the IdP on refresh. Removing someone therefore means disabling their
Firebase Auth user and revoking their refresh tokens, not just removing them
from the directory.

---

## Checklist

- [ ] Firebase project created, Firestore in production mode, location chosen
- [x] Auth provider enabled — **Microsoft only**, deliberately. Email/Password
      and Google are off; an enabled provider nobody uses is a way in nobody
      watches
- [ ] Web app registered, six `NEXT_PUBLIC_FIREBASE_*` values in `.env.local`
- [ ] Blaze upgrade + budget alert (before Functions)
- [ ] Square developer app created, **sandbox** credentials in `.env.local`
- [ ] Square location ID copied
- [ ] Webhook subscription + signature key (after first Functions deploy)
- [x] Entra ID app registration — client id and tenant id are in `.env`
- [x] **Entra redirect URI** — `https://spsm-database.firebaseapp.com/__/auth/handler`
      on the app registration's **Authentication** blade. Missing on 2026-08-18:
      sign-in reached Microsoft, took the password, then failed with AADSTS50011.
      **Working as of 2026-08-19** — a real Microsoft sign-in against the live
      project completed at 15:46 and was granted `admin`. The registration that
      carries it is `9a20458c-…`, *not* the `149615d2-…` in `.env`; see §3 step 7
- [ ] **Delete the spare Entra app registration** (`149615d2-…`) and point
      `NEXT_PUBLIC_AZURE_CLIENT_ID` at the live one. Harmless today, because
      nothing reads the variable — but it is the value anyone debugging sign-in
      will trust, and it sent one such debugging session to the wrong blade
- [ ] **Firebase authorized domains** — `www.spsmwayland.org` and
      `spsmwayland.org` are *not* on the list (checked 2026-08-18; it holds
      `localhost`, `spsm-database.firebaseapp.com`, `spsm-database.web.app` and
      one preview channel). Sign-in works locally and will fail on the real
      domain with `auth/unauthorized-domain` until they are added under
      Authentication → Settings → Authorized domains. This is a different list
      in a different console from the redirect URI above — both are needed
- [ ] **Confirm the app registration is single-tenant** ("Accounts in this
      organizational directory only"). This is now a security control, not a
      preference — see §3 below
