/**
 * Turning a stream's address into an iframe src that starts playing on its own.
 *
 * Its own module, small as it is, because both halves of the player need it and
 * they live on opposite sides of the server/client line: `LivestreamPlayer`
 * builds the URL settled at build time, `LiveFrame` builds the one the probe
 * names at request time. Importing a helper out of `LivestreamPlayer` would
 * drag that whole server component — config types and all — into the client
 * bundle.
 */

/**
 * Why muted, and why that is not a compromise.
 *
 * Every browser worth naming refuses to start audio a reader did not ask for,
 * and has since 2018: an `autoplay=1` embed with sound simply does not start,
 * and the reader is left looking at a paused player they now have to press
 * anyway. `mute=1` is what makes the autoplay actually happen — so the choice
 * is not "muted or loud", it is "muted or still stopped".
 *
 * The player's own controls are the way back to sound, which is why the frame
 * below says so in words rather than leaving someone to wonder why the liturgy
 * is silent.
 *
 * `playsinline=1` keeps iOS Safari from throwing the video into its fullscreen
 * player the moment it starts, which on a page that also lists the recent
 * services would take the reader somewhere they did not ask to go.
 *
 * `rel=0` narrows what YouTube offers when the broadcast ends: not "no related
 * videos" — YouTube stopped honouring that in 2018 — but at least videos from
 * the parish's own channel rather than whatever the algorithm likes today.
 */
const YOUTUBE_AUTOPLAY = 'autoplay=1&mute=1&playsinline=1&rel=0';

/** A YouTube video id as an embed that starts muted on its own. */
export function youtubeEmbed(videoId: string): string {
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${YOUTUBE_AUTOPLAY}`;
}

/**
 * The same treatment for a URL that already exists.
 *
 * Deliberately does nothing to an address it does not recognise. `platform:
 * 'custom'` is a provider's embed URL given verbatim by whoever set it, and
 * appending query parameters to an arbitrary provider's player is as likely to
 * break it as to help — some read an unknown parameter as a malformed request.
 * A stream that plays after one press is a far smaller failure than one that
 * does not play at all.
 */
export function withAutoplay(url: string): string {
  if (/^https:\/\/www\.youtube(-nocookie)?\.com\/embed\//.test(url)) {
    return `${url}${url.includes('?') ? '&' : '?'}${YOUTUBE_AUTOPLAY}`;
  }

  /*
   * Facebook's plugin takes `autoplay` and mutes itself when it obeys it —
   * there is no `mute` parameter to pass, and the player shows its own unmute
   * button. Same reasoning as YouTube's above, one parameter shorter.
   */
  if (url.startsWith('https://www.facebook.com/plugins/video.php')) {
    return `${url}${url.includes('?') ? '&' : '?'}autoplay=true`;
  }

  return url;
}
