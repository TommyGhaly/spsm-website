'use client';

import {
  GALLERY_DISPLAYS,
  GALLERY_DISPLAY_NAMES,
  SECTION_FITS,
  SECTION_FIT_NAMES,
  SECTION_SCALE_NAMES,
  SPINS_FOR_DISPLAY,
  WHEEL_SPIN_NAMES,
  layoutForLook,
  scalesFor,
  spinFor,
  type GalleryDisplay,
  type SectionFit,
  type SectionLayout,
  type SectionScale,
  type WheelSpin,
} from '@spsm/shared';

/**
 * One question and its answers, as a segmented control.
 *
 * Out here rather than inside the component, for the reason `BandEditor` is: a
 * component declared during a render is a new type every render, so React
 * unmounts and rebuilds it instead of updating it — which loses the focus ring
 * after every save.
 *
 * `value` may be `null`, which is "none of these" — an upright wheel with a dragged
 * height is no named size, and lighting one up would say something untrue.
 */
function Row<T extends string>({
  label,
  options,
  value,
  onPick,
  names,
  note,
}: {
  label: string;
  options: readonly T[];
  value: T | null;
  onPick: (next: T) => void;
  /** Human names, because the stored values are terse on purpose. */
  names: Record<T, string>;
  /** A line under the row, for a state the buttons alone cannot say. */
  note?: string | undefined;
}) {
  return (
    <div className="designer__row" role="group" aria-label={label}>
      <p className="designer__label">{label}</p>
      <div
        className="designer__seg"
        // Two or three answers share a line; four or five wrap to an even grid
        // rather than leaving one orphan on a second line.
        data-count={options.length}
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={`designer__opt${value === option ? ' is-on' : ''}`}
            aria-pressed={value === option}
            onClick={() => onPick(option)}
          >
            {names[option]}
          </button>
        ))}
      </div>
      {note && <p className="designer__note">{note}</p>}
    </div>
  );
}

const CAPTION_CHOICES = ['shown', 'hidden'] as const;
const CAPTION_CHOICE_NAMES: Record<(typeof CAPTION_CHOICES)[number], string> = {
  shown: 'Shown',
  hidden: 'Hidden',
};

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
 *
 * ## Why it has no header of its own, and rows that fill the panel
 *
 * Tommy: *"how it looks settings on the side looks very bad and unusable."* It was
 * drawn flush against the column's left edge with no padding, repeated the
 * column's own title, "Saved" and Done a second time under them, and wrapped its
 * chips onto ragged second lines in a 350px column. The column already says what
 * is selected, whether it saved and how to get back, so the header went; the
 * chips became a segmented control per row — equal cells across the full width,
 * so every option is a big target and nothing wraps mid-row.
 *
 * It also used to be the page's own block alone. Every other block's panel was a
 * heading field, so the same question — "make this one smaller" — had an answer on
 * one block and not on the next. It is on all of them now.
 */
export function SectionDesigner({
  layout,
  onChange,
}: {
  layout: SectionLayout;
  onChange: (next: SectionLayout) => void;
}) {
  /** An upright wheel somebody has dragged to a height of their own. */
  const custom = layout.display === 'column' && layout.height !== null;

  return (
    <section className="designer" aria-label="How this block looks">
      <Row
        label="Shape"
        options={GALLERY_DISPLAYS}
        value={layout.display}
        names={GALLERY_DISPLAY_NAMES}
        onPick={(display: GalleryDisplay) =>
          /*
            The width, captions, spin, tile shape and dragged height all go
            through: somebody changing the shape has changed their mind about one
            thing. `fit` drops back onto the ladder when this is no longer a
            column, because "one picture tall" is the upright wheel's alone.
          */
          onChange(
            layoutForLook(
              display,
              display === 'column' || layout.scale !== 'fit' ? layout.scale : 'large',
              layout.width,
              layout.caption.placement,
              layout.spin,
              layout.fit,
              layout.height,
            ),
          )
        }
      />

      {/*
        `scalesFor`: "One picture" is the upright wheel's alone. Picking any size
        clears a dragged height — it is a request for that size.
      */}
      <Row
        label={layout.display === 'grid' ? 'Picture size' : 'Size'}
        options={scalesFor(layout.display)}
        value={custom ? null : layout.scale}
        names={SECTION_SCALE_NAMES}
        onPick={(scale: SectionScale) => onChange({ ...layout, scale, height: null })}
        note={
          custom
            ? 'Custom height, from dragging the wheel\u2019s bottom edge. Pick a size to go back to one.'
            : layout.display === 'column'
              ? 'Or drag the wheel\u2019s bottom edge to any height.'
              : undefined
        }
      />

      {/*
        The two wheel rows, and only for a wheel. A grid has nowhere to spin to
        and its tiles are sized by the canvas. The stored values survive the trip
        through grid regardless — see `layoutForLook` and `spinFor`.
      */}
      {layout.display !== 'grid' && (
        <>
          <Row
            label="Direction"
            options={SPINS_FOR_DISPLAY[layout.display]}
            /* `spinFor`, not `layout.spin`: a column still holding "rightward"
               from when it was a sideways wheel must show where it is going. */
            value={spinFor(layout)}
            names={WHEEL_SPIN_NAMES}
            onPick={(spin: WheelSpin) => onChange({ ...layout, spin })}
          />

          <Row
            label="Pictures"
            options={SECTION_FITS}
            value={layout.fit}
            names={SECTION_FIT_NAMES}
            onPick={(fit: SectionFit) => onChange({ ...layout, fit })}
          />
        </>
      )}

      {/*
        The same switch as Captions on the block's bar. `over` for on, as there:
        `below` stays honoured on read but has no control.
      */}
      <Row
        label="Captions"
        options={CAPTION_CHOICES}
        value={layout.caption.placement === 'hidden' ? 'hidden' : 'shown'}
        names={CAPTION_CHOICE_NAMES}
        onPick={(choice) =>
          onChange({
            ...layout,
            caption: {
              ...layout.caption,
              placement:
                choice === 'hidden'
                  ? 'hidden'
                  : layout.caption.placement === 'hidden'
                    ? 'over'
                    : layout.caption.placement,
            },
          })
        }
      />
    </section>
  );
}
