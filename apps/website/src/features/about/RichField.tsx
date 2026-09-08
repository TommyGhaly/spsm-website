'use client';

import { useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { insertLink, toggleMarker, type Wrapped } from '@/lib/markers';

/**
 * A box of words with Italic, Bold and Link buttons over it.
 *
 * ---------------------------------------------------------------------------
 * ## Why this exists
 *
 * The fields used to be plain textareas with a line of help under them reading
 * *"Markdown: *italic*, **bold**, [a link](/about)"*. Tommy: *"I don't want
 * markdown for italicies make buttons or something to make it easier for
 * users."*
 *
 * Right, and the reason is who is at the keyboard. The person editing these
 * pages is a parish volunteer a few times a year. Asking them to remember that
 * one asterisk is italic and two are bold — and that a stray one breaks the
 * paragraph — is asking them to learn a notation to change a word. A button
 * that italicises the selection is the same gesture as every other program they
 * use.
 *
 * ## Markdown is still what gets stored
 *
 * What changed is the interface, not the format — and a `contenteditable`
 * surface would have meant writing selection, paste and undo handling from
 * scratch, when undo is the one thing this editor must not get wrong. The rest
 * of that argument, and the toggling, are in `markers.ts`.
 * ---------------------------------------------------------------------------
 */

export function RichField({
  label,
  value,
  onChange,
  note,
  rows = 8,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  note?: string | undefined;
  rows?: number;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [linking, setLinking] = useState(false);
  const [href, setHref] = useState('');

  /**
   * Apply a change and put the selection back.
   *
   * The selection has to be restored in an effect-like deferral rather than
   * straight after `onChange`: the value is controlled, so the DOM still holds
   * the old text at this point and setting `selectionStart` against it would
   * land in the wrong place. `requestAnimationFrame` waits for React to commit.
   *
   * **Not `requestAnimationFrame` alone.** The preview pane never fires
   * animation frames, so the selection would simply never be restored there and
   * this would look broken in exactly the place it gets tested. A `setTimeout`
   * fallback fires either way.
   */
  function applyAndSelect(next: Wrapped) {
    onChange(next.text);
    const restore = () => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.start, next.end);
    };
    setTimeout(restore, 0);
  }

  function wrap(marker: string) {
    const el = box.current;
    if (!el) return;
    applyAndSelect(toggleMarker(value, el.selectionStart, el.selectionEnd, marker));
  }

  function link() {
    const el = box.current;
    if (!el) return;
    const target = href.trim();
    if (target === '') return;
    applyAndSelect(insertLink(value, el.selectionStart, el.selectionEnd, target));
    setHref('');
    setLinking(false);
  }

  return (
    <div className="ab-rich">
      <div className="ab-rich__label">{label}</div>

      <div className="ab-rich__tools" role="group" aria-label={`Formatting for ${label}`}>
        <button
          type="button"
          className="ab-rich__tool"
          onClick={() => wrap('*')}
          title="Italic"
          aria-label="Italic"
        >
          {/* A glyph rather than an icon: everybody recognises a slanted I, and
              the icon set has no italic mark. `aria-hidden`, because the button
              already has a label. */}
          <em aria-hidden="true">I</em>
        </button>
        <button
          type="button"
          className="ab-rich__tool"
          onClick={() => wrap('**')}
          title="Bold"
          aria-label="Bold"
        >
          <strong aria-hidden="true">B</strong>
        </button>
        <button
          type="button"
          className={`ab-rich__tool${linking ? ' is-on' : ''}`}
          onClick={() => setLinking((was) => !was)}
          title="Add a link"
          aria-label="Add a link"
          aria-expanded={linking}
        >
          <Icon name="arrow" size={14} />
        </button>
      </div>

      {linking && (
        <div className="ab-rich__link">
          <label className="field">
            <span>Where it goes</span>
            <input
              value={href}
              placeholder="/about/our-belief"
              onChange={(event) => setHref(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                link();
              }}
            />
            {/* A page on this site, not somebody else's. Said here because a
                pasted external URL is how a parish page ends up pointing at a
                site that has since gone. */}
            <small>A page on this site, like /giving or /about/patron-saints.</small>
          </label>
          <button type="button" className="button button--ghost" onClick={link}>
            Add it
          </button>
        </div>
      )}

      <textarea
        ref={box}
        className="ab-rich__box"
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Empty puts the original words back."
      />

      {note && <p className="ab-rich__note">{note}</p>}
    </div>
  );
}
