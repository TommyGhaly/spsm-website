import { Ornament } from './Ornament';

/**
 * The banner every top-level page opens with.
 *
 * Small, but it keeps heading structure consistent across features that
 * different people will write at different times — which is the thing that
 * quietly degrades into `h1` inside `h1` and unlabelled sections otherwise.
 *
 * It is now a full-bleed band, so it carries its own `.wrap`. The root layout
 * no longer wraps page content for exactly this reason — see the note there.
 */
export function PageHeader({
  title,
  lede,
  eyebrow,
}: {
  title: string;
  lede?: string;
  eyebrow?: string;
}) {
  return (
    <header className="page-head">
      <div className="wrap">
        <div className="page-head__inner">
          {/* Decorative, and a `p`: the `h1` below is the page's real name, and
              an eyebrow promoted to a heading would put two of them in the
              outline. */}
          {eyebrow && <p className="section-head__eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
          {lede && <p className="lede">{lede}</p>}
          <Ornament start />
        </div>
      </div>
    </header>
  );
}
