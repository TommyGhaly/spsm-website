'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocOf, GalleryMedia } from '@spsm/shared';
import { Icon } from '@/components/Icon';
import { PresentColumns } from './PresentColumns';
import { PresentNotebook } from './PresentNotebook';
import { PresentSlide } from './PresentSlide';
import { NOTEBOOK_MIN_WIDTH, useViewportWidth } from './PresentParts';
import {
  PACE_FACTORS,
  PRESENTATION_PACES,
  PRESENTATION_PACE_NAMES,
  PRESENTATION_STYLES,
  PRESENTATION_STYLE_NAMES,
  type PresentationPace,
  type PresentationStyle,
} from './route';

/**
 * The screen in the hall: everything the three presentation styles have in
 * common, and nothing that belongs to one of them.
 *
 * Started on a laptop in the hall and left alone for an evening. That sentence
 * is what this file is: it starts by itself, it never ends, a file that fails to
 * load costs nothing, and the chrome and the mouse pointer disappear after a few
 * seconds.
 *
 * ## Three styles, one shell
 *
 * There was one style — drifting columns — and there are three, at Tommy's
 * direction: the columns, a traditional slide that turns on a timer and by hand,
 * and a notebook of overlapping prints sliding leftward with vertical wheels
 * turning inside it. Each is its own file, because each is a genuinely different
 * idea about what a screen of photographs is for:
 *
 * | Style | File | For |
 * |---|---|---|
 * | `columns` | PresentColumns.tsx | a wall, unattended, all evening |
 * | `slide` | PresentSlide.tsx | one picture at a time, with somebody at the keyboard |
 * | `notebook` | PresentNotebook.tsx | a plane of prints, read across like a page |
 *
 * What stayed here is what should not differ between them: full screen, `Esc`,
 * going quiet, the label, the switcher, and the empty state. What did *not* stay
 * here is anything about a sequence — the slide's arrows, counter and progress
 * line live with the slide, because the other two styles have no sequence for
 * them to describe.
 *
 * ## The style and the pace are in the URL, and the controls are the same choice
 *
 * `?present=slide&pace=brisk`. A kiosk is pointed at one URL and left running, so
 * both have to survive a restart and be readable out loud over the phone — see
 * `PRESENTATION_STYLES` and `PRESENTATION_PACES` in route.ts. The controls on
 * screen write the same parameters (`history.replaceState`, in the shell above),
 * so what somebody chose at the laptop is what comes back after the machine
 * reboots overnight.
 *
 * **Pace is one number handed to whichever style is drawing**, not three
 * settings. Each style multiplies its own speeds by it, so "brisk" means the
 * same thing to a drifting column, a sliding plane and an eight-second slide
 * without any of them agreeing on a pixel rate.
 */

/** How long after the last mouse move the chrome and the pointer disappear. */
const IDLE_MS = 4000;

/**
 * Which styles this screen can actually draw.
 *
 * The notebook needs width — its whole effect is prints overlapping across a
 * plane wider than the screen, and on a phone there is room for one print and
 * its neighbours' corners. So a narrow screen is not *offered* it, rather than
 * being offered it and given the columns instead: a button that does something
 * other than what it says is worse than a button that is not there.
 *
 * A URL that asks for it anyway still presents — in the columns. A kiosk
 * bookmark opened on somebody's phone should show the photographs, not an error.
 */
function stylesFor(width: number): readonly PresentationStyle[] {
  if (width > 0 && width < NOTEBOOK_MIN_WIDTH) {
    return PRESENTATION_STYLES.filter((style) => style !== 'notebook');
  }
  return PRESENTATION_STYLES;
}

export function Presentation({
  media,
  label,
  style,
  pace,
  onStyle,
  onPace,
  onExit,
}: {
  /** Everything approved in the subtree being presented, in the order to show them. */
  media: readonly DocOf<GalleryMedia>[];
  /** What is being presented — "Summercamp Week 1 2027", "Day 2". */
  label: string;
  /** Which style the URL asks for. */
  style: PresentationStyle;
  /** How fast it should move. */
  pace: PresentationPace;
  /** Choose another. The shell above writes it to the address bar. */
  onStyle: (style: PresentationStyle) => void;
  /** Change the speed. Also written to the address bar. */
  onPace: (pace: PresentationPace) => void;
  onExit: () => void;
}) {
  const [idle, setIdle] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const stage = useRef<HTMLDivElement | null>(null);
  const chrome = useRef<HTMLDivElement | null>(null);
  const width = useViewportWidth();

  const offered = stylesFor(width);
  /* What is drawn, as opposed to what was asked for. They differ only for a
     notebook URL opened on a phone; see `stylesFor`. */
  const drawn = offered.includes(style) ? style : 'columns';
  /* The one number every style multiplies its own speeds by. */
  const factor = PACE_FACTORS[pace];

  /**
   * Faster, or slower, by one step. Clamped rather than wrapped: a control whose
   * "+" jumps from the fastest back to the slowest is a control that undoes
   * itself the one time somebody presses it twice.
   */
  const shiftPace = useCallback(
    (step: number) => {
      const at = PRESENTATION_PACES.indexOf(pace);
      const next = PRESENTATION_PACES[Math.min(PRESENTATION_PACES.length - 1, Math.max(0, at + step))];
      if (next && next !== pace) onPace(next);
    },
    [pace, onPace],
  );

  const toggleFullscreen = useCallback(() => {
    const node = stage.current;
    if (!node) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void node.requestFullscreen?.().catch(() => undefined);
  }, []);

  /* The keyboard: leaving, filling the screen, the style and the pace. */
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
        return;
      }
      /*
       * `s` cycles the style, because the switcher is invisible four seconds in
       * and the machine driving a projector usually has no mouse anywhere near
       * it. It cycles what this screen can draw rather than all three, so it
       * never lands on the notebook on a phone.
       */
      if (event.key === 's' || event.key === 'S') {
        event.preventDefault();
        const at = offered.indexOf(drawn);
        const next = offered[(at + 1) % offered.length];
        if (next) onStyle(next);
        return;
      }
      /*
       * Up and down for the pace. Left and right are the slide's, for moving
       * through the photographs — so the axis that means "through the set" and
       * the axis that means "how fast" are different axes, on every style.
       */
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        shiftPace(1);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        shiftPace(-1);
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onExit, toggleFullscreen, onStyle, offered, drawn, shiftPace]);

  /*
   * Full screen: watching it, and giving it back on the way out.
   *
   * **Its own effect, with no dependencies, and it is the second time this
   * lesson has been learned in this file.** Both of these lines lived in the
   * keyboard effect above, whose dependencies now include the style and the pace
   * — so `exitFullscreen()` ran in that effect's cleanup *every time somebody
   * pressed a style or a speed*, and a projector in the hall dropped out of full
   * screen the moment anybody adjusted anything. See the scroll lock below for
   * the same shape of bug and the same fix: an undo that belongs to unmounting
   * must depend on nothing, or it fires on every re-render that changes a
   * dependency.
   */
  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  /*
   * The page behind does not scroll while this is over it.
   *
   * **Its own effect, with no dependencies, and that is the point.** It used to
   * live in the keyboard effect above, which was harmless while that effect ran
   * once — and stopped being harmless the moment the style switcher gave it
   * `drawn` to depend on. The lock is a *pair*: it reads the page's own overflow
   * on the way in and writes it back on the way out. Re-running the pair every
   * time somebody presses a style is a pair of operations whose ordering has to
   * be perfect to break even, and once it does not break even the page behind
   * the presentation is left permanently unable to scroll — with nothing on
   * screen to say why.
   *
   * Mounting and unmounting are the only two moments this should happen at, so
   * they are the only two the effect knows about.
   */
  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  /*
   * How tall the chrome is, published to CSS as `--present-chrome`.
   *
   * The slide is the one style that has to keep clear of the chrome — its caption
   * sits above it — and the chrome's height is not a number this stylesheet can
   * know: it is one row on a laptop and three on a phone, where the controls wrap.
   * Written from a measurement rather than guessed, because guessing it was
   * genuinely bad: two rounds of arithmetic in a media query both landed the
   * caption resting exactly on the top of the style buttons, and the next control
   * added to the chrome would have done it again.
   *
   * The 8px is the gap between the caption and the chrome; `.present` carries a
   * plausible default for the frames before this runs.
   *
   * **No dependency array, deliberately** — it re-publishes after every render,
   * and the `ResizeObserver` is the belt rather than the braces. A measurement
   * taken once and then left to an observer is a measurement that never updates
   * anywhere the observer does not fire, which includes this repo's own preview
   * pane. Reading one `offsetHeight` per render of a screen that renders on a
   * keypress is not a cost worth optimising against that.
   */
  useEffect(() => {
    const band = chrome.current;
    const box = stage.current;
    if (!band || !box) return;

    const publish = () => {
      /*
       * The band's own height, less its top padding: that padding is the
       * gradient's run-up and nothing is drawn in it, so a caption sitting over
       * the top of it is legible — it is darkened by the same scrim. Reserving
       * the gradient as well cost a phone a quarter of its screen.
       */
      const scrim = parseFloat(getComputedStyle(band).paddingTop) || 0;
      box.style.setProperty('--present-chrome', `${band.offsetHeight - scrim + 8}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(band);
    return () => observer.disconnect();
  });

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
  if (media.length === 0) {
    return (
      <div className="present present--empty">
        <div className="present__notice">
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
    <div className={`present present--${drawn}${idle ? ' is-idle' : ''}`} ref={stage}>
      {/*
        The stage. Keyed by style so switching genuinely rebuilds it: the styles
        share no state worth carrying across (a slide index means nothing to a
        plane), and remounting is what re-measures every rail for the new layout.
      */}
      <div className="present__stage" key={drawn}>
        {drawn === 'columns' && <PresentColumns media={media} width={width} factor={factor} />}
        {drawn === 'slide' && <PresentSlide media={media} label={label} factor={factor} />}
        {drawn === 'notebook' && <PresentNotebook media={media} factor={factor} />}
      </div>

      {/*
        The chrome: what is being presented, how it is being drawn, and the two
        ways out. Everything about a *sequence* — a progress line, a counter —
        belongs to the slide and is drawn by it.
      */}
      <div className="present__chrome" ref={chrome}>
        <p className="present__label">{label}</p>
        <div className="present__controls">
          <div className="present__styles" role="group" aria-label="How to present">
            {offered.map((option) => (
              <button
                key={option}
                type="button"
                className={`present__style${option === drawn ? ' is-on' : ''}`}
                aria-pressed={option === drawn}
                onClick={() => onStyle(option)}
              >
                {PRESENTATION_STYLE_NAMES[option]}
              </button>
            ))}
          </div>
          {/*
            The pace: two buttons and the name of where it is now.

            Not four labelled buttons like the style switcher, and that is a
            judgement about the chrome rather than about the setting — "Slow
            Steady Brisk Fast" beside "Columns Slide Notebook" is two rows of
            words on a screen whose whole job is to show photographs. Faster and
            slower is also how somebody thinks about it: they do not want
            "brisk", they want *a bit quicker than this*.
          */}
          <div className="present__pace" role="group" aria-label="How fast">
            <button
              type="button"
              className="present__control present__control--small"
              onClick={() => shiftPace(-1)}
              disabled={pace === PRESENTATION_PACES[0]}
            >
              <span aria-hidden>−</span>
              <span className="visually-hidden">Slower</span>
            </button>
            <p className="present__paceName" aria-live="polite">
              {PRESENTATION_PACE_NAMES[pace]}
            </p>
            <button
              type="button"
              className="present__control present__control--small"
              onClick={() => shiftPace(1)}
              disabled={pace === PRESENTATION_PACES[PRESENTATION_PACES.length - 1]}
            >
              <span aria-hidden>+</span>
              <span className="visually-hidden">Faster</span>
            </button>
          </div>
          <button
            type="button"
            className="present__control"
            onClick={toggleFullscreen}
            aria-pressed={fullscreen}
          >
            <Icon name="expand" size={18} />
            <span className="visually-hidden">
              {fullscreen ? 'Leave full screen' : 'Fill the screen'}
            </span>
          </button>
          <button type="button" className="present__control" onClick={onExit}>
            <Icon name="close" size={18} />
            <span className="visually-hidden">Leave the presentation</span>
          </button>
        </div>
      </div>
    </div>
  );
}
