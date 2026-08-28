/**
 * The two store badges, for any app the parish links to.
 *
 * ---------------------------------------------------------------------------
 * **The badges are not ours to touch.** Apple's may not be recoloured,
 * recomposed, redrawn or reworded, and Google's may not be modified and needs
 * clear space around it. They are copied through the asset pipeline byte for
 * byte — see the note there — and rendered as plain `<img>`, not as a
 * `mask-image` painted with `currentColor` the way the footer's social glyphs
 * are. If a redesign wants them in the parish's colours, the answer is no.
 *
 * The alt text is each badge's own wording. Apple's guidelines fix that phrase,
 * and it is also exactly what a screen reader should hear — the link's purpose
 * is the sentence written on it.
 *
 * The one thing that *is* a judgement call is the pair of heights, which are not
 * equal on purpose and are not a free choice either. Apple's artwork fills its
 * box; Google's file is the badge inside its own mandated clear space — measured
 * on the shipped PNG, the black pill is 564x168 of a 646x250 file, so 16.4% of
 * every edge is padding. Give the two `img` elements the same height and the
 * Play pill is a fifth shorter than the App Store one. `.store-badge--play`
 * derives its box from that ratio; the numbers live there, not here.
 * ---------------------------------------------------------------------------
 *
 * In `src/components/` rather than in `features/giving/`, where this markup
 * started, because two features need it now: the offering app on `/giving` and
 * every app on `/apps`. Written once means the vendors' rules are honoured once
 * — the failure mode of a copy is a redesign quietly recolouring one of them.
 *
 * Either URL may be omitted. An app on one store only shows one badge, and an
 * app on neither renders nothing at all — which is what an unreleased app has to
 * do, because both vendors' terms cover badges linking to something you cannot
 * install.
 */
export function StoreBadges({
  ios,
  android,
  /**
   * Names the app in each link's accessible name.
   *
   * Two apps on one page would otherwise give a screen-reader user two links
   * both announcing "Download on the App Store", with nothing to say which is
   * which. The badge itself cannot carry the name — that would be rewording
   * Apple's artwork — so it goes in text beside it.
   */
  appName,
}: {
  ios?: string | undefined;
  android?: string | undefined;
  appName: string;
}) {
  if (!ios && !android) return null;

  return (
    <ul className="store-badges">
      {ios && (
        <li>
          <a href={ios} rel="noopener noreferrer" target="_blank">
            <img
              className="store-badge store-badge--apple"
              src="/brand/app-store-badge.svg"
              alt="Download on the App Store"
              width={132}
              height={44}
            />
            <span className="visually-hidden"> — {appName}, opens in a new tab</span>
          </a>
        </li>
      )}
      {android && (
        <li>
          <a href={android} rel="noopener noreferrer" target="_blank">
            <img
              className="store-badge store-badge--play"
              src="/brand/google-play-badge.png"
              alt="Get it on Google Play"
              width={137}
              height={53}
            />
            <span className="visually-hidden"> — {appName}, opens in a new tab</span>
          </a>
        </li>
      )}
    </ul>
  );
}
