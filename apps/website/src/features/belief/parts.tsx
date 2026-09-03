import { EditableCaption } from '@/features/about/EditableCaption';
import {
  BELIEF_CREDITS,
  BELIEF_PICTURES,
  beliefLarge,
  beliefSmall,
  type BeliefPictureName,
} from './images';

/**
 * A framed picture with its caption.
 *
 * Every picture on this page is one of these, and there is no lightbox. The
 * tour has one because its galleries are the point of the station; here the
 * pictures illustrate an argument the reader is in the middle of, and a modal
 * that takes over the screen — and, with it, focus and body scroll — is a way
 * of losing their place in a long page. A caption that says what the thing is
 * does the job the enlargement would have done.
 *
 * `sizes` is measured, not guessed: the plate is the full column on a phone,
 * and 22rem beside prose from 60rem up — the widest of the two side columns
 * this page uses. Overstating it makes every desktop fetch the large file for a
 * 352px slot. The srcset descriptor for the large file is that file's real
 * width, not 1280 — see the note in `images.ts` about `withoutEnlargement`.
 */
export function Plate({
  name,
  className = '',
  captionSlot,
}: {
  name: BeliefPictureName;
  className?: string;
  /** Makes the caption rewritable. See `EditableCaption`. */
  captionSlot?: string | undefined;
}) {
  const picture = BELIEF_PICTURES[name];

  return (
    <figure className={`belief-plate belief-plate--${picture.shape} ${className}`.trim()}>
      <img
        className="belief-plate__img"
        src={beliefLarge(name)}
        srcSet={`${beliefSmall(name)} 640w, ${beliefLarge(name)} ${picture.width}w`}
        sizes="(min-width: 60rem) 22rem, 100vw"
        alt={picture.alt}
        width={picture.width}
        height={picture.height}
        loading="lazy"
        decoding="async"
      />
      <EditableCaption slot={captionSlot} className="belief-plate__caption">
        {picture.caption}
      </EditableCaption>
    </figure>
  );
}

/**
 * A picture that runs the full width of its band rather than sitting beside
 * prose — used for the two landscape paintings, which lose their subject
 * entirely at column width.
 */
export function WidePlate({
  name,
  captionSlot,
}: {
  name: BeliefPictureName;
  captionSlot?: string | undefined;
}) {
  const picture = BELIEF_PICTURES[name];

  return (
    <figure className="belief-plate belief-plate--full">
      <img
        className="belief-plate__img"
        src={beliefLarge(name)}
        srcSet={`${beliefSmall(name)} 640w, ${beliefLarge(name)} ${picture.width}w`}
        sizes="(min-width: 80rem) 74rem, 100vw"
        alt={picture.alt}
        width={picture.width}
        height={picture.height}
        loading="lazy"
        decoding="async"
      />
      <EditableCaption slot={captionSlot} className="belief-plate__caption">
        {picture.caption}
      </EditableCaption>
    </figure>
  );
}

/**
 * The picture credits — in the page, not on it.
 *
 * ---------------------------------------------------------------------------
 * They were printed at the foot in their own band. Tommy: *"hide the photo
 * credits."* So the block is `visually-hidden` — clipped to a pixel, still in
 * the markup, still read by a screen reader, still there in view-source and in
 * the static export.
 *
 * **It cannot simply be deleted.** Three of the eleven pictures are licensed
 * rather than public domain — the Hanging Church interior (CC BY 3.0 pl), the
 * baptism (CC BY-SA 4.0) and the Wadi al-Natrun frescos (CC BY-SA 3.0) — and
 * all three require the author, the licence and a link wherever they are
 * published. If the credits ever need to be gone outright, the way to do it is
 * to replace those three files with public-domain ones in `assets/belief/` and
 * then remove this; not to drop the attribution and keep the pictures.
 *
 * The other eight are public domain and are listed anyway, because a credits
 * list that silently drops what it is not *obliged* to name teaches the next
 * person that the list is optional.
 * ---------------------------------------------------------------------------
 */
export function Credits() {
  return (
    <div className="visually-hidden">
      <h2 id="picture-credits">Picture credits</h2>
      <p>
        Every picture on this page is from Wikimedia Commons and is public domain or freely
        licensed. None of them is a photograph of this church.
      </p>
      <ul>
        {BELIEF_CREDITS.map((credit) => (
          <li key={credit.name}>
            <a href={credit.page} rel="noreferrer">
              {BELIEF_PICTURES[credit.name].short}
            </a>
            {` — ${credit.author} · ${credit.license}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
