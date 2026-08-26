'use client';

import {
  isChoiceField,
  MAX_FORM_QUANTITY,
  type FormAnswer,
  type FormAnswers,
  type FormField,
} from '@spsm/shared';
import { money } from '@/features/bookstore/money';

/**
 * One field, drawn.
 *
 * Split out of `FormRenderer` so the builder's live preview and the real form
 * render through the identical component. A preview that is a second
 * implementation of the same markup is a preview that lies to whoever is
 * building the form, usually about the thing they are trying to check.
 *
 * Every input reuses the site's existing `.field` / `.field-row` styles rather
 * than growing its own. Only the genuinely new furniture — priced options, the
 * running total — gets new classes, and those are prefixed `fx__` because this
 * project has one global stylesheet and no modules: a `.option` here would
 * reach into every other page that ever defines one.
 */

export function FieldInput({
  field,
  value,
  error,
  onChange,
  onBlur,
}: {
  field: FormField;
  value: FormAnswer | undefined;
  /**
   * The problem with this field's answer, or null.
   *
   * A message rather than a boolean, and that is the whole fix: the previous
   * version took `invalid` and painted a red border, leaving the actual sentence
   * in a summary at the top of the page. A border is not an error message — it
   * is invisible to a screen reader, it says nothing about *what* is wrong, and
   * on a sixteen-question form it means holding the summary in your head while
   * you scroll. The message now lives under the input it is about and is wired
   * to it with `aria-describedby`.
   */
  error: string | null;
  onChange: (value: FormAnswer) => void;
  /** Validates this one field once the person leaves it. */
  onBlur?: () => void;
}) {
  const id = `f-${field.key}`;
  const invalid = error !== null;
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  /*
   * Both, in reading order, when both exist. `aria-describedby` takes a list —
   * announcing the error and dropping the hint that explains the format is a
   * common way this gets half-done.
   */
  const described =
    [field.help ? helpId : null, invalid ? errorId : null].filter(Boolean).join(' ') || undefined;

  if (field.type === 'heading') {
    return (
      <div className="fx__heading">
        <h3>{field.label}</h3>
        {field.help && <p className="note">{field.help}</p>}
      </div>
    );
  }

  const label = (
    <span>
      {field.label}
      {field.required && <abbr title="required"> *</abbr>}
    </span>
  );

  /*
   * A consent box is a label wrapping its own input, not a `.field` with a
   * caption above it. The site already has `.field--check` for exactly this, and
   * the distinction matters for hit area: the whole sentence should tick the
   * box, which is most of the difference between this being answerable on a
   * phone and not.
   */
  if (field.type === 'consent') {
    return (
      <label className={cls('field field--check', invalid && 'is-invalid')}>
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          aria-describedby={described}
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}
        {field.help && <small id={helpId}>{field.help}</small>}
        <FieldError id={errorId} message={error} />
      </label>
    );
  }

  if (isChoiceField(field.type)) {
    return (
      <ChoiceField
        field={field}
        id={id}
        helpId={helpId}
        errorId={errorId}
        described={described}
        error={error}
        value={value}
        label={label}
        onChange={onChange}
        onBlur={onBlur}
      />
    );
  }

  const common = {
    id,
    'aria-describedby': described,
    'aria-invalid': invalid || undefined,
    placeholder: field.placeholder ?? undefined,
    required: field.required,
  };

  return (
    <label className={cls('field', invalid && 'is-invalid')}>
      {label}
      {field.type === 'longText' ? (
        <textarea
          {...common}
          onBlur={onBlur}
          rows={4}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          {...common}
          onBlur={onBlur}
          type={inputType(field)}
          /*
           * `autoComplete` by field *type*, so the browser can fill a name and
           * an email it already knows. Worth the three lines: most of these
           * forms open with the same four boxes, and someone filling in their
           * fifth parish form of the year should not retype their phone number
           * a fifth time.
           */
          autoComplete={autoCompleteFor(field)}
          {...numericBounds(field)}
          value={typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''}
          onChange={(event) =>
            onChange(
              field.type === 'number'
                ? // Empty must stay a string, not become 0 — a zero is an answer
                  // and would satisfy a `required` check the person has not met.
                  event.target.value === ''
                  ? ''
                  : Number(event.target.value)
                : event.target.value,
            )
          }
        />
      )}
      {field.help && <small id={helpId}>{field.help}</small>}
      {field.type === 'number' && field.unitPriceCents > 0 && (
        <small className="fx__unit">{money(field.unitPriceCents)} each</small>
      )}
      <FieldError id={errorId} message={error} />
    </label>
  );
}

function ChoiceField({
  field,
  id,
  helpId,
  errorId,
  described,
  error,
  value,
  label,
  onChange,
  onBlur,
}: {
  field: FormField;
  id: string;
  helpId: string;
  errorId: string;
  described: string | undefined;
  error: string | null;
  value: FormAnswer | undefined;
  label: React.ReactNode;
  onChange: (value: FormAnswer) => void;
  /* `| undefined` explicitly: the project runs `exactOptionalPropertyTypes`, so
     an optional prop does not implicitly accept an undefined value passed in. */
  onBlur?: (() => void) | undefined;
}) {
  const invalid = error !== null;
  if (field.type === 'select') {
    return (
      <label className={cls('field', invalid && 'is-invalid')}>
        {label}
        <select
          id={id}
          aria-describedby={described}
          aria-invalid={invalid || undefined}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        >
          {/*
            An empty first option, always, even when the field is required.
            Without it the browser pre-selects the first real choice and a form
            asking "which service?" arrives claiming everyone wanted the first
            one alphabetically — an answer nobody gave.
          */}
          <option value="">Choose…</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
              {option.priceCents > 0 ? ` — ${money(option.priceCents)}` : ''}
            </option>
          ))}
        </select>
        {field.help && <small id={helpId}>{field.help}</small>}
        <FieldError id={errorId} message={error} />
      </label>
    );
  }

  const multiple = field.type === 'checkboxes';
  const chosen = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];

  return (
    /*
     * A `fieldset` with a `legend`, not a `div` with a label. A radio group's
     * accessible name comes from the legend; without one, a screen reader
     * announces each option with no idea what question they answer.
     */
    <fieldset className={cls('fx__group', invalid && 'is-invalid')} aria-describedby={described}>
      <legend>{label}</legend>
      <div className="fx__options">
        {field.options.map((option) => {
          const on = chosen.includes(option.value);
          return (
            <label key={option.value} className={cls('fx__option', on && 'is-on')}>
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={id}
                value={option.value}
                checked={on}
                onChange={() => {
                  if (!multiple) return onChange(option.value);
                  onChange(
                    on
                      ? chosen.filter((entry) => entry !== option.value)
                      : [...chosen, option.value],
                  );
                }}
              />
              <span className="fx__option-label">{option.label}</span>
              {option.priceCents > 0 && (
                <span className="fx__option-price">{money(option.priceCents)}</span>
              )}
            </label>
          );
        })}
      </div>
      {field.help && <small id={helpId}>{field.help}</small>}
      <FieldError id={errorId} message={error} />
    </fieldset>
  );
}

/**
 * One field's error, under the field.
 *
 * Always rendered into the DOM at the same place, present or not, so the
 * `aria-describedby` target exists before it is referenced and the layout does
 * not jump by a line when a message appears.
 *
 * No `role="alert"` here, deliberately. There is one on the summary at the top
 * of the form, and a page that fires an alert per invalid field announces "Your
 * name is required. Phone number is required. Email address is required…" over
 * the top of itself. The summary is the announcement; these are what you find
 * when you get there.
 */
function FieldError({ id, message }: { id: string; message: string | null }) {
  return (
    <small className="fx__error" id={id} hidden={message === null}>
      {message}
    </small>
  );
}

function inputType(field: FormField): string {
  switch (field.type) {
    case 'email':
      return 'email';
    case 'phone':
      return 'tel';
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    default:
      return 'text';
  }
}

function autoCompleteFor(field: FormField): string | undefined {
  switch (field.type) {
    case 'email':
      return 'email';
    case 'phone':
      return 'tel';
    case 'shortText':
      return /\bname\b/i.test(field.label) ? 'name' : undefined;
    default:
      return undefined;
  }
}

/**
 * `min`/`max`/`step` on a number input.
 *
 * The ceiling is `MAX_FORM_QUANTITY` whether or not the form set one, matching
 * the clamp `computeTotalCents` applies server-side. Letting the box accept
 * 10,000 when the total will be priced as 999 shows a figure that is not what
 * gets charged, which is the one thing a running total must never do.
 */
function numericBounds(field: FormField): Record<string, number | string> {
  if (field.type !== 'number') return {};
  return {
    min: field.min ?? 0,
    max: Math.min(field.max ?? MAX_FORM_QUANTITY, MAX_FORM_QUANTITY),
    step: 1,
    inputMode: 'numeric',
  };
}

function cls(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Fields that sit side by side read better than a single tall column of boxes. */
export function pairable(field: FormField): boolean {
  return field.type === 'email' || field.type === 'phone' || field.type === 'date';
}

export type { FormAnswers };
