import { GiveButton } from "./GiveButton";

/**
 * The top of /giving: a dome, a verse, and the one thing the page is for.
 *
 * ---------------------------------------------------------------------------
 * This replaced three paragraphs and a text link on plain paper. The page that
 * asks something of a visitor was the only one on the site with nothing to look
 * at, and the ask itself was an inline `<a>` in the middle of the second
 * paragraph.
 *
 * The photograph is `Donation_backgroudn.png`, added by Tommy for this page. It
 * is a dome and its cross against the sky — a detail, not a building, which is
 * what lets it sit here when the parish's two stock exteriors cannot: they read
 * as "our church" and are not. The crop is cut in the asset pipeline, landscape
 * and portrait, rather than left to `object-fit` on one square file.
 *
 * The verse is 1 Chronicles 29:14 — David's, at the offering for the Temple, and
 * said at the altar in the Liturgy. It is here rather than 2 Corinthians 9:7
 * because the homepage band already carries that one, and because this is the
 * sentence that says what an offering *is*: not a gift to God but the return of
 * what was His.
 * ---------------------------------------------------------------------------
 */
export function GivingHero() {
  return (
    <section
      className="band band--deep give-hero"
      aria-labelledby="giving-heading"
    >
      {/*
        Art direction, not just resolution: the landscape crop is 2.4:1 and the
        band on a phone is taller than it is wide, so `cover` would throw away
        the sky the cross stands in and leave a strip of dome. The portrait
        source is a different window on the same negative — dome, cross, and the
        bells below it.

        `<img>` rather than a CSS background for the reason the homepage hero
        uses one: `srcSet` lets the browser pick a width. `aria-hidden` with an
        empty `alt` because it is decoration — the page says what it is about in
        text.
      */}
      <picture>
        <source
          media="(max-width: 43rem)"
          srcSet="/img/hero-giving-portrait-600.webp 600w, /img/hero-giving-portrait-900.webp 900w"
          sizes="100vw"
        />
        <img
          className="give-hero__photo"
          src="/img/hero-giving-1600.webp"
          srcSet="/img/hero-giving-1000.webp 1000w, /img/hero-giving-1600.webp 1600w"
          sizes="100vw"
          alt=""
          aria-hidden="true"
          width={1600}
          height={666}
          /* Above the fold on its own page, so not lazy — the band would
             otherwise paint as flat oxblood and then fill in. */
          decoding="async"
          fetchPriority="high"
        />
      </picture>

      {/* The words sit over a sunlit tree and a pale sky — the lightest ground on
          the site — so this is not optional decoration. See `.give-hero__veil`. */}
      <div className="give-hero__veil" />

      {/*
        The text sits in the *right* half of the band, which is the one thing
        here that is not the site's usual left-aligned habit — and it is the
        photograph's doing, not a preference.

        The dome is 36% across in the source frame and there is nothing to its
        left to crop away, so no crop wide enough to hold the whole cross puts
        the subject anywhere but left of centre. Text on the left ran straight
        over the cross. Given the choice between covering the subject and moving
        the column, the column moves: the dome and cross stand clear on the left,
        the words sit over the tree, and the veil is mirrored to suit.
      */}
      <div className="wrap give-hero__inner">
        {/*
          A second element inside `.wrap` rather than a `max-width` on `.wrap`
          itself. Narrowing `.wrap` does not move its contents left or right — it
          narrows the auto-margined box, so the whole column re-centres in the
          window, which is a bug this codebase has already been bitten by once.
          The wrap keeps the shell width; this is what sits at one end of it.
        */}
        <div className="give-hero__body">
          <p className="section-head__eyebrow">Offering</p>
          <h2 id="giving-heading">Giving to the church</h2>

          <p className="give-hero__verse">
            &ldquo;For all things come from You, and of Your own we have given You.&rdquo;
            <cite>1 Chronicles 29:14</cite>
          </p>

          <div className="hero__actions give-hero__actions">
            <GiveButton>Give</GiveButton>
          </div>

          {/* `.note`, not `.meta`: `.meta` uppercases, which is right for a date stamp
              and unreadable for a sentence. See the comment on `.note` in globals.css. */}
          <p className="note give-hero__note">
            Tithe.ly processes the payment. The church website never sees your card details.
          </p>
        </div>
      </div>
    </section>
  );
}
