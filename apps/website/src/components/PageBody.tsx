/**
 * The centred column a page's content sits in, below its `PageHeader`.
 *
 * The root layout deliberately does *not* wrap page content — the redesign has
 * full-bleed bands (the homepage hero, the sunken section grounds) and none of
 * them can exist inside a max-width container. So the container moves into the
 * pages that want one, which is all of them except the homepage.
 *
 * Using this rather than writing `<div className="wrap">` at each call site
 * means the vertical rhythm between a page header and its body is defined once.
 */
export function PageBody({
  children,
  /**
   * Set on a page that has no `PageHeader` above it, which is `/livestream` and
   * nothing else. That band supplies the top spacing on every other page, so a
   * page without one has to restate it — see `.page-body--flush`.
   */
  flush = false,
}: {
  children: React.ReactNode;
  flush?: boolean;
}) {
  return (
    <div className={`wrap page-body${flush ? ' page-body--flush' : ''}`}>
      {children}
    </div>
  );
}
