import type { ReactNode } from 'react';
import { Editable } from './Editable';

/**
 * A picture's caption, rewritable where it is.
 *
 * ---------------------------------------------------------------------------
 * Tommy: *"any text on the page should be editable even captions to
 * pictures."* Right, and captions are the case most worth having: they carry
 * dates, places and attributions — "Wadi al-Natrun, tenth century" — which is
 * exactly the kind of detail somebody notices is wrong and wants fixed without
 * waiting for a deploy.
 *
 * ## Why a component rather than an `<Editable>` at each call site
 *
 * Four picture pages render a `figcaption` from a table keyed by picture name,
 * in five slightly different components. Wrapping each by hand would be five
 * copies of the same conditional, and the conditional is the interesting part:
 * with no slot given the caption renders exactly as it always did, so a plate
 * that has not been wired up yet is unaffected rather than broken.
 *
 * ## It edits the *coded* caption
 *
 * If staff replace the photograph itself, the replacement carries its own alt
 * text and caption and those are edited in the column beside the picker — see
 * `EditablePicture`. This slot is the caption of the picture the page ships
 * with. The two never both apply, because only one photograph is on screen.
 *
 * `prose` so a caption can hold an italicised title or a link to a source, which
 * several of them want; `as="figcaption"` keeps `figure`/`figcaption` intact,
 * which is what attaches the caption to the image for a screen reader.
 * ---------------------------------------------------------------------------
 */
export function EditableCaption({
  slot,
  className,
  children,
}: {
  /** Absent means "not wired up": renders a plain caption, as before. */
  slot?: string | undefined;
  className: string;
  children: ReactNode;
}) {
  if (slot === undefined) return <figcaption className={className}>{children}</figcaption>;

  return (
    <Editable slot={slot} as="figcaption" prose className={className}>
      {children}
    </Editable>
  );
}
