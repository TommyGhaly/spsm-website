'use client';

import type { ReactNode } from 'react';
import { hasPicture, type AboutImage } from '@spsm/shared';
import { useEditMode } from '@/features/programs/editMode';
import { useAboutOverlay } from './context';

/**
 * One replaceable photograph in a hand-written band.
 *
 * ---------------------------------------------------------------------------
 * ## It wraps the coded figure rather than replacing it
 *
 * With no override, `children` renders — which means the real `<Plate>`, with
 * the srcset the build computed from the committed 640/1280 pair, its measured
 * `sizes`, its intrinsic width and height so nothing reflows, and the alt text
 * and caption somebody wrote for that specific picture. None of that can be
 * reconstructed here, so none of it is touched.
 *
 * An override renders a plain `<figure>` at whatever the chosen `src` is. A
 * chosen library picture still carries alt text and a caption, because
 * `choices.ts` keeps them beside the path; an *uploaded* one has whatever staff
 * typed. That asymmetry is the honest reason the picker lists the library first.
 *
 * ## An empty override is not an override
 *
 * `hasPicture` requires a non-blank `src`. A half-written image object — a
 * caption typed before a picture was chosen, a `src` cleared — falls through to
 * the coded plate. This is the rule the bookstore learnt the hard way when a
 * live swap believed an empty list and blanked every cover in the shop.
 *
 * ## In edit mode it is a target, not a picker
 *
 * The picker was inline, under the photograph. It is in the column now, with the
 * rest of the band's fields — so clicking the photograph selects its band and
 * everything about that band is in one place. See `AboutPanel`.
 * ---------------------------------------------------------------------------
 */
export function EditablePicture({
  slot,
  className,
  children,
}: {
  slot: string;
  className?: string | undefined;
  children: ReactNode;
}) {
  const { current, ops } = useAboutOverlay();
  const { select, isSelected } = useEditMode();
  const override = current?.slots[slot];
  const chosen = hasPicture(override) ? (override?.image as AboutImage) : null;

  const picture = chosen ? <AboutFigure image={chosen} className={className} /> : <>{children}</>;

  if (!ops) return picture;

  const band = slot.split('.')[0] ?? slot;
  const selected = isSelected({ kind: 'section', key: band });

  /*
   * A `div` wrapper is safe here where it was not for `Editable`: what this
   * wraps is a `figure`, which is never a grid item of a band's own layout — the
   * plate's own class does that positioning and it is passed straight through.
   */
  return (
    <div
      className={`ab-target${selected ? ' is-selected' : ''} ${className ?? ''}`.trim()}
      data-about-slot={slot}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label="Change this photograph"
      onClick={() => select({ kind: 'section', key: band })}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        select({ kind: 'section', key: band });
      }}
    >
      {picture}
    </div>
  );
}

/** An overridden photograph. Deliberately plain — see the header. */
function AboutFigure({ image, className }: { image: AboutImage; className?: string | undefined }) {
  return (
    <figure className={`about-plate ${className ?? ''}`.trim()}>
      <img
        className="about-plate__img"
        src={image.src}
        alt={image.alt ?? ''}
        {...(image.width ? { width: image.width } : {})}
        {...(image.height ? { height: image.height } : {})}
        loading="lazy"
        decoding="async"
      />
      {image.caption && <figcaption className="about-plate__caption">{image.caption}</figcaption>}
    </figure>
  );
}
