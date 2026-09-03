import { Editable } from '@/features/about/Editable';

/**
 * A term and the thing said about it, down the page.
 *
 * ---------------------------------------------------------------------------
 * A `dl`, because that is what it is. Each pair is wrapped in a `div` so the
 * two halves can be one grid row and the term can hold its column; `dt`/`dd`
 * as direct grid children would let a long entry pull its term out of line.
 *
 * The term is *not* a heading. It looks like one, but a screen reader jumping
 * by heading through a page should land on its sections, not on twenty years.
 *
 * Lifted out of `features/who/parts.tsx#Chronology` when the About editor got a
 * list block, because the two are the same markup and the same stylesheet: the
 * dated spines on Who We Are are `.who-chron`, and a staff-added list has no
 * business being a second implementation of it that drifts. `Chronology` is now
 * a caller — it keeps its own name, because a nineteen-century spine is a
 * meaningful thing on that page in a way "definition list" is not.
 * ---------------------------------------------------------------------------
 */
export interface SpineRow {
  term: string;
  detail: string;
}

export function DefinitionSpine({
  rows,
  className = 'who-chron',
  slotPrefix,
}: {
  rows: readonly SpineRow[];
  /** Defaults to the class the two coded spines already use. */
  className?: string;
  /**
   * Makes every row rewritable, keyed `<prefix>-<index>-term` / `-detail`.
   *
   * By **index**, not by the term itself, and that is the one decision here
   * worth stating: keying by the year would mean correcting a wrong date threw
   * away the sentence attached to it, because the slot it was stored under no
   * longer exists. The index is stable under exactly the edit somebody is most
   * likely to make.
   *
   * The cost is the opposite case — inserting a row in the middle shifts every
   * override below it. That is a code change (these rows live in
   * `chronologies.ts`), so whoever makes it can see this note; a wrong date is
   * a staff edit, and they cannot.
   */
  slotPrefix?: string | undefined;
}) {
  return (
    <dl className={className}>
      {rows.map((row, index) => (
        <div key={row.term + row.detail.slice(0, 24)} className={`${className}__row`}>
          {slotPrefix === undefined ? (
            <>
              <dt className={`${className}__when`}>{row.term}</dt>
              <dd className={`${className}__what`}>{row.detail}</dd>
            </>
          ) : (
            <>
              <Editable
                slot={`${slotPrefix}-${index}-term`}
                as="dt"
                className={`${className}__when`}
              >
                {row.term}
              </Editable>
              <Editable
                slot={`${slotPrefix}-${index}-detail`}
                as="dd"
                prose
                className={`${className}__what`}
              >
                {row.detail}
              </Editable>
            </>
          )}
        </div>
      ))}
    </dl>
  );
}
