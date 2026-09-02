'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FLYTHROUGH } from './images';

type Chapter = { start: number; text: string };

/**
 * A chapter's label, out of its cue text.
 *
 * The cues are written to be read along the bottom of the film — full
 * sentences, sometimes two. A chip is not that, so this takes the first
 * sentence and drops the rest: "The whole site, from above Rice Road. Nothing
 * here is built." becomes "The whole site, from above Rice Road."
 *
 * Deriving it beats adding a `label` field beside every cue, which is the
 * duplication this whole component exists to avoid — and the first sentence of
 * a cue written to name what is on screen is, reliably, the name of what is on
 * screen.
 */
const label = (text: string) => {
  const [first] = text.split(/(?<=\.)\s+/);
  return (first ?? text).replace(/\.$/, '');
};

const clock = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/**
 * The flythrough, with a chapter list built out of its own cue track.
 *
 * ---------------------------------------------------------------------------
 * **The chapters are read from the VTT at runtime, not declared here.** That is
 * the one design decision in this file worth defending. The obvious version is
 * an array of `{ time, label }` in TypeScript beside the identical array in
 * `public/video/future-flythrough.vtt` — two lists of the same fourteen
 * timings, guaranteed to drift the first time the flythrough is re-cut and
 * somebody updates one. Instead the component waits for the browser to parse
 * the track it is already loading for the caption line and reads `track.cues`.
 * One source of timings, and it is the file the browser is using anyway.
 *
 * The cost is that the list is empty for a beat on first paint and then fills
 * in — which is why it renders nothing at all rather than a row of skeletons,
 * and why the video does not depend on it.
 *
 * **This is a client component and the rest of the page is not.** Everything
 * else here is a server render with no JavaScript; seeking a video on a click
 * cannot be. What it is careful about is degrading: with scripting off the
 * `<video>` is still a complete, autoplaying, captioned player with the
 * browser's own controls, and all that is missing is the shortcut list. That
 * is why the markup below is the same element the server component used to
 * render, with the chapters bolted on after it rather than wrapped around it.
 *
 * `autoPlay muted playsInline` — asked for, and all three are needed: muted is
 * what makes Safari and Chrome *allow* autoplay (their policies test the
 * attribute, not whether the file has an audio track — this one does not), and
 * `playsInline` stops iOS taking the video full-screen and dropping the reader
 * out of the page. `controls` stays, because an autoplaying three-and-a-half
 * minute animation nobody can pause is one they fight. No `loop`: it is the
 * subject of the page, not wallpaper.
 * ---------------------------------------------------------------------------
 */
export function Film() {
  const video = useRef<HTMLVideoElement>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [at, setAt] = useState(0);

  useEffect(() => {
    const element = video.current;
    if (!element) return;

    /*
     * `track.cues` is null until the browser has fetched and parsed the VTT,
     * and there is no single reliable event for "the cues are ready" across
     * browsers — `load` on the `<track>` fires in Chrome but the track may
     * already be parsed before this effect runs, in which case it never fires
     * at all. So: try immediately, and also listen. Whichever wins, `read`
     * bails if it has already filled the list.
     */
    const read = () => {
      const track = element.textTracks[0];
      if (!track?.cues || track.cues.length === 0) return false;
      setChapters(
        Array.from(track.cues).map((cue) => ({
          start: cue.startTime,
          text: (cue as VTTCue).text,
        })),
      );
      return true;
    };

    if (read()) return;

    const node = element.querySelector('track');
    node?.addEventListener('load', read);
    /* Last resort for a browser that parses the track without firing `load`
       where we can hear it. One check a beat later costs nothing and is the
       difference between a chapter list and no chapter list. */
    const timer = window.setTimeout(read, 600);

    return () => {
      node?.removeEventListener('load', read);
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    /* `timeupdate` fires about four times a second, which is plenty to keep the
       highlight in step and far cheaper than a rAF loop. */
    const onTime = () => setAt(element.currentTime);
    element.addEventListener('timeupdate', onTime);
    return () => element.removeEventListener('timeupdate', onTime);
  }, []);

  const seek = useCallback((seconds: number) => {
    const element = video.current;
    if (!element) return;
    element.currentTime = seconds;
    /* Autoplay may have been refused, or the reader may have paused. Either
       way, clicking a chapter means "show me this", so play — and swallow the
       rejection, because a browser that refuses is not an error to report. */
    void element.play().catch(() => {});
  }, []);

  const active = chapters.reduce(
    (found, chapter, index) => (at >= chapter.start ? index : found),
    -1,
  );

  return (
    <figure className="future-film">
      <video
        ref={video}
        className="future-film__video"
        controls
        autoPlay
        muted
        playsInline
        poster={FLYTHROUGH.poster}
        width={FLYTHROUGH.width}
        height={FLYTHROUGH.height}
      >
        <source src={FLYTHROUGH.src} type={FLYTHROUGH.type} />
        <track
          kind="captions"
          src={FLYTHROUGH.captions}
          srcLang="en"
          label="What you are looking at"
          default
        />
        <p className="future-film__fallback">
          A {FLYTHROUGH.length} animation walking through the proposed church and grounds. The
          pictures below this are frames taken from it.
        </p>
      </video>

      {chapters.length > 0 && (
        <nav className="future-chapters" aria-label="Jump to a part of the walk-through">
          <ul className="future-chapters__list">
            {chapters.map((chapter, index) => (
              <li key={chapter.start}>
                <button
                  type="button"
                  className="future-chapters__item"
                  onClick={() => seek(chapter.start)}
                  aria-current={index === active ? 'true' : undefined}
                >
                  <span className="future-chapters__at">{clock(chapter.start)}</span>
                  <span className="future-chapters__what">{label(chapter.text)}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <figcaption className="future-film__caption">
        <strong>A walk through it.</strong> {FLYTHROUGH.length}, silent, and it starts on its own —
        up the steps, through the piazza, around the two buildings behind, then over the whole
        site. The line along the bottom names what is on screen; the list above jumps to any part
        of it.
      </figcaption>
    </figure>
  );
}
