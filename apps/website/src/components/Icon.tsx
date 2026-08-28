/**
 * The site's icons, as inline SVG.
 *
 * Inline rather than an icon font or a sprite sheet: there are ten of them,
 * they inherit `currentColor` and font size for free, and neither choice costs a
 * network request on a site that is otherwise one HTML file and a stylesheet.
 * An icon library would be more dependency than the whole `components/`
 * directory.
 *
 * All are `aria-hidden`. Every use in this codebase sits beside a text label,
 * and an icon that announces itself next to the word it illustrates makes a
 * screen reader say everything twice. If one is ever used *without* a label, it
 * needs a `title` — and it is worth asking first whether the label was the
 * better answer.
 */

const ICONS = {
  /** Service and liturgy times. */
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  /** Address, directions. */
  pin: (
    <>
      <path d="M12 21s7-5.686 7-11a7 7 0 1 0-14 0c0 5.314 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  /** Livestream. */
  play: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5l6 3.5-6 3.5z" />
    </>
  ),
  /** Stop a self-scrolling rail. See `DragRail`. */
  pause: (
    <>
      <path d="M9.5 6v12" />
      <path d="M14.5 6v12" />
    </>
  ),
  /**
   * Start one again. A bare triangle rather than `play`'s enclosed one: this
   * sits at 14px on a control the size of a full stop, where the ring around
   * `play` closes up into a blob — and `play` already means the livestream
   * everywhere else on the site.
   */
  resume: (
    <path
      d="M9 5.8l9.5 6.2L9 18.2z"
      // Filled, unlike every other icon here. A 1.6px outline of a shape this
      // small is a wire drawing; solid, it reads as a triangle.
      fill="currentColor"
      stroke="none"
    />
  ),
  /** The parish calendar. */
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8.5 3.5v3M15.5 3.5v3" />
    </>
  ),
  /** Cupped hands. Unused since prayer requests were removed. */
  hands: (
    <>
      <path d="M12 20.5s-6.5-4-6.5-9a3.5 3.5 0 0 1 6.5-1.8A3.5 3.5 0 0 1 18.5 11.5c0 5-6.5 9-6.5 9z" />
    </>
  ),
  /** Giving. */
  gift: (
    <>
      <rect x="3.5" y="9" width="17" height="11.5" rx="1.5" />
      <path d="M3.5 13.5h17M12 9v11.5" />
      <path d="M12 9S10.5 4.5 8 4.5A2 2 0 0 0 8 9zM12 9s1.5-4.5 4-4.5A2 2 0 0 1 16 9z" />
    </>
  ),
  /**
   * Welcome / new here. An open door with an arrow going in.
   *
   * The arrow points *into* the doorway, not out of it — the same glyph reversed
   * is the near-universal "sign out" icon, which on a page inviting a stranger
   * to visit would say precisely the wrong thing.
   */
  door: (
    <>
      <path d="M13.5 3.5h5v17h-5" />
      <path d="M4 12h7M8 8.5L11.5 12L8 15.5" />
    </>
  ),
  /** "See all", "read more". */
  arrow: (
    <>
      <path d="M4.5 12h15M13 5.5l6.5 6.5L13 18.5" />
    </>
  ),
  /** Searching the bookstore. */
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8L20.5 20.5" />
    </>
  ),
  /**
   * The disclosure marker on a `<details>`, pointing down when closed and
   * rotated by CSS when open. Drawn rather than left to the browser's own
   * triangle, which is a different shape, colour, and size in every engine.
   */
  chevron: (
    <>
      <path d="M6 9.5l6 6 6-6" />
    </>
  ),
  /**
   * Going back up a level — a gallery to its ministry, a ministry to Events.
   *
   * Its own glyph rather than `arrow` flipped in CSS, because a transform on an
   * inline SVG inside a flex row is a thing that has to be re-tuned every time
   * the label's size changes, and because "back" and "onward" reading as the
   * same shape at a glance is exactly the confusion this is meant to avoid.
   */
  back: (
    <>
      <path d="M19.5 12h-15M11 5.5L4.5 12l6.5 6.5" />
    </>
  ),
  /** Leave the lightbox, leave the presentation. */
  close: (
    <>
      <path d="M6 6l12 12M18 6L6 18" />
    </>
  ),
  /** Open one photograph full screen. Four corners pointing outward. */
  expand: (
    <>
      <path d="M9 4.5H4.5V9M15 4.5h4.5V9M15 19.5h4.5V15M9 19.5H4.5V15" />
    </>
  ),
  /** A count of photographs, on a gathering card. */
  photos: (
    <>
      <rect x="3.5" y="6.5" width="14" height="11" rx="1.5" />
      <path d="M7 6.5V5a1.5 1.5 0 0 1 1.5-1.5h10A1.5 1.5 0 0 1 20 5v10.5" />
      <path d="M3.5 14l3.5-3 4 3.5 3-2.5 3 3" />
    </>
  ),
  /** A count of clips, beside `photos`. */
  film: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M8 5.5v13M16 5.5v13M3.5 12h17" />
    </>
  ),
  /** Step back through a gallery. */
  prev: (
    <>
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </>
  ),
  /** Step forward through a gallery. */
  next: (
    <>
      <path d="M9.5 5.5L16 12l-6.5 6.5" />
    </>
  ),
  /** Add pictures to a block. Deliberately the same weight as `close`, which is
      the × that takes one out again — the pair reads as one control either way. */
  plus: (
    <>
      <path d="M12 5.5v13M5.5 12h13" />
    </>
  ),
  /**
   * Delete a photograph from the parish for good.
   *
   * A bin, deliberately **not** the ×. The × on a picture means "take it off this
   * page, the photograph stays" everywhere else in the editor — see
   * `PictureStrip` — and the one screen where a press really does destroy the
   * file cannot wear the same mark as the one where nothing is lost.
   */
  trash: (
    <>
      <path d="M4 6.5h16M9.5 6.5V4.5h5v2" />
      <path d="M6.5 6.5l.9 12.6a1.6 1.6 0 0 0 1.6 1.4h6a1.6 1.6 0 0 0 1.6-1.4l.9-12.6" />
      <path d="M10 10.5v6.5M14 10.5v6.5" />
    </>
  ),
  /**
   * This can be picked up and carried. Two columns of dots, the usual mark.
   *
   * Filled circles rather than the file's usual stroked paths: these are drawn at
   * 13–15px, and six zero-length round-capped strokes at `strokeWidth: 1.6` come
   * out about a pixel across — present in the DOM and invisible on the screen.
   */
  grip: (
    <g fill="currentColor" stroke="none">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </g>
  ),
  /** Chosen — in the admin picture picker. */
  check: (
    <>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </>
  ),
  /** Start the hall screen. A filled triangle, matching `resume`. */
  present: (
    <>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
      <path d="M10.5 8l4 2.5-4 2.5z" fill="currentColor" stroke="none" />
    </>
  ),
  /**
   * A phone number. Beside the `tel:` link on /contact.
   *
   * The handset, not a smartphone rectangle: at 20px a rounded rectangle with a
   * dot in it is a phone, a tablet, a card, or a door, depending on who is
   * looking. The handset silhouette has never meant anything else.
   */
  phone: (
    <>
      <path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3z" />
    </>
  ),
  /**
   * Writing to the parish. The contact form's card and heading.
   *
   * An open flap rather than a closed one: a sealed envelope at 20px is a
   * rectangle with a horizontal line in it, which reads as a card or a note.
   */
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 6.5l8.5 6 8.5-6" />
    </>
  ),
  /** A form or a document. The default for a form card with no icon chosen. */
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </>
  ),
} as const;

export type IconName = keyof typeof ICONS;

/**
 * Whether a string names an icon that exists.
 *
 * Needed because icon names are no longer all written by hand: a form card
 * carries whichever name is stored on its Firestore document, and staff choose
 * it. An unknown name is not a crash — `ICONS[name]` is simply `undefined` and
 * the component renders an empty `<svg>`, which is a card with a blank square
 * where its icon should be and no error anywhere to explain it. Callers reading
 * a name from data should narrow through this and fall back.
 */
export function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

export function Icon({
  name,
  size = 20,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      // 1.6 rather than a round number: at 20px, 1.5 renders a hair light beside
      // the 400-weight labels these sit next to, and 2 reads as heavy.
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}
