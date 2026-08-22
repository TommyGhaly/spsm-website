'use client';

import { InheritedLiveState, useLiveStatus, type LiveProbe } from './useLiveStatus';

/**
 * Renders its children only while a liturgy is actually being streamed.
 *
 * This is the homepage's answer to a quiet Tuesday, and it is deliberately a
 * different answer from `/livestream`'s. That page exists to answer "can I
 * watch?", so it owes the reader a reply either way — the "no live stream right
 * now" band. The homepage owes no such reply: a "Watch the Liturgy" section
 * with nothing behind it is a heading advertising something that is not there,
 * on the one page most visitors see first. So the section goes.
 *
 * `children` rather than props carrying the markup: the section is built on the
 * server — headings, config, the lot — and passed in as already-rendered
 * output. Only the decision to show it is client-side. (This is the documented
 * slot pattern; see the "Interleaving Server and Client Components" guide in
 * `node_modules/next/dist/docs/`.)
 *
 * **`checking` hides too**, which is the opposite of the choice `LiveFrame`
 * makes and is right for the same reason the two differ above. Showing the
 * section during the probe and pulling it a moment later shifts everything
 * below it up the page just as someone starts to read — and since the stream is
 * off far more often than it is on, that jolt would be the common case rather
 * than the rare one. A section that is usually absent should stay absent until
 * there is a reason for it.
 */
export function ShowWhenLive({
  probe,
  children,
}: {
  /**
   * Where to read the stream's status. `null` means the provider can't be
   * asked, and the children render unconditionally — the same fail-open rule
   * used everywhere else here, because wrongly hiding a live liturgy is the one
   * failure this feature must not have.
   */
  probe: LiveProbe | null;
  children: React.ReactNode;
}) {
  /*
   * `unknown` hides too, for the same reason `checking` does. There is nothing
   * to put in the frame — the state exists precisely because no video id could
   * be resolved — so the section would be a heading over an empty box. The
   * reader who wants to know why is served on `/livestream`, which says so in
   * words and offers the link out; the homepage stays quiet.
   */
  const state = useLiveStatus(probe);

  if (state.status !== 'live') return null;

  /*
   * Handed down rather than asked again. The section's own `LiveFrame` needs
   * the video id this call just resolved, and probing a second time would be
   * two requests per homepage load and two answers that can disagree on screen.
   */
  return <InheritedLiveState.Provider value={state}>{children}</InheritedLiveState.Provider>;
}
