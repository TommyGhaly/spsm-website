'use client';

import {
  GALLERY_DISPLAYS,
  GALLERY_DISPLAY_NAMES,
  SECTION_SCALES,
  SECTION_SCALE_NAMES,
  layoutForLook,
  type GalleryDisplay,
  type SectionLayout,
  type SectionScale,
} from '@spsm/shared';
import { useDisclosureClose } from './Disclosure';

/**
 * A named row of choices. The only control shape this panel has.
 *
 * Out here rather than inside the component, for the reason `BandEditor` is: a
 * component declared during a render is a new type every render, so React
 * unmounts and rebuilds it instead of updating it. Nothing here holds state, so
 * the visible cost was only a lost focus ring after every save — but it is the
 * same defect that made the scroll-wheel controls look inert, and one of these in
 * a file is one too many.
 */
function Row<T extends string>({
  label,
  options,
  value,
  onPick,
  names,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onPick: (next: T) => void;
  /** Human names, because the stored values are terse on purpose. */
  names: Record<T, string>;
}) {
  return (
    <div className="designer__row">
      <p className="designer__label">{label}</p>
      <div className="chips" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={`chip${value === option ? ' is-on' : ''}`}
            aria-pressed={value === option}
            onClick={() => onPick(option)}
          >
            {names[option]}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * How a block of photographs looks. Two questions.
 *
 * ## What this had, and why it is gone
 *
 * Seven rows and twenty-two chips: Layout, Size, Movement, Title size, Title
 * position, Title alignment, Captions. One of these per block, on a page that can
 * carry four. Tommy's words were "beyond confusing … I have no idea how to edit
 * anything because there are wayyyy too many settings", and he had said a version
 * of that twice before.
 *
 * The two earlier times I *reorganised* — moved the controls into a properties
 * column, then collapsed the column into rows. Both made the panel shorter and
 * neither made it smaller, because the count never went down. This is the
 * deletion instead.
 *
 * **What went, and what replaced it.** Title size, title position, title
 * alignment and caption placement are now set by the look — one house style per
 * look, the site's own. Movement went entirely: a wheel drifts, because a wheel
 * that arrives motionless is the one thing nobody asks for.
 *
 * The honest cost, stated rather than hidden: a page can no longer have its title
 * beside its pictures unless a look puts it there. That was five rows of controls
 * for a decision a parish volunteer cannot evaluate and would not think to make,
 * and the pages that had it look the same until somebody picks a look — the
 * *fields* are all still in `SectionLayout` and still rendered. Nothing was
 * migrated and nothing was lost from the documents; only the controls went.
 *
 * ## Every change is live, and saved
 *
 * No Save and no Cancel. Pressing "Sideways wheel" rearranges the block on the
 * page behind the panel immediately and writes the choice behind that. For a
 * control whose entire purpose is *seeing what it looks like*, a form you submit
 * to find out is the wrong shape — and with named looks there is no invalid state
 * to guard and nothing to validate.
 *
 * ## Why it takes a whole layout and hands back a whole layout
 *
 * `SectionLayout` is nested, and Firestore replaces rather than merges a nested
 * object written as a plain field — so a partial patch silently drops the
 * settings it does not mention. Passing the complete object both ways makes the
 * correct write the only write. See `setSectionLayout`.
 */
export function SectionDesigner({
  layout,
  onChange,
  /** True while a write is in flight. Only ever a hint; nothing is disabled. */
  saving = false,
  onClose,
}: {
  layout: SectionLayout;
  onChange: (next: SectionLayout) => void;
  saving?: boolean;
  onClose: () => void;
}) {
  const closeRow = useDisclosureClose();

  return (
    <section className="designer" aria-label="How this block looks">
      <header className="designer__head">
        <h4>How it looks</h4>
        <span className="designer__state">{saving ? 'Saving…' : 'Saved'}</span>
        <button
          type="button"
          className="button button--quiet button--small"
          onClick={() => {
            closeRow();
            onClose();
          }}
        >
          Done
        </button>
      </header>

      {/*
        The look, which carries the typography with it — see `layoutForLook`. The
        scale is kept across a change, because "large" means the same thing to
        somebody whichever look they are in and re-choosing it every time would be
        the kind of small annoyance that makes a panel feel unreliable.
      */}
      <Row
        label="Shape"
        options={GALLERY_DISPLAYS}
        value={layout.display}
        names={GALLERY_DISPLAY_NAMES}
        onPick={(display: GalleryDisplay) => onChange(layoutForLook(display, layout.scale))}
      />

      <Row
        label="Size"
        options={SECTION_SCALES}
        value={layout.scale}
        names={SECTION_SCALE_NAMES}
        onPick={(scale: SectionScale) => onChange({ ...layout, scale })}
      />
    </section>
  );
}
