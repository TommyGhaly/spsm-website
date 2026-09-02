'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { COPTIC_SEASONS, PASCHAL_PRAISE, transliterate } from './coptic';
import { TOUR_STATIONS } from './stations';
import type { Passport } from './passport';

/**
 * The pieces that belong to one station and could not be a `parts.tsx`
 * primitive — the passport, the name writer, the calendar, the hymn.
 */

/* ── The passport ────────────────────────────────────────────────────────── */

/**
 * Six stamps, stuck to the top of the screen.
 *
 * ---------------------------------------------------------------------------
 * This is the progress meter and the navigation at once, and merging them was
 * the point rather than an economy. A visitor walking the hall needs two things
 * from a phone: *where am I in this* and *take me to station 4, the guide has
 * moved on*. Two separate strips — a passport at the top and a jump bar under
 * it — is two rows of chrome above every station on a 390px screen, and the
 * second row says the same six words as the first.
 *
 * So the stamps are the buttons. A filled one is a station you have read, and
 * every one of them is a link to its station whether it is filled or not.
 *
 * Sticky rather than fixed: it scrolls away with the hero and then catches
 * under the masthead, so the top of the page is the tour rather than the
 * furniture. See `--masthead-h`, which is what it offsets against.
 * ---------------------------------------------------------------------------
 */
export function Passport({ passport }: { passport: Passport }) {
  const { stamped, ready, count, reset } = passport;
  const total = TOUR_STATIONS.length;

  /*
   * Clearing it takes two presses.
   * -------------------------------------------------------------------------
   * The reward at the foot of the page can clear the passport in one, because
   * a reader has to have scrolled the whole tour to reach it. This button is
   * in a strip that is stuck to the top of the screen for the entire visit,
   * an inch from six stamps that are also the navigation — so a one-press
   * version is a thumb-slip that throws away five stations in a crowded hall.
   *
   * The arming un-arms itself after a few seconds, so a passport is never
   * left one stray tap from empty.
   */
  const [arming, setArming] = useState(false);

  useEffect(() => {
    if (!arming) return undefined;
    const timer = window.setTimeout(() => setArming(false), 4000);
    return () => window.clearTimeout(timer);
  }, [arming]);

  // Nothing to clear before storage has been read, and nothing to clear on an
  // empty passport. The button keeps its box in both cases rather than being
  // dropped from the row: this strip's height is what every station's
  // `scroll-margin` is measured against, and a control that appears when
  // storage lands would shift the six stamps sideways under the reader's thumb.
  const clearable = ready && count > 0;

  return (
    <nav className="tour-passport" aria-label="Tour passport">
      <p className="tour-passport__count">
        {/*
          `ready` gates the number, not the strip. The stamps themselves render
          identically on the server and on first paint — all six unfilled — so
          the row never moves; only the sentence changes once storage is read,
          and it changes in place.
        */}
        <span className="tour-passport__label">Passport</span>
        <span className="tour-passport__score" aria-live="polite">
          {ready ? `${count} of ${total}` : `— of ${total}`}
        </span>
      </p>

      <ol className="tour-passport__stamps">
        {TOUR_STATIONS.map((station) => {
          const done = ready && stamped.has(station.id);
          return (
            <li key={station.id}>
              <a
                href={`#${station.id}`}
                className={`tour-stamp${done ? ' is-stamped' : ''}`}
                aria-label={`Station ${station.number}: ${station.title}${
                  done ? ' — stamped' : ''
                }`}
              >
                <span className="tour-stamp__num" aria-hidden="true">
                  {station.number}
                </span>
                <span className="tour-stamp__mark" aria-hidden="true">
                  ✓
                </span>
              </a>
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        className={`tour-passport__reset${arming ? ' is-arming' : ''}`}
        onClick={() => {
          if (!arming) {
            setArming(true);
            return;
          }
          setArming(false);
          reset();
        }}
        // `inert`, not unmounted: see `clearable`. It takes the box out of the
        // tab order and off the accessibility tree while keeping it in layout.
        inert={!clearable}
        aria-label={
          arming
            ? `Press again to clear all ${count} stamps`
            : 'Start the passport over'
        }
      >
        {arming ? 'Sure?' : 'Reset'}
      </button>
    </nav>
  );
}

/**
 * The button at the foot of a station, and the tripwire that presses it.
 *
 * Two ways to collect a stamp, because neither alone is right. The button is
 * for the reader who wants to say "done" — and it is the only way that works
 * for someone using a keyboard or a screen reader, who may never "scroll" past
 * anything. The observer is for everyone else, because a visitor who has read a
 * station should not have to also *report* having read it.
 *
 * The sentinel sits at the end of the station's prose, not the start, so
 * scrolling quickly past a station does not stamp it — you have to have brought
 * its last paragraph onto the screen.
 */
export function StampButton({
  station,
  passport,
}: {
  station: string;
  passport: Passport;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const done = passport.ready && passport.stamped.has(station);
  const { stamp, resetSeq } = passport;
  const armed = useRef(true);

  useEffect(() => {
    const node = sentinel.current;
    // Nothing to watch once it is stamped, and an observer per station left
    // running for the whole visit is six observers doing nothing.
    if (!node || done || typeof IntersectionObserver === 'undefined') return undefined;

    /*
     * `resetSeq` is a dependency so that every station rebuilds its observer
     * when the passport is cleared — including the stations that were not
     * stamped, whose `done` did not change. A fresh observer delivers a first
     * callback describing where its sentinel is *now*, which is what the
     * arming below needs.
     *
     * Disarmed on a reset, armed on the first mount. An observer always
     * reports an element already on screen as intersecting the moment it
     * starts watching, so without this, pressing Reset in the sticky strip
     * while reading station 4 would stamp station 4 again before the reader's
     * thumb was off the button — and the passport would look broken. Leaving
     * the screen is what arms it; a deep link from a printed QR code still
     * stamps on arrival, because that is a first mount.
     */
    armed.current = resetSeq === 0;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            armed.current = true;
          } else if (armed.current) {
            stamp(station);
          }
        }
      },
      { rootMargin: '0px 0px -20% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [station, stamp, done, resetSeq]);

  return (
    <div className="tour-stampline" ref={sentinel}>
      <button
        type="button"
        className={`tour-stampline__button${done ? ' is-done' : ''}`}
        onClick={() => passport.stamp(station)}
        disabled={done}
      >
        <span className="tour-stampline__tick" aria-hidden="true">
          ✓
        </span>
        {done ? 'Stamped' : 'Stamp this station'}
      </button>
    </div>
  );
}

/**
 * What a full passport is worth.
 *
 * Rendered only once all six are collected, at the very foot of the page. The
 * dessert stall wants to see a screen, so this has to be the loudest thing on
 * it and it has to say which church and which offer without the visitor
 * scrolling.
 */
export function Reward({ passport }: { passport: Passport }) {
  if (!passport.complete) return null;

  return (
    <div className="tour-reward" role="status">
      <p className="tour-reward__eyebrow">All six stations</p>
      <p className="tour-reward__headline">$2 off any dessert</p>
      <p className="tour-reward__body">
        Show this screen at the dessert table. One per passport, please.
      </p>
      <button
        type="button"
        className="button button--ghost button--small tour-reward__reset"
        onClick={passport.reset}
      >
        Clear my passport
      </button>
    </div>
  );
}

/* ── Your name in Coptic ─────────────────────────────────────────────────── */

/**
 * Type a name, get it in Coptic letters.
 *
 * The in-person version of this is a servant writing on a passport card, and
 * the thing that makes it work is that it is *yours* — a child watches their
 * own name appear in an alphabet they have never seen. So it is an input and a
 * live result, not a picker of pre-written names.
 *
 * The disclaimer under it is not boilerplate and should not be trimmed. This
 * spells the sounds of a name; it does not translate it, and it is not how the
 * Church writes the name of the saint a person may be named after. Saying so is
 * the difference between an activity and a small false claim published by a
 * church about its own liturgical language. See `transliterate`.
 */
export function CopticName() {
  const [name, setName] = useState('');
  const written = useMemo(() => transliterate(name.trim()), [name]);

  return (
    <div className="tour-name">
      <label className="tour-name__label" htmlFor="tour-name-input">
        Your name
      </label>
      <input
        id="tour-name-input"
        className="tour-name__input"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Type a name"
        autoComplete="off"
        // Off, all four. This is a proper noun being spelled letter by letter,
        // and a phone that helpfully capitalises or corrects it changes the
        // thing the reader is watching being transliterated.
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={40}
      />

      <output className="tour-name__out" htmlFor="tour-name-input">
        {written ? (
          <span className="tour-name__coptic" lang="cop">
            {written}
          </span>
        ) : (
          <span className="tour-name__empty">ⲡⲉⲕⲣⲁⲛ</span>
        )}
      </output>

      <p className="note tour-name__note">
        Letter for letter, by sound. This spells your name in the Coptic
        alphabet — it does not translate it, and it is not necessarily how the
        Church writes the name of a saint you may share it with.
      </p>
    </div>
  );
}

/* ── The Coptic year ─────────────────────────────────────────────────────── */

/**
 * The thirteen months, grouped into the three seasons of the Nile.
 *
 * A table of thirteen names means nothing to a visitor. The shape is the point
 * — that this is a farmer's calendar, that the year starts when the river
 * rises, and that the odd little month at the end is where the leftover days
 * went — so the seasons are the control and the months are what they contain.
 */
export function CopticYear() {
  const [openId, setOpenId] = useState(COPTIC_SEASONS[0]?.id);
  const open = COPTIC_SEASONS.find((season) => season.id === openId) ?? COPTIC_SEASONS[0];
  if (!open) return null;

  return (
    <div className="tour-year">
      <div className="tour-year__seasons" role="tablist" aria-label="Seasons of the Coptic year">
        {COPTIC_SEASONS.map((season) => (
          <button
            key={season.id}
            type="button"
            role="tab"
            aria-selected={season.id === open.id}
            tabIndex={season.id === open.id ? 0 : -1}
            className={`tour-year__season${season.id === open.id ? ' is-open' : ''}`}
            onClick={() => setOpenId(season.id)}
          >
            <span className="tour-year__season-name">{season.name}</span>
            <span className="tour-year__season-gloss">{season.gloss}</span>
          </button>
        ))}
      </div>

      <div className="tour-year__panel" role="tabpanel">
        <ol className="tour-year__months">
          {open.months.map((month) => (
            <li key={month} className="tour-year__month">
              {month}
            </li>
          ))}
        </ol>
        <p className="tour-year__note">{open.note}</p>
      </div>
    </div>
  );
}

/* ── The hymn ────────────────────────────────────────────────────────────── */

/**
 * The Paschal praise, side by side.
 *
 * Three columns when the Coptic is supplied and two when it is not — see
 * `PASCHAL_PRAISE`, where the Coptic column is deliberately unfilled. The
 * component decides from the data rather than from a flag, so filling it in is
 * one edit in one file.
 *
 * Not a `<table>`. It is three parallel readings of the same three lines, which
 * a table would announce as a grid of cells with no headers worth reading out
 * ("column 2, row 3"). Stacked blocks say what they are.
 */
export function HymnTable() {
  const hasCoptic = PASCHAL_PRAISE.some((line) => line.coptic);

  return (
    <div className={`tour-hymn${hasCoptic ? ' tour-hymn--three' : ''}`}>
      {PASCHAL_PRAISE.map((line) => (
        <div className="tour-hymn__line" key={line.transliteration}>
          {hasCoptic ? (
            <p className="tour-hymn__coptic" lang="cop">
              {line.coptic}
            </p>
          ) : null}
          <p className="tour-hymn__translit" lang="cop-Latn">
            {line.transliteration}
          </p>
          <p className="tour-hymn__english">{line.english}</p>
        </div>
      ))}
    </div>
  );
}
