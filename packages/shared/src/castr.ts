/**
 * Telling whether the parish's Castr stream is actually live.
 *
 * ---------------------------------------------------------------------------
 * Why this is read from the browser rather than known at build time
 *
 * The website is a static export: every page is HTML on disk, generated
 * whenever the site was last deployed. "Is a liturgy being streamed right now"
 * is the one question on this site whose answer changes by the hour, so it
 * cannot be baked in — a build on Sunday morning would still be claiming the
 * stream is live on Wednesday.
 *
 * The usual fix would be a Cloud Function polling the stream and writing a flag
 * to Firestore. That is not needed here, because Castr serves its player page
 * with `access-control-allow-origin: *` and states the stream's status in the
 * markup. The page can therefore ask Castr directly, from the reader's own
 * browser, at the moment they are looking — no function to deploy, no schedule
 * to pay for, no credential, and an answer that is current rather than up to a
 * minute stale.
 * ---------------------------------------------------------------------------
 *
 * The obvious fragility, stated rather than hidden: this reads another
 * company's HTML, which they may change without warning. That is why
 * `isStreamOffline` is written to fail *open* — see its note.
 */

/** Marks Castr's own "nothing is playing" screen. */
const OFFLINE_MARKERS = [
  // The Open Graph description, which Castr sets to this exact phrase when the
  // stream is down and to the stream's title when it is up. The most stable of
  // the three: it is a documented meta tag rather than internal markup.
  /<meta[^>]+property=["']og:description["'][^>]+content=["']\s*stream offline\s*["']/i,
  // The element Castr renders in place of the video.
  /id=["']playback-source-error-wrapper["']/i,
];

/**
 * True only when Castr positively says the stream is offline.
 *
 * **Fails open, and that direction is the whole point.** Anything unrecognised
 * — Castr restyling their player, a truncated response, an error page, an empty
 * string — returns `false`, meaning "assume live, show the player". The two
 * ways to be wrong are not symmetrical:
 *
 *   - Wrongly showing the player during a quiet week costs a reader one glance
 *     at Castr's own "Stream Offline" card, which is what this site showed
 *     before any of this existed.
 *   - Wrongly hiding it mid-liturgy tells a homebound parishioner there is no
 *     service when there is one, and hides the only way for them to attend.
 *
 * So the check must be able to fail towards the first of those and never the
 * second.
 */
export function isStreamOffline(html: string): boolean {
  return OFFLINE_MARKERS.some((marker) => marker.test(html));
}

/**
 * True when a target is a Castr player URL, and so can be asked the question
 * above.
 *
 * Checked on the hostname rather than assumed from `platform: 'custom'`,
 * because `custom` means "an iframe URL given verbatim" and the next provider
 * the parish tries will also arrive as `custom`. A Vimeo or Restream URL
 * probed for Castr's markup would look permanently live — which is the safe
 * answer, but for the wrong reason, and would quietly stop this feature
 * working with no sign that it had.
 */
export function isCastrTarget(target: string): boolean {
  try {
    const { protocol, hostname } = new URL(target);
    if (protocol !== 'https:' && protocol !== 'http:') return false;
    // Castr uses both .com and .io for players; match the registrable name
    // rather than a fixed host so a subdomain change does not break this.
    return /(^|\.)castr\.(com|io)$/i.test(hostname);
  } catch {
    return false;
  }
}
