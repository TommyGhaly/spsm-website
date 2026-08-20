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
   * Set on a page whose first child would otherwise sit hard against the
   * masthead. Two of them now:
   *
   *   `/livestream` — no `PageHeader` at all; the band it replaced was what
   *                   separated the player from the masthead.
   *   `/events`     — has a `PageHeader`, but it renders only a hidden `h1`
   *                   *outside* this component, so the first real child is also
   *                   the first child of `.page-body` and `* + *` never fires.
   *
   * Pages that open with prose do not show the problem, because a paragraph
   * brings its own spacing — which is why it went unnoticed. Anything opening
   * with a grid or an image needs this. See `.page-body--flush`.
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
