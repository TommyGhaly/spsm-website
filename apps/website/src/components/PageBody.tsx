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
  /**
   * Lets the column go wider than `--shell-width`. For the galleries, where the
   * photographs *are* the page.
   *
   * `--shell-width` is 80rem, which is a measure chosen for pages that are
   * mostly words — and it left a gallery 1,200px wide inside a 1,512px laptop,
   * with 156px of empty paper down each side. Tommy: *"the gallery is very
   * narrow."*
   *
   * A prop rather than raising the token, because the token is a *theme* value
   * read out of Firestore (`theme.web.shellWidth`) and shared by every page on
   * the site. Widening the parish's prose to 1,700px to fix the gallery would be
   * the wrong trade, and it would need a theme write to boot.
   */
  wide = false,
}: {
  children: React.ReactNode;
  flush?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={`wrap page-body${flush ? ' page-body--flush' : ''}${
        wide ? ' page-body--wide' : ''
      }`}
    >
      {children}
    </div>
  );
}
