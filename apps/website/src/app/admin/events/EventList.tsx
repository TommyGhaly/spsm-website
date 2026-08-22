'use client';

/**
 * The list of events, down the left.
 *
 * The old one was every event the parish has ever held, newest first, in a box
 * that scrolled — so finding next month's festival meant reading past last
 * year's, and the only thing distinguishing a draft from a published event was a
 * badge on every single row saying PUBLISHED.
 *
 * Three changes, in order of how much they matter:
 *
 *  1. **Upcoming first, and by default only upcoming.** That is what somebody
 *     opening this screen has come to change. Past events are a tab, not a wall.
 *  2. **A search box**, because a parish with four years of events has a few
 *     hundred of them and no amount of grouping beats typing "camp".
 *  3. **Grouped by month, with the month named.** A date on every row is data;
 *     a heading over a run of rows is a shape.
 *
 * The badge is gone from published rows and kept on drafts. Published is the
 * normal state — marking it marks everything, which marks nothing.
 */

import { useMemo, useState } from 'react';
import { toDate, type DocOf, type Event } from '@spsm/shared';
import { PARISH_TIME_ZONE, dayKey, formatMonth, formatTime } from '@/lib/dates';
import { Icon } from '@/components/Icon';

type Scope = 'upcoming' | 'past' | 'drafts' | 'all';

const SCOPES: { id: Scope; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'all', label: 'All' },
];

/**
 * Whether an event is still to come.
 *
 * Measured from its *end* where it has one, so a three-day festival stays under
 * Upcoming on its middle day rather than dropping into Past the moment it starts.
 */
function isUpcoming(event: DocOf<Event>, now: number): boolean {
  const end = toDate(event.endAt) ?? toDate(event.startAt);
  return end === null || end.getTime() >= now;
}

function inScope(event: DocOf<Event>, scope: Scope, now: number): boolean {
  if (scope === 'all') return true;
  if (scope === 'drafts') return !event.published;
  return scope === 'upcoming' ? isUpcoming(event, now) : !isUpcoming(event, now);
}

function matches(event: DocOf<Event>, needle: string): boolean {
  if (!needle) return true;
  const haystack = [
    event.title,
    event.summary,
    event.location?.name ?? '',
    event.category,
    ...event.tags,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

/** `SEP` / `30` for the date block on a row. */
function dayParts(event: DocOf<Event>): { month: string; day: string } {
  const date = toDate(event.startAt);
  const zone = event.timeZone || PARISH_TIME_ZONE;
  if (!date) return { month: '—', day: '' };
  return {
    month: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: zone })
      .format(date)
      .toUpperCase(),
    day: new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: zone }).format(date),
  };
}

/** The short form of when — "9:00 AM – 4:00 PM", "All day", "7:00 PM". */
function clockLine(event: DocOf<Event>): string {
  const zone = event.timeZone || PARISH_TIME_ZONE;
  if (event.allDay) return 'All day';

  const start = formatTime(event.startAt, zone);
  if (!event.endAt) return start;

  // A span crossing midnight prints the day it ends on, or "9:00 AM – 4:00 PM"
  // on a five-day camp reads as a nine-to-five.
  const sameDay = dayKey(event.startAt, zone) === dayKey(event.endAt, zone);
  if (sameDay) return `${start} – ${formatTime(event.endAt, zone)}`;

  const endDay = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: zone,
  }).format(toDate(event.endAt) as Date);
  return `${start} – ${endDay}, ${formatTime(event.endAt, zone)}`;
}

export function EventList({
  events,
  selectedId,
  onPick,
  onNew,
  loadError,
}: {
  /** Null while loading — told apart from an empty parish, which is a sentence. */
  events: DocOf<Event>[] | null;
  selectedId: string | null;
  onPick: (event: DocOf<Event>) => void;
  onNew: () => void;
  loadError: string | null;
}) {
  const [scope, setScope] = useState<Scope>('upcoming');
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();

  /*
   * `now` is read once per render rather than per comparison. Two events either
   * side of the cutoff sorted against different clocks is the kind of bug that
   * happens once a year at midnight and is never reproduced.
   */
  const now = Date.now();

  const counts = useMemo(() => {
    const tally = { upcoming: 0, past: 0, drafts: 0, all: 0 };
    for (const event of events ?? []) {
      if (!matches(event, needle)) continue;
      tally.all += 1;
      if (!event.published) tally.drafts += 1;
      if (isUpcoming(event, now)) tally.upcoming += 1;
      else tally.past += 1;
    }
    return tally;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, needle]);

  /**
   * The rows, in the order the scope wants them.
   *
   * Upcoming counts forward — the next thing to happen is the thing being
   * edited. Everything else counts back, because a list of past events is an
   * archive and the most recent end of it is the useful one.
   */
  const rows = useMemo(() => {
    const kept = (events ?? []).filter(
      (event) => inScope(event, scope, now) && matches(event, needle),
    );
    const ascending = scope === 'upcoming';
    return kept.sort((a, b) => {
      const left = toDate(a.startAt)?.getTime() ?? 0;
      const right = toDate(b.startAt)?.getTime() ?? 0;
      return ascending ? left - right : right - left;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, scope, needle]);

  /** Rows broken into runs by month, keeping the order above. */
  const months = useMemo(() => {
    const groups: [string, DocOf<Event>[]][] = [];
    for (const event of rows) {
      const key = (dayKey(event.startAt, event.timeZone || PARISH_TIME_ZONE) ?? '').slice(0, 7);
      const last = groups[groups.length - 1];
      if (last && last[0] === key) last[1].push(event);
      else groups.push([key, [event]]);
    }
    return groups;
  }, [rows]);

  return (
    <div className="ev-list">
      <div className="ev-list__top">
        <h1>Events</h1>
        <button className="button" type="button" onClick={onNew}>
          <Icon name="plus" size={15} /> New event
        </button>
      </div>

      {loadError && (
        <div className="notice notice--alarm" role="alert">
          <h2>Could not load the events</h2>
          <p>{loadError}</p>
        </div>
      )}

      <div className="ev-search">
        <Icon name="search" size={16} />
        <input
          type="search"
          value={search}
          placeholder="Search by name, place or tag"
          aria-label="Search events"
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button type="button" aria-label="Clear the search" onClick={() => setSearch('')}>
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      <div className="chips ev-list__scopes">
        {SCOPES.map((option) => (
          <button
            key={option.id}
            type="button"
            className={option.id === scope ? 'chip is-on' : 'chip'}
            aria-pressed={option.id === scope}
            onClick={() => setScope(option.id)}
          >
            {option.label}
            <span className="chip__count">{counts[option.id]}</span>
          </button>
        ))}
      </div>

      {events === null && !loadError && <p className="note">Loading…</p>}

      {events?.length === 0 && (
        <p className="note">
          Nothing on the calendar yet. Add the festival, the camp, the classes — not the
          weekly liturgies.
        </p>
      )}

      {/*
        The empty scope, which is worth more than "no results".

        Searching "camp" under Upcoming when every camp is in the past is the
        commonest way to conclude the search is broken. Rather than an empty box,
        say where the matches are and offer to go there.
      */}
      {events !== null && events.length > 0 && rows.length === 0 && (
        <p className="note">
          {needle ? (
            counts.all > 0 ? (
              <>
                Nothing in {SCOPES.find((s) => s.id === scope)?.label.toLowerCase()} matches
                “{search.trim()}”.{' '}
                <button type="button" className="ev-list__jump" onClick={() => setScope('all')}>
                  {counts.all} {counts.all === 1 ? 'match' : 'matches'} in all events
                </button>
              </>
            ) : (
              <>Nothing matches “{search.trim()}”.</>
            )
          ) : scope === 'upcoming' ? (
            'Nothing coming up. Past events are under Past.'
          ) : scope === 'drafts' ? (
            'No drafts — everything here is on the website.'
          ) : (
            'Nothing here.'
          )}
        </p>
      )}

      {/* The scroller is the months, not the whole rail — so the search box and
          the tabs stay put while a hundred events go past them. */}
      <div className="ev-list__months">
        {months.map(([key, group]) => (
          <div className="ev-list__month" key={key || 'undated'}>
            <h2>{key ? formatMonth(key) : 'No date set'}</h2>
            <ul>
              {group.map((event) => {
                const { month, day } = dayParts(event);
                return (
                  <li key={event.id}>
                    <button
                      type="button"
                      className={event.id === selectedId ? 'ev-row ev-row--on' : 'ev-row'}
                      aria-current={event.id === selectedId ? 'true' : undefined}
                      onClick={() => onPick(event)}
                    >
                      <span className="ev-row__date" aria-hidden="true">
                        <em>{month}</em>
                        <b>{day}</b>
                      </span>
                      <span className="ev-row__body">
                        <strong>{event.title || 'Untitled event'}</strong>
                        <span className="ev-row__meta">
                          {clockLine(event)}
                          {event.location?.name ? ` \u00b7 ${event.location.name}` : ''}
                        </span>
                      </span>
                      {!event.published && <span className="ev-row__draft">Draft</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
