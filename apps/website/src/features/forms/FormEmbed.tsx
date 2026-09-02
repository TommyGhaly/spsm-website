'use client';

import { embedFormUrl } from '@spsm/shared';

/**
 * Somebody else's form, on a page of ours.
 *
 * ---------------------------------------------------------------------------
 * The frame is ours; everything inside it is the host's.
 *
 * Two hosts today, and the component knows about neither: Tithe.ly for
 * anything that takes money, Breeze for the request forms the parish has kept
 * there. Both are an address in `FormDefinition.externalUrl` and nothing else.
 *
 * `features/giving/GiveButton` is the precedent and it carries the long version
 * of the argument, which is worth repeating in one line here because it is the
 * reason this is an iframe rather than Tithe.ly's own embed script: their
 * `give.js` bails to `window.open(url, '_blank')` on Chrome, on Safari, and
 * under 768px — which is nearly every visitor — so their documented "modal" is
 * a new tab for almost everybody. Framing it ourselves is what keeps a
 * Tithe.ly form on a parish page.
 *
 * What that overrides is a vendor's own decision, so the escape hatch below is
 * not decoration. A framed page can refuse to be framed — an
 * `X-Frame-Options` header, a login redirect that will not run in a frame, a
 * form that measures its own width and gives up — and the failure looks like a
 * blank rectangle with nothing to click. **The link is always rendered, above
 * the frame, before anyone has to discover the frame is broken.** It is not
 * shown only on failure, because a page cannot detect this failure: a refused
 * frame and a slow one look identical from out here.
 *
 * ## Why it cannot be made to match the site, and what is done instead
 *
 * Nothing inside the frame can be styled. It is cross-origin by definition —
 * that is the whole security model — so Breeze's slate blue, its own copy of
 * the parish crest and its two-column header are simply what a visitor sees,
 * and no amount of CSS on our side reaches them.
 *
 * What that leaves is our *own* chrome, and the fix was to have almost none of
 * it. Tommy, on the first version: *"this looks horrible not going to lie"* —
 * correctly, because our masthead, a picture band, a bordered box and two
 * uppercase paragraphs stacked four pieces of decoration on top of a form that
 * arrives with its own. Now: no band, no border, one quiet line. The page reads
 * as the church's, then gets out of the way.
 *
 * The picture is not lost — it is what the card on /forms wears, which is where
 * it was asked for and where it does its work.
 *
 * `allow="payment"` delegates the Payment Request API, which is what makes
 * Apple Pay and Google Pay work inside the frame on a form that takes money.
 * Do not remove it to "tighten" the embed — unavailable wallets are the
 * likeliest reason Tithe.ly's script avoids framing in the first place. It is
 * harmless on a form that takes no payment, which is why it is not conditional.
 *
 * No `sandbox` attribute, deliberately. Sandboxing a payment form strips the
 * same-origin storage and popups its own checkout depends on, and the frame is
 * cross-origin already: it cannot read this page, and this page cannot read it.
 * ---------------------------------------------------------------------------
 */
export function FormEmbed({ url, title, host }: { url: string; title: string; host: string }) {
  return (
    <div className="fx-embed">
      {/*
        One quiet line, carrying both facts, above the frame.

        It was two paragraphs — an escape link and a separate disclosure — and
        both used `.meta`, which uppercases. globals.css warns about exactly
        that a few lines above the rule: "a paragraph in all caps is the fastest
        way to make a helpful note look like a warning nobody reads". Between
        them they made a bigger block of our chrome than the form had of its
        own.

        Still above the frame rather than below it, for the reason that has not
        changed: a page that refuses to be framed is a blank rectangle, and a
        link underneath one of those on a phone is several scrolls past the
        point where somebody decides the site is broken.
      */}
      <p className="note fx-embed__aside">
        Hosted by {host} —{' '}
        <a href={url} target="_blank" rel="noopener noreferrer">
          open it in a new tab
        </a>{' '}
        if it does not appear below. What you enter goes to them, not to the church
        website.
      </p>

      <iframe
        className="fx-embed__frame"
        title={title}
        src={embedFormUrl(url)}
        allow="payment"
        loading="lazy"
      />
    </div>
  );
}
