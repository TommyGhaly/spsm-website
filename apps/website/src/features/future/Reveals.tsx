'use client';

import { useEffect } from 'react';

/**
 * What rises into place as it comes into view. Content blocks, not `section`s —
 * fading a whole band means fading its ground with it, and on this page's
 * alternating sunken and tinted grounds that reads as the page flickering.
 */
const SUBJECTS = [
  '.future-split__body',
  '.future-split__plate',
  '.future-head',
  '.future-plate--full',
  '.future-figure',
  '.future-uses__row',
  '.future-chron__row',
  '.future-gallery__cell',
  '.future-mark',
  '.future-team__row',
  '.future-give__inner > *',
].join(',');

/** Per-item stagger within a group, and the cap. Six steps of 60ms is a
    sequence; ten items each waiting for the last is a queue. */
const STEP = 60;
const MAX_STEP = 5;

/**
 * If the observer has not fired for something after this long, show it anyway.
 * Belt and braces for a case that should not happen — see the note below.
 */
const FAILSAFE = 4000;

/**
 * Scroll reveals for /about/future-plans.
 *
 * ---------------------------------------------------------------------------
 * **This was a CSS `animation-timeline: view()` block first, and it was
 * replaced because I could not verify it.** The scroll-driven version is
 * genuinely nicer — no JavaScript, no observer, the compositor does the work —
 * and it had two problems. The small one is Firefox, which still has it behind
 * a flag. The large one is that its failure mode is *invisible content*: the
 * start state is `opacity: 0`, and anything that stops the timeline resolving
 * leaves the page blank. That is not a thing to ship on a guess, and the
 * preview pane this was built in reports a zero-height viewport, which makes a
 * `view()` timeline permanently inactive and unverifiable.
 *
 * So: an observer, whose state is a data attribute anybody can read.
 *
 * **Nothing is ever hidden by CSS alone.** `data-reveal` is set by this
 * component, so with JavaScript off or broken no element carries it and the
 * page is simply the page. That is the inversion that makes this safe, and it
 * is the reason the attribute is applied here rather than rendered on the
 * server.
 *
 * **Elements already on screen at mount are never hidden at all.** Marking them
 * and then revealing them a frame later is a flash of empty page on load, which
 * is the thing that makes a site feel slow rather than alive.
 *
 * `prefers-reduced-motion` is honoured by doing nothing whatsoever — not by
 * shortening the transition. Someone who asked their machine for less movement
 * is not asking for quicker movement.
 * ---------------------------------------------------------------------------
 */
export function Reveals() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const root = document.querySelector('.future');
    if (!root) return;

    const all = Array.from(root.querySelectorAll<HTMLElement>(SUBJECTS));
    /* Below the fold only. Anything on screen now stays as it is. */
    const pending = all.filter((el) => el.getBoundingClientRect().top > window.innerHeight);
    if (pending.length === 0) return;

    for (const el of pending) el.dataset.reveal = '';

    const show = (el: HTMLElement) => {
      /*
       * Stagger by position among the siblings that are revealing together, so
       * a seven-row schedule arrives as a sequence rather than a slab. Read off
       * the DOM rather than passed in, because the groups here are of different
       * kinds — grid cells, table rows, figure captions — and the only thing
       * they have in common is a parent.
       */
      const siblings = el.parentElement
        ? Array.from(el.parentElement.children).filter((n) => n instanceof HTMLElement && 'reveal' in n.dataset)
        : [];
      const index = Math.min(Math.max(siblings.indexOf(el), 0), MAX_STEP);
      el.style.transitionDelay = `${index * STEP}ms`;
      el.dataset.shown = '';
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          show(entry.target as HTMLElement);
          observer.unobserve(entry.target);
        }
      },
      /* A negative bottom margin so the reveal happens once the element is
         properly in the frame rather than as its first pixel clears the fold —
         a block that finishes fading in below the reader's eye has not been
         seen to happen. */
      { rootMargin: '0px 0px -8% 0px', threshold: 0.02 },
    );

    for (const el of pending) observer.observe(el);

    /*
     * The one thing that must never happen is content that stays hidden. An
     * observer that does not fire — a browser bug, a display change, a
     * container that never scrolls — would do exactly that, so everything is
     * shown unconditionally after four seconds whatever the observer thinks.
     * In the normal case every element has already been unobserved by then and
     * this changes nothing.
     */
    const failsafe = window.setTimeout(() => {
      for (const el of pending) if (!('shown' in el.dataset)) el.dataset.shown = '';
    }, FAILSAFE);

    return () => {
      observer.disconnect();
      window.clearTimeout(failsafe);
      /* Leave the page visible on unmount rather than mid-transition. */
      for (const el of pending) {
        delete el.dataset.reveal;
        delete el.dataset.shown;
        el.style.transitionDelay = '';
      }
    };
  }, []);

  return null;
}
