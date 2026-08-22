'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { focalPosition, type DocOf, type GalleryMedia } from '@spsm/shared';
import { Icon } from '@/components/Icon';
import { galleryPosterUrl, galleryVideoUrl } from './media';

/**
 * The slide: one photograph, whole, advancing itself.
 *
 * ## This is the thing the columns replaced, and it had to answer for itself
 *
 * The first presentation this parish had was exactly this — one picture, eight
 * seconds, cross-fade — and it was thrown out for two reasons that are written
 * down in PresentColumns.tsx and in docs/program-galleries.md. It is back
 * because Tommy asked for it back, as *one of three* rather than as the only
 * one, and because "one picture, large, and I say when" is a real thing to want
 * from a screen somebody is standing next to. Both original faults are answered
 * here rather than reintroduced:
 *
 * - **The empty ground.** A whole photograph on a 16:9 screen cannot fill it —
 *   that is what "whole" means — so the ground is a blurred, darkened copy of
 *   the *same* photograph, and the picture sits on it with a shadow. Nothing
 *   floats in a void, and the colour behind each picture is its own.
 *
 *   The cross-fade did *not* come back with it, and that is deliberate — see
 *   `.slide__face` in globals.css, where the reason is written down: a fade needs
 *   the incoming picture to start invisible, and anywhere the animation clock
 *   stalls that leaves a screen showing the wrong photograph all evening.
 * - **Nothing happening.** Answered by not being the only style. A hall screen
 *   left alone for an evening should be the columns; this is for a screen with a
 *   person at it, which is why the hand always wins here (see below).
 *
 * ## The timer and the hand are the same quantity
 *
 * There is one piece of state, `index`. The timer's only power is to set it, and
 * every manual advance sets it too — which means the timer *restarts* on every
 * manual advance for free, because the effect that owns it depends on `index`.
 * A whole class of carousel bug (the picture changing a quarter-second after you
 * pressed the arrow, because the old countdown was still running) cannot happen
 * in this arrangement.
 *
 * ## Video
 *
 * A clip is not given eight seconds and cut off — it plays to its end and then
 * advances, which is what the timer and the video "disagreeing about whose turn
 * it was" used to mean in the first version. `ended` is the signal. The guard
 * below is for the clip that never plays at all.
 */

/**
 * How long a photograph is held at `steady`. The parish's original eight seconds.
 *
 * Divided by the pace factor, not replaced by a second table: eight seconds is
 * the number that was chosen for this screen, and the control moves it rather
 * than overriding it.
 */
const PHOTO_MS = 8000;

/**
 * How long a clip is given when it has not said how long it is.
 *
 * `ended` is the real advance for a video, and a clip that fails to load never
 * fires it — which would park a hall screen on one frozen poster for the rest of
 * the evening. So there is a fallback, and it is set from `duration` the moment
 * the metadata arrives: a three-minute clip gets three minutes and two seconds,
 * and only a clip whose metadata never came at all falls back to this number.
 *
 * That is the distinction that keeps this from being the old bug. The old guard
 * was a *second* clock racing the video; this one is only ever consulted when
 * the video has told us nothing.
 */
const VIDEO_GUARD_MS = 30000;
/** Slack after a clip's own duration, so the guard never beats `ended` to it. */
const VIDEO_GUARD_SLACK_MS = 1500;

export function PresentSlide({
  media,
  label,
  factor,
}: {
  media: readonly DocOf<GalleryMedia>[];
  /** What is being presented, for the sequence's accessible name. */
  label: string;
  /**
   * The pace, as a multiplier. It *divides* the dwell here — the other two
   * styles multiply a speed, and a slide's speed is one over how long it waits.
   * `slow` is sixteen seconds a picture, `fast` is a little over three.
   */
  factor: number;
}) {
  const [index, setIndex] = useState(0);
  /**
   * How long the current slide gets, in ms.
   *
   * State rather than a ref because the timer effect has to re-run when a clip
   * reports its duration — the guard was set before we knew, and the moment we
   * know is a moment to correct it.
   */
  const [dwell, setDwell] = useState(PHOTO_MS);

  const count = media.length;
  const current = media[index];

  /*
   * A set that shrank under us — a photograph unapproved from another tab while
   * the kiosk was running — leaves the index past the end. Clamped here rather
   * than guarded at every read, because "the last picture" is the honest answer
   * and rendering nothing is not.
   */
  useEffect(() => {
    if (index >= count && count > 0) setIndex(count - 1);
  }, [index, count]);

  /** Move by `step`, wrapping. The one place the index changes. */
  const go = useCallback(
    (step: number) => {
      if (count === 0) return;
      setIndex((at) => (at + step + count) % count);
    },
    [count],
  );

  /*
   * The clock.
   *
   * **Deliberately not gated on `prefers-reduced-motion`,** which is a decision
   * and not an oversight. Elsewhere on this site that setting stops the
   * movement outright — the rails do not drift, the fades do not run — because
   * a rail that sits still is still a readable rail. A slide that does not
   * advance is not a slideshow; it is one photograph, forever, on a screen in a
   * hall that nobody is standing next to. So the *fade* is dropped for a reader
   * who asked for less movement (CSS does that) and the advance is kept.
   */
  useEffect(() => {
    if (count < 2) return;
    const timer = window.setTimeout(() => go(1), dwell);
    return () => window.clearTimeout(timer);
  }, [index, dwell, count, go]);

  /* A new slide is a new dwell. Photographs get theirs immediately; a clip's is
     corrected by `onLoadedMetadata` below, and stands at the guard until then. */
  useEffect(() => {
    /*
     * The pace moves the photographs and leaves the clips alone. A video's dwell
     * is the length of the video — cutting a clip off half way because somebody
     * asked the *photographs* to go faster is the pace setting reaching into
     * something that was never a timing decision.
     */
    setDwell(
      current && galleryVideoUrl(current) ? VIDEO_GUARD_MS : Math.round(PHOTO_MS / factor),
    );
  }, [current, factor]);

  /* The keyboard. Escape and `f` belong to the shell; these are the sequence's
     own. Space because it is what a person at a laptop presses, and PageDown
     because it is what a presentation remote sends. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const forward = event.key === 'ArrowRight' || event.key === ' ' || event.key === 'PageDown';
      const back = event.key === 'ArrowLeft' || event.key === 'PageUp';
      if (!forward && !back) return;
      event.preventDefault();
      go(forward ? 1 : -1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [go]);

  if (!current) return null;

  const previous = count > 1 ? media[(index - 1 + count) % count] : undefined;
  /* The next one, drawn but invisible, purely so its bytes are in cache before
     it is on screen. A slide that arrives mid-fade is the whole reason the first
     version looked slow on parish wifi. */
  const upcoming = count > 1 ? media[(index + 1) % count] : undefined;

  return (
    <div className="slide">
      {/*
        The ground: the same photograph, blurred and darkened, filling the
        screen. See the note at the top — this is what earns the slide its way
        back after `object-fit: contain` put every picture in a void.
      */}
      <SlideGround item={current} />

      <div
        className="slide__stage"
        role="group"
        aria-label={`${label}: photograph ${index + 1} of ${count}`}
        /*
          The whole stage advances. A person standing at a laptop clicks the
          picture, not a 44px arrow in the corner — and the arrows are gone from
          the screen four seconds in anyway.
        */
        onClick={() => go(1)}
      >
        {/*
          The outgoing picture, still drawn underneath.

          Not for a crossfade — there is no longer one; see `.slide__face` in
          globals.css for why the fade came off. It is there so the cut has
          something behind it: a large photograph takes a moment to decode, and
          without this the screen shows the bare blurred ground in the gap.
        */}
        {previous && <SlideFace item={previous} key={`under-${previous.id}`} beneath />}
        <SlideFace
          // Keyed by the item, so each slide is a new element rather than one
          // node whose `src` is rewritten — which is what lets the layer beneath
          // stay on screen until this one has actually painted.
          key={`face-${current.id}-${index}`}
          item={current}
          onEnded={() => go(1)}
          onDuration={(seconds) =>
            setDwell(Math.max(PHOTO_MS, seconds * 1000 + VIDEO_GUARD_SLACK_MS))
          }
        />

        {/*
          The arrows. Inside the stage rather than in the shell's chrome, because
          they belong to this style alone — and inside it rather than beside it so
          they are centred on the picture rather than on the screen.

          `stopPropagation` because the stage itself advances on click: without
          it, pressing "back" would go back and then immediately forward, which
          looks exactly like an arrow that does not work.
        */}
        <button
          type="button"
          className="slide__arrow slide__arrow--prev"
          onClick={(event) => {
            event.stopPropagation();
            go(-1);
          }}
          disabled={count < 2}
        >
          <Icon name="prev" size={22} />
          <span className="visually-hidden">Previous photograph</span>
        </button>
        <button
          type="button"
          className="slide__arrow slide__arrow--next"
          onClick={(event) => {
            event.stopPropagation();
            go(1);
          }}
          disabled={count < 2}
        >
          <Icon name="next" size={22} />
          <span className="visually-hidden">Next photograph</span>
        </button>
      </div>

      {upcoming && <SlidePreload item={upcoming} />}

      <div className="slide__foot">
        {current.caption && <p className="slide__caption">{current.caption}</p>}
        <p className="slide__count" aria-hidden>
          {index + 1} / {count}
        </p>
      </div>

      {/*
        How long this one has left.

        A CSS animation restarted by the key, rather than a value this component
        tracks: a progress bar driven from React state is sixty renders a second
        for a line four pixels tall. Where frames are scarce it simply sits at
        one end — which is the right way for it to fail, since nothing depends
        on it.
      */}
      <div
        className="slide__progress"
        key={`progress-${index}-${dwell}`}
        style={{ animationDuration: `${dwell}ms` }}
        aria-hidden
      />
    </div>
  );
}

/**
 * The blurred ground.
 *
 * Its own element rather than a background on the stage, because it is keyed and
 * fades: the ground changing colour under a picture that is itself fading in is
 * most of what makes the transition read as one movement.
 *
 * A clip's poster does the same job. A picture with no poster at all leaves the
 * plain stage colour, which is the same thing the columns show for it.
 */
function SlideGround({ item }: { item: DocOf<GalleryMedia> }) {
  const poster = galleryPosterUrl(item);
  if (poster === null) return null;
  return (
    <div
      className="slide__ground"
      key={poster}
      style={{ backgroundImage: `url(${JSON.stringify(poster)})` }}
      aria-hidden
    />
  );
}

/**
 * The photograph itself: whole, centred, shadowed.
 *
 * `beneath` is the outgoing copy — same markup, no animation, no video. Not a
 * video because two clips playing at once for the length of a fade is two
 * decoders and two soundtracks' worth of work for a layer that is being covered
 * up.
 */
function SlideFace({
  item,
  beneath = false,
  onEnded,
  onDuration,
}: {
  item: DocOf<GalleryMedia>;
  beneath?: boolean;
  onEnded?: () => void;
  onDuration?: (seconds: number) => void;
}) {
  const video = beneath ? null : galleryVideoUrl(item);
  const poster = galleryPosterUrl(item);
  const ref = useRef<HTMLVideoElement | null>(null);

  const className = `slide__face${beneath ? ' slide__face--beneath' : ''}`;

  if (video) {
    return (
      <video
        ref={ref}
        className={className}
        src={video}
        {...(poster ? { poster } : {})}
        autoPlay
        // Muted, for the reason every autoplaying clip on this site is: an
        // unattended page has no gesture behind it and an unmuted clip is
        // refused outright. See PresentParts.tsx.
        muted
        playsInline
        // **Not** looped. `ended` is what advances the slide; a looping clip
        // never ends and the guard timer would be the only thing that moved.
        onEnded={onEnded}
        onLoadedMetadata={() => {
          const seconds = ref.current?.duration;
          if (onDuration && seconds && Number.isFinite(seconds)) onDuration(seconds);
        }}
      />
    );
  }

  if (poster === null) return null;

  return (
    <img
      className={className}
      src={poster}
      alt={item.caption ?? ''}
      decoding="async"
      style={{ objectPosition: focalPosition(item.focal) }}
    />
  );
}

/** The next slide's bytes, fetched and not drawn. */
function SlidePreload({ item }: { item: DocOf<GalleryMedia> }) {
  const poster = galleryPosterUrl(item);
  if (poster === null) return null;
  return <img className="slide__preload" src={poster} alt="" aria-hidden decoding="async" />;
}
