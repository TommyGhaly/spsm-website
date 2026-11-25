'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { kindOf, type CalendarOccurrence } from '@spsm/shared';
import { Entry } from './Entry';
import { dayParts } from './range';

/**
 * How far the sheet has to be pulled down, in pixels, before letting go closes
 * it. A flick closes it sooner — see `FLICK`.
 */
const DISMISS_PULL = 96;
/** Downward speed, in px/ms, that closes the sheet however short the pull. */
const FLICK = 0.6;
/** Sideways travel, in pixels, that turns to the next or previous day. */
const SWIPE = 56;
/** Matches the leave animation in globals.css (`sched-daysheet-out`). */
const LEAVE_MS = 200;

/**
 * One day of the month, as a sheet that rises from the foot of a phone.
 *
 * ---------------------------------------------------------------------------
 * Why a sheet, and not the panel under the grid it replaces.
 *
 * The panel was rendered after the table, which on a phone is a screen and a
 * half further down. Tapping the 12th changed nothing you could see: the ring
 * went on the cell and the answer appeared somewhere below the fold, so every
 * tap was followed by a scroll down to read it and a scroll back up to pick the
 * next day. The question was asked with the thumb and answered out of reach.
 *
 * The sheet answers where the thumb already is. It comes up over the lower
 * part of the screen, the grid stays dimly visible above it, and nothing on
 * the page moves.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * Moving between days without putting it away.
 *
 * The usual next question after "what is on Saturday" is "and Sunday?" — so the
 * sheet carries the picked day's week as a strip of seven dates along its top,
 * and the list itself can be swiped sideways a day at a time. Both run across
 * the whole padded month the grid is drawing, so swiping past Sunday turns to
 * the next week's Monday and the strip follows.
 *
 * Pulling the handle down, tapping the dimmed grid, Escape and the × all close
 * it. The pull is the one a phone user tries first; the × is the one anybody
 * finds.
 * ---------------------------------------------------------------------------
 *
 * A native modal `<dialog>`, for the same reasons `EventDialog` gives: focus
 * moves in and comes back, the page behind goes inert, and the top layer is
 * above the wheel's 3D transform without any z-index arithmetic. Opening an
 * entry stacks the event dialog on top of this one, and closing that returns
 * here rather than to the grid.
 */
export function DaySheet({
  days,
  day,
  byDay,
  today,
  onPick,
  onShut,
  onOpen,
}: {
  /** Every day the grid is drawing, padded to whole weeks. */
  days: string[];
  day: string;
  byDay: Map<string, CalendarOccurrence[]>;
  today: string | null;
  onPick: (day: string) => void;
  onShut: () => void;
  onOpen: (occurrence: CalendarOccurrence, day: string) => void;
}) {
  const sheet = useRef<HTMLDialogElement>(null);
  const [leaving, setLeaving] = useState(false);
  /**
   * Which way the last change of day went, so the new day can slide in from
   * the side the reader swiped towards. `null` on open, which rises instead.
   */
  const [came, setCame] = useState<'next' | 'prev' | null>(null);

  useEffect(() => {
    const element = sheet.current;
    if (element && !element.open) element.showModal();
  }, []);

  /**
   * Put the sheet away: play the leave animation, then close for real.
   *
   * A timer rather than `animationend`, because the reduced-motion rules swap
   * the slide for a fade and a browser is entitled to skip either — waiting on
   * an event that never comes would leave a sheet that cannot be closed.
   */
  const dismiss = useCallback(() => {
    setLeaving(true);
    window.setTimeout(() => sheet.current?.close(), LEAVE_MS);
  }, []);

  const index = days.indexOf(day);
  const weekStart = Math.max(0, Math.floor(index / 7) * 7);
  const week = days.slice(weekStart, weekStart + 7);
  const monthKey = (days[Math.floor(days.length / 2)] ?? '').slice(0, 7);

  const turn = useCallback(
    (by: 1 | -1) => {
      const next = days[index + by];
      if (!next) return;
      setCame(by === 1 ? 'next' : 'prev');
      onPick(next);
    },
    [days, index, onPick],
  );

  /* ---- pulling the sheet down -------------------------------------------- */

  const pull = useRef<{ y: number; at: number; id: number } | null>(null);

  const onPullStart = (event: React.PointerEvent<HTMLElement>) => {
    // Only the primary button of a mouse; any finger.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // A tap on the × or a date in the strip is a tap, not the start of a drag.
    if ((event.target as HTMLElement).closest('button')) return;
    pull.current = { y: event.clientY, at: event.timeStamp, id: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    sheet.current?.classList.add('is-dragging');
  };

  const onPullMove = (event: React.PointerEvent<HTMLElement>) => {
    const start = pull.current;
    if (!start || start.id !== event.pointerId || !sheet.current) return;
    // Downward only. Pulled up, it resists rather than following.
    const dy = event.clientY - start.y;
    const offset = dy > 0 ? dy : dy / 6;
    sheet.current.style.transform = `translateY(${offset}px)`;
  };

  const onPullEnd = (event: React.PointerEvent<HTMLElement>) => {
    const start = pull.current;
    if (!start || start.id !== event.pointerId || !sheet.current) return;
    pull.current = null;

    const dy = event.clientY - start.y;
    const speed = dy / Math.max(1, event.timeStamp - start.at);
    sheet.current.classList.remove('is-dragging');

    if (dy > DISMISS_PULL || (dy > 24 && speed > FLICK)) {
      /*
       * Carried on from where the finger let go rather than snapped back and
       * replayed: the leave animation starts from the inline offset, because
       * the keyframe has no `from` and so begins at the current transform.
       */
      dismiss();
    } else {
      sheet.current.style.transform = '';
    }
  };

  /* ---- swiping between days ---------------------------------------------- */

  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);

  const onSwipeStart = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse') return;
    swipe.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
  };

  const onSwipeEnd = (event: React.PointerEvent<HTMLElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || start.id !== event.pointerId) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // Clearly sideways, so a slightly diagonal scroll of the list never turns
    // the day out from under the reader.
    if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    turn(dx < 0 ? 1 : -1);
  };

  const parts = dayParts(day);
  const entries = byDay.get(day) ?? [];

  return (
    /*
     * `onCancel` is Escape. It is intercepted only so Escape gets the same
     * animation as every other way out; the close itself still happens.
     *
     * A click whose target is the dialog element itself is the backdrop —
     * the panel fills the dialog's box, so nothing else can be.
     */
    <dialog
      ref={sheet}
      className={leaving ? 'sched-daysheet is-leaving' : 'sched-daysheet'}
      aria-labelledby="sched-daysheet-title"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClose={onShut}
      onClick={(event) => {
        if (event.target === sheet.current) dismiss();
      }}
    >
      <div
        className="sched-daysheet__top"
        onPointerDown={onPullStart}
        onPointerMove={onPullMove}
        onPointerUp={onPullEnd}
        onPointerCancel={onPullEnd}
      >
        <span className="sched-daysheet__handle" aria-hidden="true" />

        <div className="sched-daysheet__head">
          <h2 className="sched-daysheet__title" id="sched-daysheet-title">
            <span className="sched-daysheet__weekday">{parts.weekday}</span>
            <span className="sched-daysheet__date">
              {parts.month} {parts.dayOfMonth}
            </span>
            {day === today && <span className="sched-daysheet__badge">Today</span>}
          </h2>

          <button type="button" className="sched-daysheet__shut" onClick={dismiss} aria-label="Close">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/*
          The week the day is in. Dots and not counts: it is a way of choosing
          the next day to look at, and the list below is where the detail is.
        */}
        <nav className="sched-daysheet__week" aria-label="Choose a day">
          {week.map((each) => {
            const eachParts = dayParts(each);
            const eachEntries = byDay.get(each) ?? [];
            const isPicked = each === day;

            return (
              <button
                key={each}
                type="button"
                className={[
                  'sched-daysheet__day',
                  isPicked ? 'is-picked' : '',
                  each === today ? 'is-today' : '',
                  each.slice(0, 7) === monthKey ? '' : 'is-outside',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-current={isPicked ? 'date' : undefined}
                aria-label={`${eachParts.weekday} ${eachParts.month} ${eachParts.dayOfMonth}, ${
                  eachEntries.length === 0 ? 'nothing scheduled' : `${eachEntries.length} scheduled`
                }`}
                onClick={() => {
                  if (isPicked) return;
                  setCame(each > day ? 'next' : 'prev');
                  onPick(each);
                }}
              >
                <span className="sched-daysheet__day-name" aria-hidden="true">
                  {eachParts.weekdayShort.slice(0, 1)}
                </span>
                <span className="sched-daysheet__day-num" aria-hidden="true">
                  {eachParts.dayOfMonth}
                </span>
                {/*
                  At most three, and that is a hint rather than a cap on what
                  the day holds — the list below shows everything. Three dots
                  is as many as fit under a single digit without the strip
                  turning into the month grid's wall of colour.
                */}
                <span className="sched-daysheet__day-dots" aria-hidden="true">
                  {eachEntries.slice(0, 3).map((occurrence) => (
                    <span
                      key={`${occurrence.source}:${occurrence.id}`}
                      className={`sched-month__dot sched-month__dot--${kindOf(occurrence)}`}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      <div
        className="sched-daysheet__body"
        onPointerDown={onSwipeStart}
        onPointerUp={onSwipeEnd}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        {/* Keyed by day so each change replays the slide, from the side the
            reader moved towards. */}
        <div
          key={day}
          className={came ? `sched-daysheet__page is-from-${came}` : 'sched-daysheet__page'}
          aria-live="polite"
        >
          {entries.length === 0 ? (
            <p className="sched-daysheet__none">Nothing scheduled</p>
          ) : (
            <ul className="sched-daysheet__list">
              {entries.map((occurrence) => (
                <li key={`${occurrence.source}:${occurrence.id}`}>
                  <Entry occurrence={occurrence} day={day} onOpen={() => onOpen(occurrence, day)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </dialog>
  );
}
