import {
  SAINT_CREDITS,
  SAINT_IMAGES,
  saintFull,
  saintThumb,
  type Feast,
} from './saints';

/**
 * The pieces /about/patron-saints is built out of.
 *
 * ---------------------------------------------------------------------------
 * Every one of these is a server component and none of them ships a byte of
 * JavaScript. The tour next door is interactive because a visitor walks it
 * holding a phone in a hall; this page is two lives and seven pictures, and a
 * reader wants to read it. Nothing here opens, folds, animates or waits.
 *
 * That is also why there is no lightbox. A picture that grows when tapped needs
 * a client component, a focus trap and an escape key, and what it buys on this
 * page is a closer look at a mosaic. The captions carry the point instead, and
 * anybody who wants the full plate has the credits list at the foot with a link
 * to the original.
 * ---------------------------------------------------------------------------
 */

/**
 * One picture with its caption.
 *
 * `<figure>` and `<figcaption>`, so the caption is attached to the image in the
 * accessibility tree rather than merely printed under it. The alt text and the
 * caption say different things on purpose — see `SaintImage`.
 *
 * The image is never lazy when `priority` is set. The two portrait icons in the
 * opening band are the first thing on the page and eager, and everything below
 * the fold is lazy, which is the whole of the loading strategy: seven pictures,
 * two of them wanted immediately.
 */
export function SaintFigure({
  slug,
  priority = false,
  name,
  also,
}: {
  slug: string;
  priority?: boolean;
  /** The saint's name, for the two figures in the opening diptych. It goes
   *  *inside* the caption rather than under the whole figure: the name and the
   *  caption belong to the same picture, and printed as two separate blocks
   *  they end at different heights on two figures side by side and the pair
   *  stops looking like a pair. */
  name?: string;
  /** What he is called in Arabic — Abu Sefein, Abu Mina. */
  also?: string;
}) {
  const image = SAINT_IMAGES[slug];
  if (!image) return null;

  return (
    <figure className="saint-figure">
      <img
        className="saint-figure__image"
        src={saintFull(image.slug)}
        /*
         * Two files, and the browser picks. 520 is what a phone actually needs
         * — the figure is one column wide there — and it is a quarter of the
         * bytes. `sizes` says the truth about the layout rather than guessing:
         * full width up to the two-column breakpoint, and a little under half
         * the shell above it.
         */
        srcSet={`${saintThumb(image.slug)} 520w, ${saintFull(image.slug)} ${image.width}w`}
        sizes="(min-width: 60rem) 30rem, 92vw"
        alt={image.alt}
        width={image.width}
        height={image.height}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
      />
      <figcaption className="saint-figure__caption">
        {name && (
          <span className="saint-figure__name">
            {name}
            {also && <span className="saint-figure__also">{also}</span>}
          </span>
        )}
        {image.caption}
      </figcaption>
    </figure>
  );
}

/**
 * A picture as a tile in the iconography grid — smaller, squarer, and cropped
 * by `object-fit` rather than by the asset pipeline.
 *
 * The crop is in CSS and not in the built file because these same files are the
 * figures above: cropping them on disk would either cost a third size of every
 * picture or force the figures to use the cropped one. See the saints block in
 * `scripts/optimize-assets.mjs` for why nothing here is cropped on the way out.
 */
export function SaintTile({ slug }: { slug: string }) {
  const image = SAINT_IMAGES[slug];
  if (!image) return null;

  return (
    <figure className="saint-tile">
      <img
        className="saint-tile__image"
        /*
         * The picture's own proportions, for the phone rule that takes the crop
         * off — see `.saint-tile__image` and the `max-width: 34rem` block. It
         * has to be a declared ratio rather than `aspect-ratio: auto`: these
         * images are lazy, and an unloaded one with no ratio in the CSS
         * collapses to the height of its own border until it arrives, which
         * moves everything under it down the page when it does.
         */
        style={{ ['--tile-ratio' as string]: `${image.width} / ${image.height}` }}
        src={saintThumb(image.slug)}
        alt={image.alt}
        width={520}
        height={Math.round((520 * image.height) / image.width)}
        loading="lazy"
        decoding="async"
      />
      <figcaption className="saint-tile__caption">{image.caption}</figcaption>
    </figure>
  );
}

/**
 * The days the Church keeps for one saint.
 *
 * A description list, because that is what it is — a date and what falls on it
 * — and a table would be three columns for two rows. The Coptic date leads:
 * this is the Coptic Orthodox calendar, and the Gregorian equivalent is the
 * translation, not the other way round.
 */
export function FeastList({ feasts, label }: { feasts: readonly Feast[]; label: string }) {
  return (
    <div className="saint-feasts">
      <p className="saint-feasts__label">{label}</p>
      <dl className="saint-feasts__list">
        {feasts.map((feast) => (
          <div className="saint-feasts__row" key={feast.coptic}>
            <dt>
              <span className="saint-feasts__coptic">{feast.coptic}</span>
              <span className="saint-feasts__gregorian">{feast.gregorian}</span>
            </dt>
            <dd>{feast.what}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Where the pictures came from.
 *
 * ---------------------------------------------------------------------------
 * **In the markup, off the screen.** This was an open list in a band of its own
 * and Tommy had it hidden — *"hide the photo credits"* — which is right for the
 * page: a reader who has just been told two lives should not close on a table
 * of licences.
 *
 * `visually-hidden` rather than a `<details>`, to match what /about/our-belief
 * does with its eleven. A fold would be an "opening section", which is the
 * pattern Tommy had taken out of the festival tour on the same day.
 *
 * Not deleted, and this is the part to leave alone: four of these seven are CC
 * BY or CC BY-SA, and naming the author, the licence and the source is the
 * condition the parish holds them under. To get the credits out of the page
 * altogether, replace those four originals in `assets/saints/` with CC0 or
 * public-domain ones *first*. See the note above `SAINT_CREDITS`.
 * ---------------------------------------------------------------------------
 */
export function PictureCredits() {
  return (
    <div className="saint-credits visually-hidden">
      <p className="note">
        None of these pictures is of this church. They are from Wikimedia
        Commons — icons, museum objects and an excavated site — and each is
        public domain, CC0, CC BY or CC BY&#8209;SA, linked below to its source
        and its licence.
      </p>
      <ul className="saint-credits__list">
        {SAINT_CREDITS.map((credit) => (
          <li key={credit.slug}>
            <a href={credit.page} rel="noreferrer noopener" target="_blank">
              {credit.what}
            </a>
            <span className="saint-credits__meta">
              {credit.author} · {credit.license}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
