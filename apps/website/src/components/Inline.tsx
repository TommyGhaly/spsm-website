'use client';

/**
 * Text that edits itself: an input shaped like the words it stands in for.
 *
 * ## Why these are in `components/` rather than in a feature
 *
 * Two editors need them and neither owns them. They were written for the events
 * editor, where the rule is that the title *is* the `h1` and the description *is*
 * the paragraph; `/events` then needed exactly the same thing for a ministry's
 * name on its tile. A second copy of "an input with no type of its own" is two
 * places to get the letter-spacing and the intrinsic-width trap wrong.
 *
 * They carry no feature's classes. `.ee-plain` is styled once in globals.css and
 * used by both, which is the point: an editable word looks the same everywhere on
 * this site.
 */

import { useEffect, useRef, type ChangeEvent, type RefObject, type TextareaHTMLAttributes } from 'react';

/**
 * An input that looks like the text it replaces.
 *
 * No border, no background, no padding of its own — `font: inherit` and a
 * transparent box, so it takes the type of whatever it is nested in. The
 * affordance arrives on hover and focus instead, which is the only arrangement
 * where a page in edit mode still reads as the page.
 *
 * `size={1}` with a CSS width, because an `input` has an intrinsic width of
 * about twenty characters that no `width: 100%` on an ancestor overrides — and
 * a date input's intrinsic width has already pushed this project's admin 93px
 * off a phone once.
 */
export function Plain({
  value,
  onChange,
  name,
  label,
  placeholder,
  className,
  maxLength,
}: {
  value: string;
  onChange: (value: string) => void;
  name: string;
  /** Never drawn. These inputs have no visible label by design. */
  label: string;
  placeholder?: string;
  className?: string;
  maxLength?: number;
}) {
  return (
    <input
      name={name}
      size={1}
      className={['ee-plain', className].filter(Boolean).join(' ')}
      value={value}
      aria-label={label}
      placeholder={placeholder}
      maxLength={maxLength}
      autoComplete="off"
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * A textarea that is exactly as tall as its contents.
 *
 * The old description field was `rows={12}`, which is a guess that is wrong in
 * both directions: a one-line description got eleven empty lines of box, and a
 * long one got a scrollbar inside a page that scrolls. Growing to fit is what
 * makes the field read as the paragraph it will become.
 *
 * The height is set from `scrollHeight` on every change and once on mount. Not
 * in a `requestAnimationFrame` — rAF never fires in this project's headless
 * preview, so a field sized inside one is a field that cannot be checked.
 */
export function Grow({
  value,
  onChange,
  minRows = 3,
  boxRef,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  minRows?: number;
  /**
   * The caller's handle on the element, when it needs one — the description
   * field's toolbar has to read and restore the selection.
   *
   * An explicit prop rather than `ref`. React 19 would forward a plain `ref` to
   * a function component, but this component also needs the element itself to
   * measure it, and two independent refs on one node means whichever the caller
   * passes silently disables the auto-sizing.
   */
  boxRef?: RefObject<HTMLTextAreaElement | null>;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'rows'>) {
  const own = useRef<HTMLTextAreaElement>(null);
  const box = boxRef ?? own;

  function fit(element: HTMLTextAreaElement) {
    // Reset first: `scrollHeight` never reports less than the current height, so
    // without this the field can only ever grow.
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }

  useEffect(() => {
    if (box.current) fit(box.current);
  }, [value]);

  return (
    <textarea
      ref={box}
      rows={minRows}
      value={value}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
        fit(event.target);
        onChange(event.target.value);
      }}
      {...rest}
    />
  );
}
