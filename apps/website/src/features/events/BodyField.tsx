'use client';

/**
 * The description, with four buttons that write the Markdown for you.
 *
 * ## Why the buttons rather than a rich text editor
 *
 * What is stored is Markdown, because that is what the static export renders at
 * build time and what the mobile app will read. A rich text editor would have to
 * serialise back to Markdown, and every one of those round trips is a place
 * where a paste from Word becomes a document nobody can edit again.
 *
 * So the field stays a textarea holding exactly what is in Firestore, and the
 * toolbar does what a person would have typed. Nobody has to remember that a
 * heading is two hashes and a space — and anybody who does remember can still
 * type it, because there is no second representation to get out of step.
 *
 * ## The selection is preserved, which is the whole difficulty
 *
 * Wrapping the selected words in asterisks and leaving the cursor at the end of
 * the line is a bold button that has to be undone by hand. So each of these
 * records where the selection was, rewrites the value, and puts the selection
 * back around the same words — which cannot be done until React has committed
 * the new value, hence the `setTimeout`.
 *
 * A timeout rather than `requestAnimationFrame`: rAF does not fire in this
 * project's headless preview, so a cursor restored inside one is a behaviour
 * that can never be checked.
 */

import { useRef } from 'react';
import { Grow } from '@/components/Inline';

/**
 * One thing the toolbar can do.
 *
 * `wrap` surrounds the selection; `prefix` puts something at the front of each
 * selected line. The two shapes cover bold, headings, lists and links between
 * them, and a third shape would be a fifth button nobody asked for.
 */
type Action =
  | { kind: 'wrap'; label: string; hint: string; with: string }
  | { kind: 'prefix'; label: string; hint: string; with: string }
  | { kind: 'link'; label: string; hint: string };

const ACTIONS: Action[] = [
  { kind: 'wrap', label: 'B', hint: 'Bold', with: '**' },
  { kind: 'prefix', label: 'H', hint: 'Heading', with: '## ' },
  { kind: 'prefix', label: '•', hint: 'Bulleted list', with: '- ' },
  { kind: 'link', label: '🔗', hint: 'Link' },
];

/** The new value and where the selection should end up. */
interface Applied {
  value: string;
  from: number;
  to: number;
}

function apply(action: Action, value: string, from: number, to: number): Applied {
  const selected = value.slice(from, to);

  if (action.kind === 'wrap') {
    const pad = action.with;
    // Already wrapped? Take it off again, so the button is a toggle rather than
    // a thing that accumulates asterisks.
    if (
      selected.startsWith(pad) &&
      selected.endsWith(pad) &&
      selected.length >= pad.length * 2
    ) {
      const inner = selected.slice(pad.length, -pad.length);
      return {
        value: value.slice(0, from) + inner + value.slice(to),
        from,
        to: from + inner.length,
      };
    }
    return {
      value: value.slice(0, from) + pad + selected + pad + value.slice(to),
      // Around the words, not around the asterisks — so typing replaces the
      // text and a second press unwraps it.
      from: from + pad.length,
      to: from + pad.length + selected.length,
    };
  }

  if (action.kind === 'prefix') {
    /*
     * Line-based, so the button works on a selection spanning four lines and on
     * an empty cursor alike. The start is walked back to the beginning of its
     * line first, because "make this a heading" is about the line the cursor is
     * in, not about the character it is on.
     */
    const lineStart = value.lastIndexOf('\n', from - 1) + 1;
    const lineEnd = value.indexOf('\n', to) === -1 ? value.length : value.indexOf('\n', to);
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    const allPrefixed = lines.every((line) => line.startsWith(action.with));

    const next = lines
      .map((line) =>
        allPrefixed ? line.slice(action.with.length) : `${action.with}${line}`,
      )
      .join('\n');

    return {
      value: value.slice(0, lineStart) + next + value.slice(lineEnd),
      from: lineStart,
      to: lineStart + next.length,
    };
  }

  /*
   * A link. The selected words become the label and the cursor lands in the
   * empty brackets — which is where the next thing typed or pasted belongs.
   */
  const label = selected || 'link text';
  const inserted = `[${label}](https://)`;
  return {
    value: value.slice(0, from) + inserted + value.slice(to),
    from: from + inserted.length - 1,
    to: from + inserted.length - 1,
  };
}

export function BodyField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}) {
  const box = useRef<HTMLTextAreaElement>(null);

  function run(action: Action) {
    const field = box.current;
    if (!field) return;
    const { value: next, from, to } = apply(
      action,
      field.value,
      field.selectionStart,
      field.selectionEnd,
    );
    onChange(next);
    setTimeout(() => {
      field.focus();
      field.setSelectionRange(from, to);
    }, 0);
  }

  return (
    <div className={error ? 'ee-body ee-body--bad' : 'ee-body'}>
      <div className="ee-body__head">
        <span className="ee-group__label">The description</span>
        <div className="ee-body__tools" role="group" aria-label="Formatting">
          {ACTIONS.map((action) => (
            <button
              key={action.hint}
              type="button"
              className="ee-body__tool"
              title={action.hint}
              aria-label={action.hint}
              /* The textarea loses focus on mousedown otherwise, and with it the
                 selection these buttons are about. */
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => run(action)}
            >
              <span aria-hidden="true">{action.label}</span>
            </button>
          ))}
        </div>
      </div>

      <Grow
        boxRef={box}
        name="body"
        className="ee-body__text"
        value={value}
        minRows={3}
        aria-label="The description"
        placeholder="What is this event, and who is it for?"
        onChange={onChange}
      />

      {error && <strong className="ee-group__error">{error}</strong>}
    </div>
  );
}
