'use client';

/**
 * A description box that shows bold as bold.
 *
 * ---------------------------------------------------------------------------
 * ## What changed, and why
 *
 * This was a textarea with buttons over it, so pressing **B** put `**word**` in
 * the box and you read the asterisks while you wrote. Tommy: *"in the description
 * itself don't show the html text, show what it looks like in the page itself —
 * so don't use `**`, just make it italicised in place."*
 *
 * So it is a `contenteditable` now. Markdown is still what is stored — see
 * `lib/richtext` — and nothing downstream knows this happened.
 *
 * ## The three things a contenteditable gets wrong, and what is done about them
 *
 * **The caret jumps.** Writing `innerHTML` on every keystroke puts the caret back
 * at the start, because the node it was in no longer exists. So the box is only
 * *seeded* from the value: `mirrored` remembers the markdown this component last
 * emitted, and the value is only pushed into the DOM when it differs from that —
 * which is a load or an outside edit, never the user's own typing.
 *
 * **Undo dies.** Rewriting the DOM by hand empties the browser's undo stack, and
 * there is no publish step here — what is typed reaches the public page within a
 * second, so undo is the only safety net. That is why every button goes through
 * `execCommand`: it is deprecated, and it is also the only API that edits a
 * contenteditable *through* the browser's own undo stack. Every replacement
 * (Range surgery, a custom history) means writing undo by hand.
 *
 * **A paste brings a document with it.** Word and Google Docs paste spans, fonts,
 * classes and occasionally a whole table. `onPaste` takes the plain text and
 * inserts that, so the only structure in the box is structure the buttons made.
 * The serialiser flattens anything unexpected too, as a second line.
 *
 * ## The selection has to be saved before the link box opens
 *
 * A textarea keeps `selectionStart` across a blur. A contenteditable does not —
 * the DOM Selection is global, and focusing the URL field destroys it. So the
 * Range is put aside when the link button is pressed and restored before the
 * link is made, or the link lands wherever the caret happened to be last.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { safeHref, toHtml, toMarkdown } from '@/lib/richtext';

interface Mark {
  hint: string;
  glyph: ReactNode;
  /** Extra class, for the one glyph that needs a different face. */
  tone?: string;
  /** Held with ⌘ or Ctrl, does the same thing. */
  key?: string;
  run: () => void;
  /** Whether the caret is already inside this mark. Drawn as a pressed button. */
  on: boolean;
}

/** Which marks are live where the caret is. */
interface Live {
  italic: boolean;
  bold: boolean;
  heading: boolean;
  list: boolean;
}

const NONE: Live = { italic: false, bold: false, heading: false, list: false };

/**
 * `execCommand`, with the deprecation warning acknowledged once here rather than
 * at all six call sites. See the header for why it is still the right call.
 */
function exec(command: string, value?: string) {
  // eslint-disable-next-line deprecation/deprecation
  document.execCommand(command, false, value);
}

/**
 * `queryCommandState`, the read half of the same deprecated pair as `exec`.
 *
 * It answers the question a toolbar has to answer — *is the caret inside bold?* —
 * about the browser's own idea of the selection, including a caret sitting at a
 * boundary where nothing is selected yet but the next keystroke will be bold.
 * Walking the DOM cannot see that state, which is exactly the case where somebody
 * types and is surprised.
 */
function stateOf(command: string): boolean {
  try {
    // eslint-disable-next-line deprecation/deprecation
    return document.queryCommandState(command);
  } catch {
    // Firefox throws rather than returning false for an unsupported command.
    return false;
  }
}

/** The block element the caret is currently inside, within `root`. */
function blockAt(root: HTMLElement): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  let node: Node | null = selection.getRangeAt(0).startContainer;
  while (node && node !== root) {
    if (node instanceof HTMLElement && /^(P|H[1-6]|LI|UL|OL)$/.test(node.tagName)) return node;
    node = node.parentNode;
  }
  return null;
}

export function RichText({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  ariaLabel,
  className,
  blocks = true,
}: {
  label?: ReactNode | undefined;
  value: string;
  onChange: (next: string) => void;
  /** For the inspector, which saves when you leave the field. */
  onBlur?: (() => void) | undefined;
  placeholder?: string | undefined;
  ariaLabel?: string | undefined;
  /** Goes on the editable box, so a caller can keep its own face and measure. */
  className?: string | undefined;
  blocks?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const href = useRef<HTMLInputElement>(null);
  /** The markdown this component last handed up. See the header. */
  const mirrored = useRef<string | null>(null);
  const saved = useRef<Range | null>(null);

  const [linking, setLinking] = useState(false);
  const [target, setTarget] = useState('');
  const [empty, setEmpty] = useState(value.trim() === '');
  const [live, setLive] = useState<Live>(NONE);

  /** Read the box and hand the markdown up. */
  const emit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const markdown = toMarkdown(el);
    mirrored.current = markdown;
    setEmpty(el.textContent?.trim() === '');
    onChange(markdown);
  }, [onChange]);

  /**
   * Read which marks are on where the caret is.
   *
   * Tommy: *"if a setting is turned on there should be more indication — for
   * example if bold is on it should let the user know that bold is on."* Right,
   * and it matters more here than in a word processor: the markers are hidden
   * now, so a caret at the end of a bold word looks exactly like a caret at the
   * end of a plain one until the next keystroke comes out bold.
   */
  const readLive = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const selection = window.getSelection();
    const inside =
      selection !== null &&
      selection.rangeCount > 0 &&
      el.contains(selection.getRangeAt(0).commonAncestorContainer);
    if (!inside) return;

    const block = blockAt(el);
    const heading = block?.tagName === 'H2';
    setLive({
      italic: stateOf('italic'),
      /*
       * Never inside a heading, whatever the browser says.
       *
       * `queryCommandState('bold')` is true in an `h2` because an `h2` is drawn
       * bold — so the lamp lit and claimed emphasis that is not in the document.
       * Pressing it there would write `**` inside `##`, which is a redundant
       * marker around text that was already heavy.
       */
      bold: !heading && stateOf('bold'),
      heading,
      // The DOM check is the reliable half: `insertUnorderedList` reports its
      // state inconsistently across browsers, but a caret inside an `li` is not
      // ambiguous anywhere.
      list: block?.tagName === 'LI' || stateOf('insertUnorderedList'),
    });
  }, []);

  /*
   * `selectionchange` on the document, because there is no such event on an
   * element: moving the caret with an arrow key, a click, or a drag all arrive
   * here and nowhere else. `readLive` ignores any selection outside this box, so
   * two editors on one page do not fight over it.
   */
  useEffect(() => {
    document.addEventListener('selectionchange', readLive);
    return () => document.removeEventListener('selectionchange', readLive);
  }, [readLive]);

  // Seed the box, and re-seed only on an edit that did not come from here.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (mirrored.current === value) return;
    el.innerHTML = toHtml(value);
    mirrored.current = value;
    setEmpty(el.textContent?.trim() === '');
  }, [value]);

  useEffect(() => {
    if (linking) href.current?.focus();
  }, [linking]);

  /**
   * Run an `execCommand` against the box, with the selection intact.
   *
   * The focus guard is the whole of this. `focus()` on an element that already
   * holds the selection **collapses it to the start**, so calling it
   * unconditionally meant every button applied to an empty caret and appeared to
   * do nothing at all. The box normally already has focus here — the buttons
   * cancel their own mousedown for exactly that reason — so this only steps in
   * when something else took it, and puts the range back when it does.
   */
  function withFocus(run: () => void) {
    const el = box.current;
    if (!el) return;

    const selection = window.getSelection();
    const inside =
      selection !== null &&
      selection.rangeCount > 0 &&
      el.contains(selection.getRangeAt(0).commonAncestorContainer);
    const range = inside ? selection.getRangeAt(0).cloneRange() : null;

    if (document.activeElement !== el) {
      el.focus();
      if (range) {
        const after = window.getSelection();
        after?.removeAllRanges();
        after?.addRange(range);
      }
    }

    run();
    emit();
    // The command has just changed what is under the caret, and
    // `selectionchange` does not necessarily fire for it.
    readLive();
  }

  function toggleHeading() {
    const el = box.current;
    if (!el) return;
    const block = blockAt(el);
    withFocus(() => exec('formatBlock', block?.tagName === 'H2' ? '<p>' : '<h2>'));
  }

  const marks: Mark[] = [
    {
      hint: 'Italic',
      /*
       * A serif italic I, not the sans one.
       *
       * Tommy: *"the italics symbol is very unclear."* And it was — the UI face
       * has no serifs, so a slanted `I` is a leaning bar with nothing to say it
       * is a letter. With serifs it is unmistakably an italic I, which is the
       * mark every word processor uses.
       */
      glyph: 'I',
      tone: 'fmt__tool--italic',
      key: 'i',
      run: () => withFocus(() => exec('italic')),
      on: live.italic,
    },
    {
      hint: 'Bold',
      glyph: 'B',
      tone: 'fmt__tool--bold',
      key: 'b',
      run: () => withFocus(() => exec('bold')),
      on: live.bold,
    },
  ];

  if (blocks) {
    marks.push(
      {
        hint: 'Heading',
        glyph: 'H',
        tone: 'fmt__tool--head',
        run: toggleHeading,
        on: live.heading,
      },
      {
        hint: 'Bulleted list',
        glyph: '•',
        run: () => withFocus(() => exec('insertUnorderedList')),
        on: live.list,
      },
    );
  }

  function openLink() {
    const selection = window.getSelection();
    // Put the selection aside *before* focus moves to the URL field, or there is
    // nothing left to attach the link to.
    saved.current =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    setLinking((was) => !was);
  }

  function makeLink() {
    const el = box.current;
    const where = safeHref(target);
    if (!el || where === '') return;

    el.focus();
    const range = saved.current;
    if (range) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    // Nothing selected: put the URL in as its own words, so the link is visible
    // and can be typed over, rather than making an invisible empty anchor.
    if (window.getSelection()?.isCollapsed) exec('insertText', target.trim());
    exec('createLink', where);

    emit();
    setTarget('');
    setLinking(false);
  }

  return (
    <div className="fmt">
      <div className="fmt__head">
        {label ? <span className="fmt__label">{label}</span> : <span />}
        <div className="fmt__tools" role="group" aria-label="Formatting">
          {marks.map((mark) => (
            <button
              key={mark.hint}
              type="button"
              className={[
                'fmt__tool',
                mark.tone,
                // The same `is-on` the link button uses, so "this is switched on"
                // looks like one thing across the whole bar.
                mark.on ? 'is-on' : null,
              ]
                .filter(Boolean)
                .join(' ')}
              title={`${mark.hint}${mark.key ? ` (⌘${mark.key.toUpperCase()})` : ''}${
                mark.on ? ' — on' : ''
              }`}
              /*
               * `aria-pressed` rather than a label that changes: a toggle button
               * is a documented pattern, so a screen reader says "Bold, pressed"
               * on its own. Rewriting the label to "Bold on" would say it twice
               * and read as a different button each time the caret moved.
               */
              aria-pressed={mark.on}
              aria-label={mark.hint}
              /* The box loses focus and its selection on mousedown otherwise —
                 and in the inspector, that blur is also what saves the field. */
              onMouseDown={(event) => event.preventDefault()}
              onClick={mark.run}
            >
              <span aria-hidden="true">{mark.glyph}</span>
            </button>
          ))}
          <button
            type="button"
            className={linking ? 'fmt__tool is-on' : 'fmt__tool'}
            title={linking ? 'Add a link — on' : 'Add a link'}
            aria-label="Add a link"
            aria-expanded={linking}
            onMouseDown={(event) => event.preventDefault()}
            onClick={openLink}
          >
            <Icon name="arrow" size={14} />
          </button>
        </div>
      </div>

      {linking && (
        <div className="fmt__link">
          <label className="field">
            <span>Where it goes</span>
            <input
              ref={href}
              value={target}
              placeholder="https://  or  /about/our-belief"
              onChange={(event) => setTarget(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setLinking(false);
                  return;
                }
                if (event.key !== 'Enter') return;
                // Otherwise Enter submits whatever form this is sitting in, from
                // a box that is only asking a question.
                event.preventDefault();
                makeLink();
              }}
            />
          </label>
          <button type="button" className="button button--quiet" onClick={makeLink}>
            Add the link
          </button>
        </div>
      )}

      <div className="fmt__field">
        <div
          ref={box}
          className={className ? `fmt__box ${className}` : 'fmt__box'}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel}
          data-placeholder={placeholder}
          data-empty={empty ? 'yes' : undefined}
          onInput={emit}
          onFocus={readLive}
          onBlur={() => {
            /*
             * Cleared on the way out. A bar still showing "Bold" lit next to a
             * field nobody is in is worse than showing nothing: it reads as a
             * property of the field rather than of where the caret was.
             */
            setLive(NONE);
            onBlur?.();
          }}
          onKeyDown={(event) => {
            if (!event.metaKey && !event.ctrlKey) return;
            const mark = marks.find((one) => one.key === event.key.toLowerCase());
            if (!mark) return;
            // Chromium already maps ⌘B to bold in a contenteditable, but it does
            // it *without* telling React, so the markdown would not be written
            // back until the next keystroke.
            event.preventDefault();
            mark.run();
          }}
          onPaste={(event) => {
            // Plain text only. See the header on what a Word paste carries.
            event.preventDefault();
            const plain = event.clipboardData.getData('text/plain');
            withFocus(() => exec('insertText', plain));
          }}
        />
      </div>
    </div>
  );
}
