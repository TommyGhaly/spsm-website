'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { focalPosition, type DocOf, type GalleryMedia } from '@spsm/shared';
import { DragRail } from '@/components/DragRail';
import { Icon } from '@/components/Icon';
import { galleryPosterUrl, galleryVideoUrl } from './media';

/**
 * The hall screen: a collage that never stops moving.
 *
 * ## What this replaced, and why
 *
 * One photograph at a time, held for eight seconds, cross-fading to the next.
 * That is a slideshow, and a slideshow on a wall reads as a screensaver — for
 * seven of every eight seconds nothing at all is happening, and what is on
 * screen is one picture surrounded by empty ground. Tommy's word for it was
 * "unprofessional", and the diagnosis in the same breath was the fix: *a
 * collage, moving by itself*.
 *
 * So: several columns of photographs, side by side, filling the screen and
 * drifting continuously. Adjacent columns drift in **opposite directions**,
 * which is what makes it read as a composition in motion rather than as a list
 * going past. There is no slide, no timer, and nothing to advance — the state
 * that used to exist (`index`, `paused`, a guard timer per video) is gone, and
 * with it the whole class of bug where the timer and the video disagreed about
 * whose turn it was.
 *
 * ## It reuses the section rails rather than reimplementing them
 *
 * Each column is a `DragRail axis="y"`, the same component a `column` section
 * uses on a public page. That is not code-sharing for its own sake: the endless
 * loop, the sub-pixel drift accumulation, the tab-away clamp and the
 * reduced-motion opt-out are all subtle, all already solved there, and a second
 * implementation of them would be a second set of the same bugs. A negative
 * `speed` is all "drift downward" takes — `wrap` has always folded negative
 * positions back into range.
 *
 * ## Video
 *
 * Autoplays, loops, and is muted. Muted is not a compromise here, it is the
 * price of the requirement: an unattended page has no user gesture behind it, so
 * an unmuted clip is *refused* by every browser and the tile sits on its poster
 * frame instead. A hall screen is watched, not listened to. (The lightbox, which
 * only ever opens from a click, does have sound — see Lightbox.tsx.)
 */

/**
 * Drift speeds, in px/s, cycled across the columns.
 *
 * Signs alternate so neighbouring columns move against each other. The
 * magnitudes are deliberately close but not equal: identical speeds make the
 * columns read as one sheet sliding, and wildly different ones read as a fault.
 *
 * Slower than the ministries rail on the homepage (75px/s), because that strip
 * is asking to be read and this one is asking to be looked at. At 34px/s a
 * portrait crosses a 900px column in about half a minute.
 */
const SPEEDS = [34, -28, 40, -32, 30, -36] as const;

/** How long after the last mouse move the chrome and the pointer disappear. */
const IDLE_MS = 4000;

/**
 * The most columns to draw, by viewport width.
 *
 * Four is the point where a photograph in a column is still a photograph on a
 * 1440px screen. Two on a phone — one column is not a collage, and three is a
 * set of stamps.
 */
function columnsFor(width: number): number {
  if (width < 700) return 2;
  if (width < 1180) return 3;
  return 4;
}

export function Presentation({
  media,
  label,
  onExit,
}: {
  /** Everything approved in the subtree being presented, in the order to show them. */
  media: readonly DocOf<GalleryMedia>[];
  /** What is being presented — "Summercamp Week 1 2027", "Day 2". */
  label: string;
  onExit: () => void;
}) {
  const [idle, setIdle] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [columns, setColumns] = useState(3);
  const stage = useRef<HTMLDivElement | null>(null);

  /* How many columns fit. Re-read on resize, because a projector can be
     re-plugged and a window can be dragged between screens. */
  useEffect(() => {
    const read = () => setColumns(columnsFor(window.innerWidth));
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  /**
   * The pictures, dealt into columns.
   *
   * Dealt round-robin rather than cut into blocks, and that matters: a gallery is
   * ordered, usually chronologically, so consecutive photographs are of the same
   * moment from the same place. Cut into four blocks, each column would be a
   * quarter of the afternoon and the screen would show four unrelated scenes.
   * Dealt, each column carries a spread of the whole set and the screen looks
   * like the camp rather than like four lists.
   *
   * Capped at as many columns as there is material for. Four columns holding one
   * photograph each is not a collage, and a column with one item cannot loop —
   * `DragRail` correctly refuses to drift a strip that already fits.
   */
  const lanes = useMemo(() => {
    if (media.length === 0) return [];
    const count = Math.max(1, Math.min(columns, Math.ceil(media.length / 2)));
    const dealt: DocOf<GalleryMedia>[][] = Array.from({ length: count }, () => []);
    media.forEach((item, index) => {
      dealt[index % count]?.push(item);
    });
    return dealt;
  }, [media, columns]);

  const toggleFullscreen = useCallback(() => {
    const node = stage.current;
    if (!node) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void node.requestFullscreen?.().catch(() => undefined);
  }, []);

  /* The keyboard, and the scroll lock. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Fullscreen first: the browser is already closing it on this press, and
        // leaving the presentation at the same time means one Escape both
        // un-maximises the window and navigates away.
        if (document.fullscreenElement) return;
        event.preventDefault();
        onExit();
        return;
      }
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        toggleFullscreen();
      }
    };

    const onFullscreenChange = () => setFullscreen(document.fullscreenElement !== null);

    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreenChange);

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.body.style.overflow = overflow;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [onExit, toggleFullscreen]);

  /*
   * Going quiet.
   *
   * A separate effect from the keyboard because it restarts on every mouse move,
   * and folding it in would re-register the key listener with it.
   */
  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), IDLE_MS);

    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), IDLE_MS);
    };

    document.addEventListener('mousemove', wake);
    document.addEventListener('touchstart', wake);
    document.addEventListener('keydown', wake);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousemove', wake);
      document.removeEventListener('touchstart', wake);
      document.removeEventListener('keydown', wake);
    };
  }, []);

  /*
   * Nothing to show.
   *
   * Its own state rather than a redirect, and phrased at the person standing in
   * the hall rather than at a developer: the usual cause is that the photographs
   * of this camp are cleared for its page and not for the screen, which is a
   * thing they can go and fix.
   */
  if (lanes.length === 0) {
    return (
      <div className="collage collage--empty">
        <div className="collage__notice">
          <h1>Nothing to present</h1>
          <p>
            No photographs from {label} are marked for the screen. An administrator sets that
            per photograph, separately from the ones shown on the page.
          </p>
          <button type="button" className="button" onClick={onExit}>
            Back to the gallery
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`collage${idle ? ' is-idle' : ''}`} ref={stage}>
      <div className="collage__lanes">
        {lanes.map((lane, index) => (
          <DragRail
            // The lane's position in the row *is* its identity — remounting on a
            // resize is what re-deals the pictures, which is intended.
            key={`lane-${index}-of-${lanes.length}`}
            axis="y"
            className="rail--collage"
            /*
              `?? SPEEDS[0]` because `noUncheckedIndexedAccess` types a modular
              index as possibly undefined, and `exactOptionalPropertyTypes` then
              refuses to pass that to an optional prop. The modulo means it can
              never actually be undefined; the fallback says so in a way the
              compiler accepts without an assertion.
            */
            speed={SPEEDS[index % SPEEDS.length] ?? SPEEDS[0]}
          >
            <ul className="collage__lane">
              {lane.map((item) => (
                <li key={item.id} style={{ aspectRatio: aspectOf(item) }}>
                  <CollageItem item={item} />
                </li>
              ))}
            </ul>
          </DragRail>
        ))}
      </div>

      {/*
        The chrome. Two controls and a name — everything the slideshow had that
        was about *the slideshow* rather than about the photographs (a progress
        bar, a pause button, a per-picture caption) is gone, because there is no
        longer a sequence for any of it to describe.
      */}
      <div className="collage__chrome">
        <p className="collage__label">{label}</p>
        <div className="collage__controls">
          <button
            type="button"
            className="collage__control"
            onClick={toggleFullscreen}
            aria-pressed={fullscreen}
          >
            <Icon name="expand" size={18} />
            <span className="visually-hidden">
              {fullscreen ? 'Leave full screen' : 'Fill the screen'}
            </span>
          </button>
          <button type="button" className="collage__control" onClick={onExit}>
            <Icon name="close" size={18} />
            <span className="visually-hidden">Leave the presentation</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One tile of the collage.
 *
 * `aria-hidden` on the whole thing, via the lane: this is ambient decoration on
 * a screen nobody is navigating with a keyboard, the captions are not drawn, and
 * every photograph appears in the gallery pages properly labelled. Announcing two
 * hundred unlabelled images would be worse than announcing none.
 */
function CollageItem({ item }: { item: DocOf<GalleryMedia> }) {
  const poster = galleryPosterUrl(item);
  const video = galleryVideoUrl(item);

  if (video) {
    return (
      <video
        className="collage__media"
        src={video}
        {...(poster ? { poster } : {})}
        autoPlay
        // See the note at the top: muted is what makes unattended autoplay legal.
        muted
        loop
        playsInline
        // A clip that will not load leaves its poster frame, which is a
        // photograph — better than a black hole in the collage.
        preload="metadata"
      />
    );
  }

  if (poster === null) return <span className="collage__media collage__media--blank" />;

  return (
    <img
      className="collage__media"
      src={poster}
      alt=""
      loading="lazy"
      decoding="async"
      style={{ objectPosition: focalPosition(item.focal) }}
    />
  );
}

/** A tile's shape, so the lane measures correctly before anything has loaded. */
function aspectOf(item: DocOf<GalleryMedia>): string {
  if (item.width && item.height && item.width > 0 && item.height > 0) {
    return `${item.width} / ${item.height}`;
  }
  return '3 / 2';
}
