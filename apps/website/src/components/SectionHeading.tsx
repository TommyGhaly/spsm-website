import Link from 'next/link';
import { Icon } from './Icon';

/**
 * The heading a homepage section opens with: a gold eyebrow, an `h2`, and an
 * optional line of explanation.
 *
 * The eyebrow is decorative and must not be the only thing naming the section —
 * it is a `p`, not a heading, so the document outline stays `h1` → `h2` and a
 * screen reader user navigating by heading gets the real title.
 *
 * `id` is required rather than optional: every section on the homepage is
 * labelled by its heading via `aria-labelledby`, and an unlabelled `<section>`
 * is invisible to landmark navigation. Making the caller pass one means they
 * cannot forget.
 */
export function SectionHeading({
  id,
  eyebrow,
  title,
  note,
}: {
  id: string;
  // `| undefined` explicitly, not just `?`: the project runs
  // `exactOptionalPropertyTypes`, so a caller passing a value that *might* be
  // undefined — `note={bulletin.presetName || undefined}` — needs the type to
  // say so rather than relying on the property being absent.
  eyebrow?: string | undefined;
  title: string;
  note?: string | undefined;
}) {
  return (
    <div className="section-head">
      {eyebrow && <p className="section-head__eyebrow">{eyebrow}</p>}
      <h2 id={id}>{title}</h2>
      {note && <p className="section-head__note">{note}</p>}
    </div>
  );
}

/** The "see everything" link that closes a deliberately truncated list. */
export function SectionMore({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <p className="section-more">
      <Link href={href}>
        {children}
        <Icon name="arrow" size={16} />
      </Link>
    </p>
  );
}
