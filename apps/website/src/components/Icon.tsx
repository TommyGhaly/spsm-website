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
  /** The parish calendar. */
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8.5 3.5v3M15.5 3.5v3" />
    </>
  ),
  /** Prayer requests. */
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
} as const;

export type IconName = keyof typeof ICONS;

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
