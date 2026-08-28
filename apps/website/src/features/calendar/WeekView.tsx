'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { kindOf, type CalendarOccurrence } from '@spsm/shared';
import { Entry } from './Entry';
import { dayParts, type ViewRange } from './range';

/**
 * This week, as a wheel you turn through the days.
 *
 * ---------------------------------------------------------------------------
 * Every slot is the same height, and that height is the busiest day's.
 *
 * The uniformity is what makes the wheel work at all: the centred day renders
 * its full schedule and the others collapse to a line, so if slots sized
 * themselves to their own contents then centring a day would grow it, which
 * moves everything below it, which changes what is centred. The wheel hunts and
 * never settles.
 *
 * The first version got uniformity by fixing the height to a guess — and the
 * guess was too small, so a Saturday with six services had two of them cut off
 * with nothing to say so. **`grid-auto-rows: 1fr` on an auto-height track**
 * gets uniformity the honest way instead: flexible rows in a grid whose own
 * height is indefinite all settle at the largest row's max-content size. Every
 * slot is therefore exactly as tall as the fullest day in the week, and nothing
 * is ever clipped. No measuring, no estimate of what an entry costs in pixels.
 *
 * The one thing JavaScript still reads is that resulting height, so the
 * *viewport* around the wheel can be one slot plus two peeks. Reading it cannot
 * loop: the track is auto-height and its rows are sized by their content, so
 * changing the scroller's height does not change theirs.
 *
 * The remaining cap is `max-height` on the entry list — a day with twenty
 * things on it would otherwise make every slot twenty things tall. Past that
 * the centred list scrolls, which on real data never happens.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * Not seven columns, and not a time grid. Both were the obvious answers.
 *
 * A time grid — hours down the side, days across, events as blocks — is what a
 * calendar application looks like, and it is wrong for this parish. Its whole
 * value is showing *when things overlap and how long they run*, which matters
 * for a diary of meetings and not at all here: the services are sequential,
 * they never collide, and the grid would spend nine tenths of its height
 * drawing the empty hours between Tasbeha and the next morning's Liturgy.
 *
 * Seven columns fails on the content. The parish's titles are "St. Maurice &
 * St. Verina Arabic Meeting" and "St Philopater & St Mina Online Bible Study" —
 * a seventh of a screen is two or three words per line.
 * ---------------------------------------------------------------------------
 */
export function WeekView({
  range,
  byDay,
  today,
  recentre,
  onOpen,
}: {
  range: ViewRange;
  byDay: Map<string, CalendarOccurrence[]>;
  today: string | null;
  /**
   * Bumped by the Today button to bring the wheel back to today.
   *
   * A counter rather than a boolean, because the interesting case is pressing
   * Today when the anchor is *already* this week — the reader has scrolled off
   * today and wants to come back. Nothing else about the props changes, so
   * there would be no edge for an effect to fire on.
   */
  recentre: number;
  onOpen: (occurrence: CalendarOccurrence, day: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLOListElement>(null);
  const [centred, setCentred] = useState(0);

  /** The index the wheel should open on: today, or this week's first day. */
  const opensOn = today === null ? 0 : Math.max(0, range.days.indexOf(today));

  /**
   * Which slot is under the middle of the wheel.
   *
   * Measured from the elements rather than divided out of the scroll offset by
   * a slot height. The arithmetic version is one line shorter and wrong the
   * moment the slot height changes — and it now changes with the *contents*,
   * not just the viewport, because the busiest day sets it.
   */
  const measure = useCallback(() => {
    const box = scroller.current;
    const slots = track.current ? ([...track.current.children] as HTMLElement[]) : [];
    if (!box || slots.length === 0) return;

    const middle = box.scrollTop + box.clientHeight / 2;

    let nearest = 0;
    let best = Infinity;
    slots.forEach((slot, index) => {
      const distance = Math.abs(slot.offsetTop + slot.offsetHeight / 2 - middle);
      if (distance < best) {
        best = distance;
        nearest = index;
      }
    });

    setCentred(nearest);
  }, []);

  /**
   * Publish the slot height the grid settled on, so the frame can size its
   * viewport and its selection band to match.
   *
   * Written to a custom property rather than held in state on purpose: it is
   * consumed only by CSS, and putting it in state would re-render all seven
   * days every time the window is dragged.
   */
  const syncSlotHeight = useCallback(() => {
    const first = track.current?.firstElementChild as HTMLElement | undefined;
    const frame = scroller.current?.parentElement;
    if (!first || !frame) return;
    frame.style.setProperty('--wheel-slot', `${first.offsetHeight}px`);
  }, []);

  /**
   * Open on today, and re-centre whenever the week changes.
   *
   * `useLayoutEffect` so the wheel is at the right day on the first paint —
   * with an effect it renders on Monday and jumps, which on a snapping
   * container also fires a scroll the reader did not ask for.
   *
   * Stepping to a week that does not contain today centres its first day, which
   * is the honest answer: there is no "today" to open on.
   */
  useLayoutEffect(() => {
    syncSlotHeight();

    const box = scroller.current;
    const slot = track.current?.children[opensOn] as HTMLElement | undefined;
    if (!box || !slot) return;

    /*
     * Assigning `scrollTop` rather than calling `scrollIntoView`, which walks
     * up the tree and scrolls every ancestor that can — so centring a day
     * inside this box would also scroll the *page* to bring the box into view,
     * on load, before the reader has touched anything.
     */
    box.scrollTo({
      top: slot.offsetTop + slot.offsetHeight / 2 - box.clientHeight / 2,
      behavior: 'instant',
    });
    setCentred(opensOn);
  }, [range, opensOn, recentre, syncSlotHeight]);

  // The slot height follows both the viewport and the week's busiest day, so a
  // resize can change it. Cheap enough to just re-read and re-measure.
  useEffect(() => {
    const first = track.current?.firstElementChild;
    if (!first || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      syncSlotHeight();
      measure();
    });
    observer.observe(first);
    return () => observer.disconnect();
  }, [measure, syncSlotHeight]);

  /** Turn the wheel to a day, from the pips. */
  const goTo = useCallback((index: number) => {
    const box = scroller.current;
    const slot = track.current?.children[index] as HTMLElement | undefined;
    if (!box || !slot) return;
    box.scrollTo({
      top: slot.offsetTop + slot.offsetHeight / 2 - box.clientHeight / 2,
      behavior: 'smooth',
    });
  }, []);

  return (
    <div className="sched-wheel-frame">
      <div className="sched-wheel" ref={scroller} onScroll={measure}>
        {/*
          An ordered list, because the order is the information — this is Monday
          through Sunday and not seven days in no particular sequence.

          `tabIndex={0}` because it is a scroll container: a region that scrolls
          has to be reachable and scrollable from the keyboard, and neither a
          `<div>` nor an `<ol>` is focusable on its own. Arrow keys then turn the
          wheel, which is what somebody would try.
        */}
        <ol
          ref={track}
          className="sched-wheel__track"
          tabIndex={0}
          role="group"
          aria-label={`Day by day, ${range.label}`}
        >
          {range.days.map((day, index) => {
            const entries = byDay.get(day) ?? [];
            const isCentred = index === centred;
            const distance = index - centred;

            return (
              <li
                key={day}
                className={[
                  'sched-wheel__slot',
                  isCentred ? 'is-centred' : '',
                  /*
                   * Which side of the centre a collapsed day is on, because its
                   * one line has to sit at the edge nearest the middle. Only a
                   * strip of a neighbour is ever on screen; centring the line
                   * inside its own slot puts it well into the part nobody can
                   * see, which is exactly how this first rendered.
                   */
                  !isCentred && distance < 0 ? 'is-above' : '',
                  !isCentred && distance > 0 ? 'is-below' : '',
                  day === today ? 'is-today' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                /*
                 * Signed distance for the tilt, unsigned for the scale and the
                 * fade. CSS has no `abs()` in any browser we can rely on yet,
                 * so both are handed over rather than derived from one.
                 */
                style={
                  {
                    '--wheel-offset': distance,
                    '--wheel-depth': Math.min(Math.abs(distance), 3),
                  } as React.CSSProperties
                }
                /*
                 * The days that are not centred are hidden from assistive
                 * technology, because their *collapsed* form is what is
                 * rendered and it says less than the full one. A screen reader
                 * user turns the wheel like anybody else and hears each day in
                 * full as it arrives.
                 */
                aria-hidden={isCentred ? undefined : true}
              >
                {/*
                  Both forms are always rendered, stacked in the same grid cell,
                  and CSS shows one of them.
                  
                  Rendering only the centred one looked obviously right and was
                  wrong: rows size themselves to their contents, so a slot was
                  only ever as tall as *whatever was in it at the time*. Turning
                  the wheel swapped a full card for a one-line peek, every row
                  resized, and the viewport that had been measured around the
                  old height no longer matched — the selection band drifted off
                  the card by sixty pixels.
                  
                  With the card always in flow, every row's content is its own
                  full day whichever one is centred, so `grid-auto-rows: 1fr`
                  settles on the busiest day in the week and stays there. The
                  peek is overlaid, not substituted; the hidden card keeps its
                  space with `visibility`, which is exactly the difference
                  between that and `display: none`.
                */}
                <FullDay
                  day={day}
                  entries={entries}
                  isToday={day === today}
                  onOpen={onOpen}
                />
                <CollapsedDay day={day} entries={entries} isToday={day === today} />
              </li>
            );
          })}
        </ol>
      </div>

      <Pips days={range.days} centred={centred} today={today} byDay={byDay} onPick={goTo} />
    </div>
  );
}

/**
 * The seven pips down the side.
 *
 * ---------------------------------------------------------------------------
 * What they are for, in order of how much it matters.
 *
 * **Saying the thing scrolls.** The wheel is a box of days with no scrollbar —
 * the bar is hidden, because a scrollbar down the side of a picker is not a
 * thing — and without some other mark it is not obvious that six more days are
 * in there. A column of pips is the iOS convention for exactly this.
 *
 * **Saying where you are in the week.** The pip for the centred day is the
 * largest and the rest shrink with distance, so the wheel's position reads at a
 * glance rather than having to be inferred from the date.
 *
 * They are also buttons, which costs nothing and turns the indicator into a way
 * of jumping straight to Saturday.
 * ---------------------------------------------------------------------------
 */
function Pips({
  days,
  centred,
  today,
  byDay,
  onPick,
}: {
  days: string[];
  centred: number;
  today: string | null;
  byDay: Map<string, CalendarOccurrence[]>;
  onPick: (index: number) => void;
}) {
  return (
    <nav className="sched-pips" aria-label="Jump to a day">
      {days.map((day, index) => {
        const parts = dayParts(day);
        const count = (byDay.get(day) ?? []).length;

        return (
          <button
            key={day}
            type="button"
            className={[
              'sched-pips__pip',
              index === centred ? 'is-centred' : '',
              day === today ? 'is-today' : '',
              count === 0 ? 'is-quiet' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ '--pip-depth': Math.min(Math.abs(index - centred), 3) } as React.CSSProperties}
            /*
             * `aria-current` rather than `aria-pressed`: this marks which of a
             * set is the one you are on, which is what "current" means. A
             * pressed toggle would imply the other six are un-pressed states of
             * the same control.
             */
            aria-current={index === centred ? 'true' : undefined}
            aria-label={`${parts.weekday} ${parts.month} ${parts.dayOfMonth}, ${
              count === 0 ? 'nothing scheduled' : `${count} scheduled`
            }`}
            onClick={() => onPick(index)}
          />
        );
      })}
    </nav>
  );
}

/** The centred day, with its schedule. */
function FullDay({
  day,
  entries,
  isToday,
  onOpen,
}: {
  day: string;
  entries: CalendarOccurrence[];
  isToday: boolean;
  onOpen: (occurrence: CalendarOccurrence, day: string) => void;
}) {
  const parts = dayParts(day);

  return (
    <div className="sched-wheel__card">
      <div className="sched-wheel__head">
        <h3 className="sched-wheel__weekday">
          {parts.weekday}
          {isToday && <span className="sched-wheel__badge">Today</span>}
        </h3>
        <p className="sched-wheel__date">
          <span className="sched-wheel__month">{parts.month}</span>
          <span className="sched-wheel__num">{parts.dayOfMonth}</span>
        </p>
      </div>

      {entries.length === 0 ? (
        /*
         * Said plainly rather than left blank. An empty day and a day whose
         * entries failed to load look identical if the answer is white space,
         * and the reader's question — "is anything on Wednesday?" — deserves a
         * sentence rather than an inference.
         */
        <p className="sched-wheel__none">Nothing scheduled</p>
      ) : (
        <ul className="sched-wheel__list">
          {entries.map((occurrence) => (
            <li key={`${occurrence.source}:${occurrence.id}`}>
              <Entry occurrence={occurrence} day={day} onOpen={() => onOpen(occurrence, day)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A day above or below the centre: its date, and how busy it is.
 *
 * It used to name the first event and count the rest — "Mon 24 · Arabic Tasbeha
 * and 3 more" — which read well and was the wrong thing above and below the day
 * you are actually reading. Two event titles in the corner of your eye compete
 * with the five in the middle, and the neighbours are a *position* indicator,
 * not a second schedule.
 *
 * The dots stay. They are not names: they say how full the day is and roughly
 * what of, in the same language the month grid uses, at no cost in width.
 */
function CollapsedDay({
  day,
  entries,
  isToday,
}: {
  day: string;
  entries: CalendarOccurrence[];
  isToday: boolean;
}) {
  const parts = dayParts(day);

  return (
    <p className="sched-wheel__peek">
      <span className={isToday ? 'sched-wheel__peek-day is-today' : 'sched-wheel__peek-day'}>
        {parts.weekdayShort} {parts.dayOfMonth}
      </span>
      {/*
        Today is marked on a collapsed day too, not only on the centred card.
        Without it, a wheel that has been scrolled a day or two away gives no
        sign of where today went — and the day in the middle reads as today
        because that is where today was when the page opened.
      */}
      {isToday && <span className="sched-wheel__peek-today">Today</span>}

      {entries.length > 0 ? (
        <span className="sched-wheel__peek-dots" aria-hidden="true">
          {entries.map((occurrence) => (
            <span
              key={`${occurrence.source}:${occurrence.id}`}
              className={`sched-wheel__dot sched-wheel__dot--${kindOf(occurrence)}`}
            />
          ))}
        </span>
      ) : (
        <span className="sched-wheel__peek-more">Nothing scheduled</span>
      )}
    </p>
  );
}
