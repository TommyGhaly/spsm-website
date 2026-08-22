'use client';

/**
 * The pieces the events editor is assembled from.
 *
 * Replaces `fields.tsx`, which was written for a form. The difference is not
 * cosmetic: that file's central component drew a label above every control,
 * because in a form every control needs one. Here most controls stand where the
 * page's own words stand — the title is the heading, the date line is the date
 * line — and a label above one of those is a second copy of information the page
 * is already giving you, in the place the page's own layout wanted.
 *
 * So there are two kinds of thing in here, and the split is the point:
 *
 *  - **In place.** `Plain` and `Grow` — inputs with no chrome at all until you
 *    touch them, so an input inside an `h1` *is* the `h1`. They have moved to
 *    `components/Inline`, because `/events` needs the same thing for a ministry's
 *    name on its tile and a second copy is two places to get the intrinsic-width
 *    trap wrong.
 *  - **In the sheet.** `Group`, `Cols` and `Fold`, below: ordinary labelled form
 *    furniture, for the fields that genuinely are not visible on the page — the
 *    calendar summary, the category, the sign-up link.
 */

import { useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';

/* -------------------------------------------------------------------------- */
/* In the sheet                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A labelled control, its hint and its error.
 *
 * `<label>` wraps the control rather than pointing at it by id, so no field
 * needs an id unless something outside it has to point at one. The error
 * replaces the hint rather than joining it — two lines of small text under one
 * input is where people stop reading either.
 */
export function Group({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className={error ? 'ee-group ee-group--bad' : 'ee-group'}>
      <span className="ee-group__label">{label}</span>
      {children}
      {error ? (
        <strong className="ee-group__error">{error}</strong>
      ) : (
        hint && <small className="ee-group__hint">{hint}</small>
      )}
    </label>
  );
}

/** Side by side above 40rem, stacked below it. */
export function Cols({ children }: { children: ReactNode }) {
  return <div className="ee-cols">{children}</div>;
}

/**
 * A section that is closed until wanted, and says what it holds while closed.
 *
 * `value` is the reason this is not a `<details>` with a word in it. A row
 * reading "Filing and sign-ups" is a door; a row reading "Class or study · the
 * whole parish · 1 tag" is an answer, and somebody who came to check the
 * category never has to open it.
 */
export function Fold({
  title,
  value,
  open,
  onToggle,
  children,
}: {
  title: string;
  value?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = useId();

  return (
    <section className={open ? 'ee-fold ee-fold--open' : 'ee-fold'}>
      <h2 className="ee-fold__head">
        <button
          type="button"
          className="ee-fold__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <Icon name="chevron" size={14} className="ee-fold__chevron" />
          <span className="ee-fold__title">{title}</span>
          {value !== undefined && <span className="ee-fold__value">{value}</span>}
        </button>
      </h2>
      {/* Rendered only when open. An input inside a `display: none` section is
          still a tab stop, and a validation error on one is an error nobody can
          reach. */}
      {open && (
        <div className="ee-fold__body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Choices                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A `<select>` with two options hides half of what it does. When the whole list
 * fits on one line, put the whole list on one line.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="ee-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'ee-seg__on' : undefined}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A checkbox with its words, drawn rather than left to the browser. */
export function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className={checked ? 'ee-check ee-check--on' : 'ee-check'}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ee-check__box" aria-hidden="true">
        <Icon name="check" size={11} />
      </span>
      <span>{children}</span>
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Tags                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Tags as things, not as a string with commas in it.
 *
 * One text input labelled "comma separated" puts the parsing rule on the person
 * typing: a trailing comma, a comma inside a tag, two spaces — each silently
 * produces a tag list nobody meant. Splitting as you type means what is stored
 * is what is shown.
 *
 * Enter and comma both commit; backspace in an empty box removes the last tag,
 * which is what anyone who has used a mail client already expects.
 */
export function TagField({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [text, setText] = useState('');
  const box = useRef<HTMLInputElement>(null);

  function add(raw: string) {
    const tag = raw.trim().replace(/^,|,$/g, '').trim();
    setText('');
    if (!tag) return;
    // Case-insensitive, so "Youth" typed twice does not become two tags that
    // filter separately on the public site.
    if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return;
    onChange([...tags, tag]);
  }

  return (
    <div className="ee-tags" onClick={() => box.current?.focus()}>
      {tags.map((tag) => (
        <span className="ee-tag" key={tag}>
          {tag}
          <button
            type="button"
            aria-label={`Remove the tag ${tag}`}
            onClick={(event) => {
              event.stopPropagation();
              onChange(tags.filter((other) => other !== tag));
            }}
          >
            <Icon name="close" size={10} />
          </button>
        </span>
      ))}
      <input
        ref={box}
        size={1}
        className="ee-tags__input"
        value={text}
        aria-label="Add a tag"
        placeholder={tags.length === 0 ? 'youth, outreach…' : 'Add another'}
        onChange={(event) => {
          // A comma commits rather than being typed, so the field can never
          // hold a half-written list.
          if (event.target.value.includes(',')) add(event.target.value);
          else setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            // Not a submit. Enter in this box means "that is one tag".
            event.preventDefault();
            add(text);
          } else if (event.key === 'Backspace' && text === '' && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => add(text)}
      />
    </div>
  );
}
