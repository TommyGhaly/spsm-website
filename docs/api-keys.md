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
reading the member directory or another buyer's order.

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
the calendar, bulletin, giving, and contact details are public, and vehicle
registrations and the parish forms are written anonymously. Sign-in exists only
for the servants schedule and the admin surface.

So **tenant membership is the qualification**: only clergy, staff, and servants
have a parish M365 address, and being able to authenticate at all is therefore
what earns an account and the servants' rota — see
[`packages/shared/src/claims.ts`](../packages/shared/src/claims.ts).

Which means: **if that app registration is ever switched to multi-tenant, every
Microsoft account on earth can read the servants' rota.** `servantEvents` in
`firestore.rules` is `signedIn()` and nothing more, deliberately — needing a
grant to see when you are serving would be exactly backwards — so this app
registration is the only thing standing in front of it.
`enforceTenantOnCreate` in
[`functions/src/auth.ts`](../functions/src/auth.ts) re-checks the `tid` claim on
every account creation for exactly that reason, so a change in the Azure portal
cannot silently open the door — but keep both in agreement.

**Nothing else is inferred, and there are no roles.** Every other privilege is a
flag or a program id on the person's member document, handed out by a superadmin
at `/access`. The one exception is `superadmin` itself, which is a custom claim
because it is the power to hand out all the rest — so it is set from a terminal,
per person, and by nothing on the site:

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

## 4. Resend — the only thing that actually sends mail

Nothing on this site could send an email until this was set up, and the failure
was completely silent.

Two Functions queue outbound mail by writing a document to the `mail`
collection and then stopping. `squareCheckout` writes the bookstore
confirmation — the half Square's own receipt cannot carry, telling the buyer
whether the books are to be collected or delivered. `formSubmit` writes two: the
notification to whoever the form names, and the submitter's copy. Neither
Function has a transport. Both were written against the **Trigger Email**
extension, which watches that collection and delivers what it finds.

The extension was never installed. Checked 2026-09-05:

```
$ firebase ext:list --project spsm-database
i  extensions: there are no extensions installed on project spsm-database.
```

So every message any of those Functions ever produced was written to Firestore
and left there. The tell is in the documents themselves: they carry no
`delivery` field at all, and the extension stamps `delivery.state` the instant
it picks one up. Nothing had ever read the collection.

**The backlog does not go out by itself.** This section claimed the opposite
until 2026-09-08, and it was wrong. The extension's function triggers on
document *create*, so a document written before the extension existed never
fires it — proven the day it was installed: the self-test written after the
install reached `SUCCESS` in two seconds, and the bookstore receipt queued on
2026-09-05 still had no `delivery` field at all beside it.

Delivering one of those means writing it again under a new document id, which is
a decision per message rather than a cleanup: a "your order is ready to collect"
that arrives three days late may be a courtesy or may be a confusion, and only
the church can say which. The queued documents are intact either way, so nothing
is lost by leaving them.

### Why a subdomain, and why this is not optional

The church's real mail is Microsoft 365 (`MX` is
`spsmwayland-org.mail.protection.outlook.com`), and the root domain publishes:

```
v=spf1 include:spf.protection.outlook.com -all
```

That `-all` is a **hard fail**: it says Microsoft may send as
`@spsmwayland.org` and nobody else may. Sending a receipt from the root domain
through Resend fails that check at every receiving server. The two ways out are
to edit the church's live SPF record — risking their actual mail for the sake of
a receipt — or to send from a subdomain that carries its own SPF and DKIM and
leaves the root untouched. We do the second.

`mail.spsmwayland.org` has no DNS records of any kind (still true 2026-09-08 —
`dig +short TXT mail.spsmwayland.org` returns nothing), so nothing is being taken
over. Note where the records go: **Porkbun**, not Wix and not Microsoft 365. The
domain was transferred there on 2026-09-07 and the registry now delegates it to
four `*.ns.porkbun.com` nameservers; the `ns10`/`ns11.wixdns.net` this file used
to name are gone. Check before you start — `dig +short NS spsmwayland.org` — and
edit the zone wherever that says.

### Steps

1. <https://resend.com> → create an account. Free tier is 3,000 emails/month;
   this site will not come close.
2. **Domains → Add Domain** → `mail.spsmwayland.org`. Region: keep the US one.
3. Resend shows three records — a `TXT` for SPF, a `TXT` for DKIM, and usually a
   `MX` for return-path. Add all three at **Porkbun**, under the domain's DNS
   records. Verification takes minutes, occasionally an hour. Neither church
   domain has a DKIM selector or a `_dmarc` record today, so the names Resend
   gives you collide with nothing.

   Add them on `mail.spsmwayland.org`, and touch no record on the bare domain.
   The apex `TXT` holds the M365 SPF and the tenant's `MS=` verification, and the
   apex `MX` is the church's live mail — an edit there is a mail outage for the
   whole church, discovered by somebody who cannot receive a message on a
   Sunday.
4. **API Keys → Create API Key.** Permission: **Sending access** only. Scope it
   to the domain above. Copy it once — Resend never shows it again.
5. **Put the key in Secret Manager yourself, first.** It is not prompted for —
   see the warning after this list, which is the trap that swallowed the first
   install. Copy the key to the clipboard, then:

   ```
   pbpaste | tr -d '\n' | gcloud secrets create \
     ext-firestore-send-email-SMTP_PASSWORD --data-file=- --project spsm-database
   ```

   `tr -d '\n'` matters: a trailing newline is stored as part of the secret and
   fails SMTP auth with an error that reads like a wrong key. Verify it without
   revealing it — a Resend key is 36 characters beginning `re_`:

   ```
   gcloud secrets versions access latest \
     --secret ext-firestore-send-email-SMTP_PASSWORD --project spsm-database | wc -c
   ```

   Then grant the extension's own service account read access, which creating it
   does not do:

   ```
   gcloud secrets add-iam-policy-binding ext-firestore-send-email-SMTP_PASSWORD \
     --member=serviceAccount:ext-firestore-send-email@spsm-database.iam.gserviceaccount.com \
     --role=roles/secretmanager.secretAccessor --project spsm-database
   ```

6. Deploy the extension. `SMTP_PASSWORD` in the env file is the secret's
   **resource path**, so there is nothing to type:

   ```
   firebase deploy --only extensions --project spsm-database
   ```

   Everything except the key is already committed, in
   [`extensions/firestore-send-email.env`](../extensions/firestore-send-email.env)
   and declared in `firebase.json`. Read the comments in that file before
   changing a value — in particular `DATABASE_REGION`, which must be `us-east1`
   and not the `us-central1` the console offers by default.

   **It does not prompt for the key, interactive or not.** This is the trap, and
   it is the reason the first install on 2026-09-08 produced a working extension
   that sent nothing. `firebase deploy --only extensions` takes its parameters
   from the env file, and a secret parameter that is simply *absent* there is not
   asked for: the CLI printed "Verifying secret params", reported "Successfully
   validated create", created the instance, and reached `ACTIVE` with no error
   and no `SMTP_PASSWORD` param at all. The advice this file used to give — "run
   it interactively, because it prompts" — is what caused that. Step 5 is the fix:
   the key goes in by hand and the env file names it.

   Check the instance carries it before believing anything:

   ```
   TOKEN=$(gcloud auth print-access-token)
   curl -s -H "Authorization: Bearer $TOKEN" \
     "https://firebaseextensions.googleapis.com/v1beta/projects/spsm-database/instances/firestore-send-email" \
     | python3 -c "import json,sys; print(sorted(json.load(sys.stdin)['config']['params']))"
   ```

7. `LOCATION` in the env file is **ignored** by 0.2.10 — it is not a declared
   parameter, and the instance's functions landed in `us-central1`, the default.
   That turned out not to matter: the self-test delivered from `us-central1`
   against the `us-east1` database, so the trigger fires across regions. Where
   the functions run is a *system* parameter
   (`firebaseextensions.v1beta.function/location`) and is immutable after
   install, so correcting it would mean uninstalling. Do not, without a reason
   better than tidiness. `DATABASE_REGION` is the value the recorded trap was
   actually about, and it must stay `us-east1`.

8. CI does not do this for you. `.github/workflows` deploys hosting and the two
   rulesets on every commit to `main` and never touches Functions or extensions,
   so this is a by-hand deploy.

### After it is installed

Buy something cheap from the bookstore, then look at the document the checkout
wrote:

```
TOKEN=$(gcloud auth print-access-token)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://firestore.googleapis.com/v1/projects/spsm-database/databases/(default)/documents/mail?pageSize=20"
```

(The REST API rather than the CLI, because `firebase` has no `firestore:get` —
its `firestore:` verbs are delete, indexes and database administration. A
gcloud access token bypasses security rules the same way the Admin SDK does,
which matters here: `firestore.rules` closes `mail` to clients in *both*
directions, so no browser and no signed-in staff account can read this
collection. Same approach the seed scripts take — see
`scripts/lib/firestore-rest.mjs`.)

`delivery.state` tells you the whole story — `SUCCESS`, or `ERROR` with
`delivery.error` naming the reason. A document that still has no `delivery`
field at all means the extension is not watching this collection, and the first
thing to check is `DATABASE_REGION`.

### It is a no-reply address, and the copy has to hold up its end

`DEFAULT_FROM` is `no-reply@mail.spsmwayland.org` and `DEFAULT_REPLY_TO` is
empty, deliberately. No mailbox exists behind that address and none needs to —
the subdomain's own SPF and DKIM are what make it deliverable, not an inbox. A
reply to it bounces.

That is a real choice with a real cost, and the cost is paid in the wording
rather than in the configuration. An email that says "reply to us" from an
address that bounces has arranged for the one thing it asks the reader to do to
fail silently: the buyer believes they have reported a wrong order and the
church never hears it. So the copy has to carry the weight:

- `packages/shared/src/payments/orderEmail.ts` opens the closing paragraph with
  **"This address is not monitored."** and says **"write to"**, never "reply
  to". `tests/unit/orderEmail.test.ts` asserts both, on the plain-text *and*
  HTML parts, with and without a parish address configured — so a future edit
  cannot quietly put "reply" back.
- The address it names is `orderEmail` on the `config/bookstore` document,
  falling back to the `PARISH_EMAIL` param in `functions/.env.spsm-database`.
  Both are blank today, so the sentence reads "contact the church office" and
  names nobody. That is honest rather than useful: the buyer still has the
  reference number and the contact form on the site, but no address. Filling in
  `config/bookstore.orderEmail` is the single highest-value thing left here, and
  it needs no deploy — it is a Firestore document.

If you ever do point `DEFAULT_REPLY_TO` at a real Microsoft 365 mailbox,
**remove the "not monitored" sentence in the same commit**. A no-reply notice on
an address somebody reads is the same kind of lie in the other direction.

One thing deliberately not done: the parish's *own* copy of a form submission
(`formSubmit` → `form.notifyEmails`) also arrives from no-reply, so a reviewer
cannot reply straight to the person who filled the form in. Today they work from
the Forms & submissions drawer instead, which is what the notification tells them
to do. Setting a per-message `replyTo` to the submitter's address would fix that
properly, and `firestore-send-email` supports it — it is just not written yet.

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
- [x] **Trigger Email extension installed** — 2026-09-08, `ACTIVE`, and
      **proven**: a message written into `mail` reached `delivery.state: SUCCESS`
      in two seconds with `accepted` non-empty. Its first install that same hour
      came up `ACTIVE` with no `SMTP_PASSWORD` at all and would have sent
      nothing; see the warning in §4 step 6. Note the functions run in
      `us-central1` and the trigger fires anyway
- [x] **Resend account + `mail.spsmwayland.org` verified** — 2026-09-08. Two
      records at **Porkbun** (where the domain has been since 2026-09-07), not
      Wix and not Microsoft: a `TXT` for DKIM at `resend._domainkey.mail`, and a
      **CNAME** at `send.mail` → `send.forge.rmta.net`, which is where the MX and
      SPF come from — Resend's current record set has no MX of its own to add.
      Porkbun's Host field is relative to `spsmwayland.org`, so every name Resend
      shows needs `.mail` appended; a blank Host is the apex and the church's live
      mail. A subdomain because the root SPF ends in `-all` and lists Microsoft
      only; see §4
- [x] **Resend API key in Secret Manager** as
      `ext-firestore-send-email-SMTP_PASSWORD`, referenced from the env file by
      resource path at `versions/latest` — so rotating the key is
      `gcloud secrets versions add` and no reconfigure. The extension's service
      account holds `secretAccessor` on it
- [x] **No-reply decided** — `DEFAULT_FROM` is `no-reply@mail.spsmwayland.org`
      and `DEFAULT_REPLY_TO` is empty on purpose, so no mailbox has to be
      staffed. The copy carries the cost: "This address is not monitored", and
      "write to" rather than "reply to", both under test. Reversing this means
      deleting that sentence in the same commit; see §4
- [x] **`config/bookstore.orderEmail`** — `info@spsmwayland.org` as of
      2026-09-08. It was blank until then, so a receipt said "contact the church
      office" and named no address: a buyer with a wrong order had a reference
      number and no route, which on a no-reply receipt is a dead end. Written by
      `npm run office:email -- --write`, from `config/parish.email`. A Firestore
      document, not a deploy — it takes effect on the next checkout
- [x] **`forms/contact.notifyEmails`** — `info@spsmwayland.org`, same date and
      the same script. It was empty, and empty means **nobody is emailed** when
      somebody writes to the office: `functions/src/forms/email.ts` builds the
      notification only when the list is non-empty, so every message was stored
      in `formSubmissions` and announced to no one. The sender's copy was empty
      too and was refilled from the built-in default. Change either afterwards in
      the drawer on /forms — "Tell these addresses" — not by re-running the
      script, which never overwrites an address somebody chose
- [ ] **Confirm the app registration is single-tenant** ("Accounts in this
      organizational directory only"). This is now a security control, not a
      preference — see §3 below
