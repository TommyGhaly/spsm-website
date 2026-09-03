'use client';

import type { ReactNode } from 'react';
import { copyOf } from '@spsm/shared';
import { SectionHeading } from '@/components/SectionHeading';
import { useEditMode } from '@/features/programs/editMode';
import { useAboutOverlay } from './context';

/**
 * A `SectionHeading` whose three lines staff may rewrite.
 *
 * ---------------------------------------------------------------------------
 * ## Why this is not just three `<Editable>`s
 *
 * `SectionHeading` renders the `h2`, the gold eyebrow and the note itself, from
 * three **string** props — it is one component precisely so the document
 * outline and the `aria-labelledby` target cannot be got wrong per caller.
 * Wrapping its output in `Editable` would put a div between the eyebrow and
 * the heading; wrapping each prop is impossible, because a prop is not a place
 * to put children.
 *
 * So this merges first and renders once. Which is also *easier* than the
 * general case: the coded default here really is a string, so there is no JSX
 * to preserve and no need for `Editable`'s trick of reading the rendered
 * `textContent` to seed a rewrite. `copyOf` is the whole merge.
 *
 * The blank rule is identical and matters as much: an emptied box gives the
 * written heading back rather than a nameless band.
 *
 * ## In edit mode it is a target
 *
 * The three fields were rendered under the heading. They are in the column now,
 * like every other band's — see `AboutPanel`. What is left here is the click,
 * and the hidden mirrors the column reads to seed its boxes.
 * ---------------------------------------------------------------------------
 */
export function EditableHeading({
  band,
  id,
  eyebrow,
  title,
  note,
}: {
  /** The band id. Slots are `<band>.eyebrow`, `<band>.h2`, `<band>.note`. */
  band: string;
  id: string;
  eyebrow?: string | undefined;
  title: string;
  note?: string | undefined;
}) {
  const { current, ops } = useAboutOverlay();
  const slots = current?.slots;

  const shownEyebrow = copyOf(slots?.[`${band}.eyebrow`], eyebrow ?? '');
  const shownTitle = copyOf(slots?.[`${band}.h2`], title);
  const shownNote = copyOf(slots?.[`${band}.note`], note ?? '');

  const heading = (
    <SectionHeading
      id={id}
      eyebrow={shownEyebrow || undefined}
      title={shownTitle}
      note={shownNote || undefined}
    />
  );

  if (!ops) return heading;

  return (
    <HeadingTarget band={band} eyebrow={eyebrow} title={title} note={note}>
      {heading}
    </HeadingTarget>
  );
}

/**
 * The click, and the coded strings the column needs.
 *
 * Unlike `Editable`, the hand-written values here really are strings, so the
 * mirrors carry them directly rather than being a hidden copy of a JSX tree.
 * They are still mirrors rather than props on the column, because the column has
 * no idea which bands exist on which page — it reads
 * `[data-about-coded="<slot>"]`, and this keeps that one contract for both kinds
 * of slot.
 */
function HeadingTarget({
  band,
  eyebrow,
  title,
  note,
  children,
}: {
  band: string;
  eyebrow?: string | undefined;
  title: string;
  note?: string | undefined;
  children: ReactNode;
}) {
  const { select, isSelected } = useEditMode();
  const selected = isSelected({ kind: 'section', key: band });

  return (
    <div
      className={`ab-target${selected ? ' is-selected' : ''}`}
      data-about-band={band}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest('a, button')) return;
        select({ kind: 'section', key: band });
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        select({ kind: 'section', key: band });
      }}
    >
      {children}
      <span className="visually-hidden" aria-hidden="true" data-about-coded={`${band}.eyebrow`}>
        {eyebrow ?? ''}
      </span>
      <span className="visually-hidden" aria-hidden="true" data-about-coded={`${band}.h2`}>
        {title}
      </span>
      {note !== undefined && (
        <span className="visually-hidden" aria-hidden="true" data-about-coded={`${band}.note`}>
          {note}
        </span>
      )}
    </div>
  );
}

