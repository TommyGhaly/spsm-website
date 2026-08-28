import { SectionHeading } from '@/components/SectionHeading';
// Across a feature boundary, so through the barrel — see features/README.md.
import { ParishAppCard, TITHELY_APP } from '@/features/apps';

/**
 * Tithe.ly's app, at the foot of /giving.
 *
 * ---------------------------------------------------------------------------
 * **It is the right app, and the URLs are not written here.** Tithe.ly ships two
 * products under similar names and they are not the same thing, so the pair of
 * store links lives once, in `features/apps/stores.ts`, where the reasoning sits
 * beside them and `/apps` reads the same record. Two copies of a store id is two
 * chances to link the wrong product.
 *
 * **The card is not written here either.** It used to be a heading, a sentence
 * and two bare badges standing on the paper, which is what the section looked
 * like when it was the smaller half of a page. It shows the same card `/apps`
 * shows — icon, name, publisher, badges — because the thing being asked of a
 * visitor here is the thing being asked of them there: go to a store and find a
 * blue app that is not named after this church. The icon and the publisher are
 * how they know they have found it, and neither was on this page before.
 *
 * The vendors' rules about their own badge artwork travelled with the markup, to
 * `components/StoreBadges.tsx`, and the rules about the icon and the empty icon
 * slot to `features/apps/ParishAppCard.tsx`.
 * ---------------------------------------------------------------------------
 */
export function GivingApps() {
  /*
   * Plain `.band`, not `.band--sunken`.
   *
   * The page is two bands and a footer, which is short enough that `main`'s
   * `flex: 1` stretches past the last section and leaves the body's own paper
   * showing beneath it. Against `--color-paper-sunken` that read as a stray pale
   * strip above the footer; on plain paper the band and the space under it are
   * one surface. The seam at the top is already drawn — `.band--deep` closes
   * itself with a gold hairline.
   */
  return (
    <section className="band give-apps" aria-labelledby="apps-heading">
      <div className="wrap">
        {/*
          `SectionHeading` rather than the eyebrow and `h2` written out, which is
          what stood here. Every other section on the site opens with the gold
          rule this draws before the eyebrow; hand-rolled, this one quietly did
          not, and the section read as a loose paragraph at the end of the page
          rather than as a section.

          No `note`: the sentence that was here is now the card's own, one line
          below, and saying it twice a centimetre apart is worse than either.
        */}
        <SectionHeading id="apps-heading" eyebrow="The app" title="Giving from a phone" />

        {/*
          `as="div"`, because this is one app and not a list of one — see the
          note on the prop. `showMore` off: the app's "more" link points at this
          page.
        */}
        <ParishAppCard
          app={TITHELY_APP}
          as="div"
          showMore={false}
          /* The stored sentence ends "the same offering as the form on the
             Giving page", which is odd to read one screen below that form. */
          what="Gives to the church from a phone, once or on a schedule — the same offering as the form above."
        />
      </div>
    </section>
  );
}
