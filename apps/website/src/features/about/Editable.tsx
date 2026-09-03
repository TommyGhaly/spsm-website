'use client';

import { type ElementType, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import { copyOf, hasCopy } from '@spsm/shared';
import { useEditMode } from '@/features/programs/editMode';
import { useAboutOverlay } from './context';

/**
 * One rewritable piece of a hand-written band.
 *
 * ---------------------------------------------------------------------------
 * ## The fallback is `children`, and that is the whole design
 *
 * Wrap the JSX that is already on the page. With no override — which is the
 * state of every slot on every page until somebody edits one — this renders its
 * children and nothing else, so the band keeps its links, its `<i lang="ar">`,
 * its `<Link>` to another part of About, and its exact wording.
 *
 * That is why the coded default is `children` rather than a `default=""` prop.
 * Flattening the hand-written version to a string to pass it in would lose
 * precisely the things worth keeping, and these pages are full of them.
 *
 * ## The element is always rendered, override or not
 *
 * This used to return a bare `<>{children}</>` when there was nothing to
 * override, on the reasoning that the coded JSX should pass through untouched —
 * and it was wrong in the way that mattered most, because the element `as` names
 * and the class on it are part of the wrapper, not of the children.
 *
 * So on every unedited page — which is all five of them, all of the time until
 * somebody edits one — `<h2 id="what-copt-means">` disappeared, every
 * `class="who-hero__title"` disappeared, and the pages rendered as unstyled runs
 * of text. Tommy's report was "you messed up all the formatting in the headers".
 *
 * Worth recording how it got past a check: the build assertions looked for the
 * heading *text* in the exported HTML, and the text was still there. Only the
 * markup around it had gone. **Assert the element and the class, not the words.**
 *
 * ## Blank means the original
 *
 * `copyOf` reads `''`, `'   '`, `null` and `undefined` identically. So clearing
 * the box restores the hand-written words instead of emptying the band — the one
 * behaviour this feature must never get wrong, because the site has been bitten
 * by a live swap believing an absence before (see the note on baked covers in
 * the bookstore).
 *
 * ## Edited where the words are, one band at a time
 *
 * Two rejected arrangements are worth recording, because the third is a
 * composite of what each got right.
 *
 * **Every band with its box open.** Twenty textareas on a fifteen-band page. It
 * roughly doubled the page's height and made the thing being judged unreadable
 * while it was being judged.
 *
 * **A properties column on the right**, the way the galleries and the shop are
 * edited. Built, and Tommy's verdict was that it is the wrong shape *for these
 * pages*: *"only edit the text where it is its not that many customizations lets
 * keep it simple for the about pages."* Right — a gallery has layouts, scales
 * and widths to set, and an About page has words. A column exists to hold
 * settings that have nowhere else to live, and there are none here.
 *
 * **What is here now:** the column, kept deliberately thin. Tommy settled it —
 * *"no keep the side column"* — and the "keep it simple" half of the earlier
 * message is honoured by what the column *contains* rather than by removing it:
 * the words, the photograph, and nothing else. No layouts, no widths, no scales.
 *
 * So all this component does is render the band and take the click. The fields
 * are in `AboutPanel`.
 *
 * ## Why this is a client component in a server-rendered page
 *
 * /about/who-we-are used to ship no JavaScript at all, and this costs it that.
 * Unavoidable given what was asked for: an edit has to be visible without a
 * deploy, which means the page reads Firestore in the browser, which means a
 * client boundary. The cost is bounded to this component and the provider — the
 * prose, the plates and the spines are still server-rendered and still in the
 * HTML, so the page reads correctly with JavaScript off and a search engine sees
 * all of it.
 * ---------------------------------------------------------------------------
 */
export function Editable({
  slot,
  as: Tag = 'p',
  prose = false,
  className,
  id,
  children,
}: {
  /** A key declared in `slots.ts`. Anything else is unreachable by the editor. */
  slot: string;
  as?: ElementType;
  /**
   * Render an override as markdown rather than as plain text.
   *
   * True for a paragraph or a run of them, false for a heading. What it does
   * *not* control is the element — see `as`.
   */
  prose?: boolean;
  className?: string | undefined;
  id?: string | undefined;
  children: ReactNode;
}) {
  const { current, ops } = useAboutOverlay();
  const override = current?.slots[slot];

  const content = hasCopy(override) ? (
    <Words text={copyOf(override, '')} prose={prose} inline={Tag !== 'div'} />
  ) : (
    children
  );

  if (!ops) {
    return (
      <Tag className={className} id={id}>
        {content}
      </Tag>
    );
  }

  return (
    <EditableTarget slot={slot} as={Tag} className={className} id={id}>
      {content}
      {/*
        The hand-written words, kept off screen so the column can read their
        text to seed its box — see `codedTextOf` in `AboutPanel`. Always the
        *coded* children and never the override, which is the bug this replaced:
        reading the visible tree meant that on an already-overridden slot the box
        was seeded with the override's own words, so reverting left the page and
        the box disagreeing.

        Not wrapped in `Tag` and carrying no `id`, so it cannot duplicate the
        heading id above it; `aria-hidden`, so a screen reader does not hear the
        band twice.
      */}
      <div className="visually-hidden" aria-hidden="true" data-about-coded={slot}>
        {children}
      </div>
    </EditableTarget>
  );
}

/**
 * A band that opens its own box when clicked.
 *
 * ---------------------------------------------------------------------------
 * **Per band, not per slot.** A band is what a reader sees as one thing — a
 * heading, its paragraphs, its photograph — so clicking any part of one opens
 * the boxes for all of its parts, and the answer to "where do I change this?"
 * is always "click it" rather than "click the exact paragraph". The band id is
 * the slot key's prefix; see `slots.ts`.
 *
 * **No wrapper element.** The handlers go on the slot's *own* element — the
 * `h2`, the `p`, the prose `div`. A wrapper was the obvious shape and is wrong
 * here: several of these slots are grid children (`.who-split__body` inside
 * `.who-split`), so a div around one adds a grid item and the two-column band
 * collapses. `display: contents` would fix the layout and break the tab stop,
 * because a box-less element cannot be focused.
 *
 * The hidden mirror is a sibling *after* it and costs no layout —
 * `.visually-hidden` is `position: absolute`, so it is out of flow in a grid and
 * a flex row alike. **Nothing else is added to the page**, which is the property
 * that makes editing in place worth anything: pressing Edit must not move a
 * pixel of the thing being judged.
 *
 * **`role="button"` on flow content, not a real `<button>`.** What is being made
 * clickable holds links and `<figure>`s, and both are invalid inside a button —
 * the parser would close it early and the server's tree and the browser's would
 * disagree. So a role, a tab stop, and Enter/Space by hand.
 *
 * **The link guard is load-bearing.** These paragraphs link to other parts of
 * About, and swallowing those clicks would make edit mode a place where the
 * page's own links silently stop working. Same `closest` idiom the camp board
 * uses, for the same reason.
 * ---------------------------------------------------------------------------
 */
function EditableTarget({
  slot,
  as: Tag,
  className,
  id,
  children,
}: {
  slot: string;
  as: ElementType;
  className?: string | undefined;
  id?: string | undefined;
  children: ReactNode;
}) {
  const { select, isSelected } = useEditMode();
  const band = slot.split('.')[0] ?? slot;
  const selected = isSelected({ kind: 'section', key: band });

  function choose(event: { target: EventTarget | null; preventDefault: () => void }) {
    const target = event.target;
    if (target instanceof Element && target.closest('a, button, input, textarea, select')) return;
    event.preventDefault();
    select({ kind: 'section', key: band });
  }

  return (
    <>
      <Tag
        className={`${className ?? ''} ab-target${selected ? ' is-selected' : ''}`.trim()}
        id={id}
        data-about-slot={slot}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={choose}
        onKeyDown={(event: {
          key: string;
          target: EventTarget | null;
          preventDefault: () => void;
        }) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          choose(event);
        }}
      >
        {children}
      </Tag>

      {/*
        The hand-written words, kept off screen so the field can be seeded with
        them — somebody fixing one sentence must not start from an empty box.
        Always the *coded* children and never the override, which is the bug this
        replaced: reading the visible tree meant that on an already-overridden
        slot the box was seeded with the override's own words, so reverting left
        the page and the box disagreeing.

        A `div` with no `id`, so it cannot duplicate the heading id above it, and
        a `div` rather than a `span` because prose children are `<p>` elements
        and a `<p>` inside a `<span>` is invalid — the parser lifts it out, which
        is a tree the server and the browser disagree about. It costs no layout
        even inside a grid: `.visually-hidden` is `position: absolute`.
      */}
      <span className="visually-hidden" aria-hidden="true" data-about-coded={slot}>
        {children}
      </span>
    </>
  );
}

/**
 * An override's words, rendered into whatever element wraps them.
 *
 * `inline` is the whole reason this is a component. `react-markdown` wraps every
 * paragraph in a `<p>`, and a `<p>` inside a `<p>` is invalid HTML — the parser
 * closes the outer one early, so the server's tree and the browser's disagree
 * and React re-renders the subtree on hydration. Several slots here are ledes
 * that genuinely are `<p>` elements, so the paragraph wrapper is dropped for
 * them and emphasis, links and code still work.
 *
 * The cost, stated where somebody will look for it: a blank line in a lede does
 * not start a new paragraph, because there is nowhere to put one.
 */
function Words({ text, prose, inline }: { text: string; prose: boolean; inline: boolean }) {
  if (!prose) return <>{text}</>;
  if (!inline) return <Markdown>{text}</Markdown>;
  return <Markdown components={{ p: ({ children }) => <>{children}</> }}>{text}</Markdown>;
}
