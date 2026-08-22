import Link from 'next/link';
import { Icon } from './Icon';

/**
 * "Back to wherever this page hangs off."
 *
 * ## Why this is a component and not three inline links
 *
 * It was three inline links, and they were the single most obviously wrong thing
 * on the events pages. Each was `<p className="meta"><Link>← Events</Link></p>`,
 * which produced:
 *
 *  - **A misaligned arrow.** The block it sat in was `class="wrap event-head"`,
 *    so it inherited `.wrap`'s `margin-inline: auto` *and* overrode its
 *    `max-width` down to the reading measure — a 710px box centred in a 1280px
 *    window. The prose below it sat in the full 1152px column. The result was a
 *    back arrow and a title floating 245px to the right of everything else on
 *    the page, which is exactly the "why is this here?" it drew.
 *  - **A literal `←` character**, rendered in the body font at 13px in
 *    all-caps letterspaced micro type, next to nine icons drawn as SVG
 *    everywhere else on the site.
 *  - **No target size.** 13px of uppercase text is a link a thumb misses.
 *
 * It is fixed here rather than in each page so it is fixed once. The alignment
 * belongs to the caller — this renders inline and takes the width it is given.
 *
 * ## It says where it goes
 *
 * `label` is the name of the destination, not the word "Back". A visitor two
 * levels into a gallery needs to know whether that arrow returns them to the
 * camp or to the list of ministries, and "← Summercamp" answers it where "←
 * Back" makes them guess.
 */
export function BackLink({
  href,
  label,
}: {
  href: string;
  /** The destination's own name — "Events", "Summercamp". */
  label: string;
}) {
  return (
    <Link className="back-link" href={href}>
      <Icon name="back" size={16} />
      <span>{label}</span>
    </Link>
  );
}
