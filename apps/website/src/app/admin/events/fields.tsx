'use client';

/**
 * The parts the events form is built out of.
 *
 * Small on purpose. The screen this replaces was one 949-line component in which
 * every label, hint and error was written out longhand at the point of use — so
 * the error for one field sat in a bulleted list at the top of the page, fifteen
 * hundred pixels away from the input it was about, because putting it next to the
 * input would have meant repeating the same six lines of JSX eighteen times.
 *
 * These are those six lines, written once. Everything below takes an error and
 * draws it under the control, which is the whole reason they exist.
 */

import { useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';

/* -------------------------------------------------------------------------- */
/* One labelled control                                                        */
/* -------------------------------------------------------------------------- */

interface FieldProps {
  label: ReactNode;
  /** The `name` on the control, which is also how `focusField` finds it. */
  name?: string;
  hint?: ReactNode;
  /** Shown under the control, in red, and marks it. Null when it is fine. */
  error?: string | null;
  /** Drawn as an asterisk. Only for what actually blocks a save of a draft. */
  required?: boolean;
  children: ReactNode;
}

/**
 * A label, a control, its hint and its error, stacked.
 *
 * `<label>` wraps the control rather than pointing at it by id — the pattern the
 * rest of the site's forms use, and it means no field needs an id at all unless
 * something outside it has to point at it.
 */
export function Field({ label, hint, error, required, children }: FieldProps) {
  return (
    <label className={error ? 'ev-field ev-field--bad' : 'ev-field'}>
      <span className="ev-field__label">
        {label}
        {required && (
          <abbr className="ev-field__must" title="Needed before this can be saved">
            *
          </abbr>
        )}
      </span>
      {children}
      {error ? (
        <strong className="ev-field__error">{error}</strong>
      ) : (
        hint && <small className="ev-field__hint">{hint}</small>
      )}
    </label>
  );
}

/** Fields side by side on a wide screen, stacked on a phone. */
export function Row({ children }: { children: ReactNode }) {
  return <div className="ev-cols">{children}</div>;
}

/* -------------------------------------------------------------------------- */
/* A fold                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A section that is closed until somebody wants it, and says what it holds while
 * it is closed.
 *
 * `value` is the point. A row reading "More about this event" is a door; a row
 * reading "Youth · the whole parish · 2 tags" is an answer, and somebody who has
 * come to check the category does not have to open it. The same reasoning as
 * `features/programs/Disclosure`, which was written after the same complaint
 * about the same kind of panel.
 *
 * Controlled rather than a `<details>`, because a failed save has to be able to
 * open the section holding the first problem before focusing it.
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
    <section className={open ? 'ev-fold ev-fold--open' : 'ev-fold'}>
      <h2 className="ev-fold__head">
        <button
          type="button"
          className="ev-fold__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span className="ev-fold__title">{title}</span>
          {value !== undefined && <span className="ev-fold__value">{value}</span>}
          <Icon name="chevron" size={16} className="ev-fold__chevron" />
        </button>
      </h2>
      {/* Rendered only when open. An input inside a hidden section is still a
          tab stop and still submits, and a `display: none` field carrying a
          validation error is an error nobody can reach. */}
      {open && (
        <div className="ev-fold__body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* A choice between two or three things                                        */
/* -------------------------------------------------------------------------- */

/**
 * A `<select>` with two options is a control that hides half of what it does.
 * When the whole list fits on one line, put the whole list on one line.
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
    <div className="ev-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'ev-segmented__on' : undefined}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tags                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Tags as things, not as a string with commas in it.
 *
 * The old field was one text input and the words "Comma separated" underneath,
 * which puts the parsing rule on the person typing: a trailing comma, a comma
 * inside a tag, two spaces — all of them silently produce a tag list nobody
 * meant. Here the split happens as you type, so what is stored is what is shown.
 *
 * Enter and comma both commit. Backspace in an empty box removes the last one,
 * which is the behaviour anybody who has used a mail client already expects.
 */
export function TagInput({
  tags,
  onChange,
  suggestions = [],
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
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

  const unused = suggestions.filter(
    (suggestion) => !tags.some((tag) => tag.toLowerCase() === suggestion.toLowerCase()),
  );

  return (
    <div className="ev-tags">
      <div className="ev-tags__box" onClick={() => box.current?.focus()}>
        {tags.map((tag) => (
          <span className="ev-tag" key={tag}>
            {tag}
            <button
              type="button"
              aria-label={`Remove the tag ${tag}`}
              onClick={() => onChange(tags.filter((other) => other !== tag))}
            >
              <Icon name="close" size={11} />
            </button>
          </span>
        ))}
        <input
          ref={box}
          className="ev-tags__input"
          value={text}
          placeholder={tags.length === 0 ? 'youth, outreach…' : 'Add another'}
          onChange={(e) => {
            // A comma commits rather than being typed, so the field can never
            // hold a half-written list.
            if (e.target.value.includes(',')) add(e.target.value);
            else setText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Not a submit. Enter in this box means "that is one tag".
              e.preventDefault();
              add(text);
            } else if (e.key === 'Backspace' && text === '' && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => add(text)}
        />
      </div>

      {unused.length > 0 && (
        <div className="ev-tags__suggest">
          <span className="ev-tags__suggest-label">Already in use:</span>
          {unused.slice(0, 8).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="ev-tags__pick"
              onClick={() => add(suggestion)}
            >
              <Icon name="plus" size={10} /> {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Focus                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Put the cursor in a named control and scroll it into view.
 *
 * Deferred a tick because the caller has usually just opened the fold the field
 * is in, and the input does not exist until React has committed that. A timeout
 * rather than `requestAnimationFrame`: rAF does not fire in a headless preview,
 * so this is the difference between a behaviour that can be checked and one that
 * has to be taken on trust.
 */
export function focusField(name: string): void {
  setTimeout(() => {
    const target = document.querySelector<HTMLElement>(`[name="${name}"]`);
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 0);
}
