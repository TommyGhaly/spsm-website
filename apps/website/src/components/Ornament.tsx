/**
 * The parish's ornament: a Coptic cross, and a rule built around it.
 *
 * ---------------------------------------------------------------------------
 * Why this is drawn rather than drawn *from* something.
 *
 * There is no photograph of this parish's building, so the visual interest on
 * this site has to come from type, colour, and ornament. This is the ornament.
 *
 * Note what is deliberately absent: any Coptic **lettering**. The one
 * AI-generated image in `assets/` was dropped precisely because its "Coptic"
 * banners spelled nothing — "CRIEIA", "TOHOAC" — which a parishioner who reads
 * Coptic notices immediately. Inventing letterforms in SVG would be the same
 * mistake in a new medium. The cross is a geometric form and ours to draw;
 * text is not ours to invent. If real Coptic text is ever wanted here, it comes
 * from the parish, as content.
 * ---------------------------------------------------------------------------
 */

/**
 * An equal-armed cross with flared arms — the Coptic form, rather than the
 * longer-stemmed Latin one.
 *
 * Inherits `currentColor` so a caller decides whether it is gold on paper or
 * paper on the hero's dark ground, and takes no colour prop for the same
 * reason: a colour passed here would be a colour outside the theme document.
 */
export function CopticCross({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      // Decorative in every current use — the rule it sits in carries no
      // information, and the heading beside it already says what the section is.
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M8.5 2h7l-1.5 8 8-1.5v7l-8-1.5 1.5 8h-7l1.5-8-8 1.5v-7l8 1.5z"
        // Softens the twelve corners just enough that the arms read as flared
        // rather than as a jagged star at 20px.
        strokeLinejoin="round"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/**
 * A horizontal rule with the cross at its centre, for use between sections.
 *
 * The rules themselves are CSS pseudo-elements (see `.ornament`) so they can
 * fade at both ends without extra markup.
 *
 * @param start omits the leading rule, for when this opens a block rather than
 *   dividing two.
 */
export function Ornament({ start = false }: { start?: boolean }) {
  return (
    <div className={start ? 'ornament ornament--start' : 'ornament'} role="presentation">
      <CopticCross size={18} />
    </div>
  );
}
