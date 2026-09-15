# Apple Pay and Google Pay

The parish takes card payments through Square's Web Payments SDK on three
screens — the bookstore checkout, a paid parish form, and the summer camp's
servant sign-up. This is what it took to add the two wallets beside the card
field, and, more usefully, what has to be true in Square's own Developer
Console for them to appear at all.

## The short version

Apple Pay and Google Pay are not a payment integration. They are a *tokenizer*:
both hand back the same single-use token a typed card number produces, and it
goes to the same `sourceId` field on the same endpoint. **No Cloud Function
changed to add them.** `functions/src/checkout.ts` reads one `sourceId` and has
never known, or needed to know, what minted it.

What they do need is a domain that Square has verified with Apple, and a
`paymentRequest` whose total is exactly what the server will charge.

## Apple Pay: no Apple Developer account, no certificate

This is worth stating plainly because the opposite is easy to believe and costs
an afternoon. Square is the merchant of record here. It holds the Apple Pay
merchant identifier and the payment processing certificate, and it performs the
merchant validation handshake when the payment sheet opens. The parish needs
none of:

- an Apple Pay merchant ID in the Apple Developer portal,
- a certificate signing request,
- an Apple Pay Payment Processing Certificate (`apple_pay.cer`).

A CSR and a `.cer` **are** required for Apple Pay inside a native iOS app, which
is a different integration with a different SDK. If a pair of those turns up
while this is being set up, they belong to that, not to this.

What the parish does need is one file, described next.

### The domain association file

`apps/website/public/.well-known/apple-developer-merchantid-domain-association`
is downloaded from the Square Developer Console and committed verbatim. It is
Square's file, not ours — it carries Square's `pspId` and signature — so it is
not a secret, and it is replaced by re-downloading rather than by editing.

Three things about it, each of which fails silently if got wrong:

1. **No file extension.** Adding `.txt` breaks it. Firebase Hosting therefore
   has no extension to guess a type from and would serve it as
   `application/octet-stream`, so `firebase.json` sets `text/plain` for this
   exact path — as the last entry in the `headers` array, because a later rule
   wins per header name and the `**` rules above it would otherwise take it.
2. **It must return 200, not a redirect.** Apple follows no redirect here. The
   apex `spsmwayland.org` 301s to `www.spsmwayland.org`, so **the domain
   registered with Square must be `www.spsmwayland.org`** — registering the apex
   verifies against a 301 and fails.
3. **It is not in `out/`.** `out/` is a generated export CI rebuilds on every
   commit; Next copies `public/` into it verbatim. Same reasoning as the two
   App Clip association files beside it, and the same note in `firebase.json`
   about why `**/.*` must never go back into Hosting's `ignore` list.

Verify it after a deploy, from outside the build:

```bash
curl -sI https://www.spsmwayland.org/.well-known/apple-developer-merchantid-domain-association
```

A `200` with `content-type: text/plain` is the pass. A `301` means the apex was
used; a `404` means `**/.*` is back in the Hosting ignore list.

### Registering the domain with Square

Sandbox and production are separate registrations against separate
applications, and the same file serves both. In the Square Developer Console,
for the application whose id is in `NEXT_PUBLIC_SQUARE_APPLICATION_ID`:

1. Set the mode (Sandbox or Production) to match `NEXT_PUBLIC_SQUARE_ENVIRONMENT`.
2. Open **Apple Pay** and add `www.spsmwayland.org`.
3. Square fetches the file at the moment you press add. **Deploy first.**

A registration that has not happened does not produce an error anywhere: the
Apple Pay button simply never renders, on a browser that has Apple Pay, and the
card form below it works perfectly. That absence is the only symptom.

## Google Pay: nothing to register

Square is a Google Pay-approved processor and vouches for the site, so there is
no Google Pay & Wallet Console step and no second verification file. The button
appears wherever the browser offers Google Pay and HTTPS is in play — including
`http://localhost`, which browsers treat as a secure origin, so unlike Apple Pay
it can be seen while developing.

## What had to change in `firebase.json`

Beyond the content type above, one header: `Permissions-Policy`. The wallet
buttons call the Payment Request API from inside Square's frames, and that
header has to name every cross-origin host those frames come from. The `payment`
allowlist now names `web.squarecdn.com` and `js.squareup.com`, each with its
sandbox twin, matching the wallet hosts already in `script-src` and `frame-src`.

A host missing from that list fails in the worst available way: the button does
not render, nothing in the console names the header, and card payment keeps
working — so it reads as a feature nobody built rather than one being blocked.

## The rule for adding a wallet to a fourth screen

`useSquareWallets` takes `amountCents`, and that figure is shown to the payer
before they authorize. **Only mount it with a total that is exactly what the
server will charge.**

The bookstore is where this was got wrong first, and it is worth recording how.
`total` there is the books; the delivery charge was added server-side from
`config/bookstore` at charge time and never reached the page. The first answer
was to offer the wallets on collection orders and withhold them on deliveries —
honest, because being charged $31.00 after authorizing $24.00 with a thumbprint
is the parish taking more than it showed, but it read as a broken button and it
was a workaround for the real gap.

The real gap was that the figure was not on the page. `useLiveCatalog` already
fetched `config/bookstore` every visit and threw away everything but `sections`,
so it now parses the whole document and returns `deliveryCents` too. `Shop`
passes `live.deliveryCents ?? settings.deliveryCents` down, `CardPayment`
computes `charge = total + (shipping ? deliveryCents : 0)`, and that one figure
is what the button prints and what the wallet sheet asks for. The wallets are
offered on every fulfilment.

Two things follow from that and should not be undone casually:

- **The delivery figure must be the live one, not the baked one.** The checkout
  Function reads `config/bookstore` at the moment it charges. A figure baked at
  the last deploy is one the parish may have changed since.
- **There is one total on the checkout screen.** The basket recap says
  *Subtotal*, the delivery panel names its own charge, and the button prints the
  sum. Two figures both called the total, one of them smaller, is how a checkout
  stops being trusted.

The general rule: withholding a wallet is a workaround for a total you do not
have. Go and get the total.

The forms and the camp sign-up have no such gap — `functions/src/forms/submit.ts`
and `functions/src/camp/servantRequest.ts` each charge the figure the screen
prints — so both offer the wallets unconditionally.

## The OTHER domain list, which is not the one above

There are **two** lists in the Square Developer Console and they are not the
same list. Getting the second one wrong cost most of a session.

1. **Apple Pay → domains.** What the association file is for. Governs whether
   the Apple Pay button appears.
2. **Credentials → Web Payments SDK allowed domains.** Governs whether the SDK
   initializes *at all* — card field included.

A hostname missing from the second list fails like this, and the failure names
nothing useful:

```
Uncaught (in promise) Error: Web Payments SDK was unable to be initialized in time
```

It is not a network problem and not a slow connection, despite what "in time"
suggests. Square's bootstrap iframe loads perfectly well — look for it in the
DOM and it is right there, carrying the hostname it is asking about:

```
https://sandbox.web.squarecdn.com/<v>/main-iframe.html?applicationId=…&hostname=<your host>
```

The *handshake* is what never completes, because the iframe checked that
hostname against the allowed list and found nothing. Two further things make it
hard to read: the SDK caches the failed bootstrap, so every later `payments()`
call rejects **instantly** — a timeout error with `ms: 0`, which reads like
anything except a timeout — and the message appears once per `payments()`
instance, so two hooks calling it looked like one error logged twice.

Anything served from a host not on that list is affected, which includes
`localhost`, every Firebase preview channel (their URLs are generated per
channel), and any new custom domain. Add the host to the list before concluding
anything else is wrong.

## Testing

`www.spsmwayland.org` is registered and verified. Anywhere else has to be added
to the allowed-domains list first — see above — including localhost and any
preview channel.

Google Pay can be seen in Chrome on any allowed host, sandbox credentials
included. Apple Pay cannot be tested locally at all: it needs Safari, HTTPS, and
a domain registered under the Apple Pay list, which rules out localhost by
definition. The first place it can be seen is the deployed site, in Safari, on a
device with a card in Wallet.
