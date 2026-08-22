'use client';

import type { Bulletin, BulletinEvent } from '@spsm/shared';
import { Icon } from '@/components/Icon';
import { bulletinImageUrl } from './media';

/**
 * This week's bulletin, as mirrored from the announcements project.
 *
 * Times are printed exactly as the parish typed them ("7:30am"). They are not
 * parsed — see the note on `BulletinEvent`. That means no reformatting and no
 * timezone conversion, which is the point: whatever the bulletin says is what
 * the sheet in the narthex says.
 *
 * **Dates are different, and the distinction matters.** A `time` is free text a
 * human wrote; a `date` is a machine-generated `YYYY-MM-DD` from the source app.
 * The old markup printed those verbatim, so the page showed "2026-08-17" beside
 * "Monday" and "2026-08-17 – 2026-08-21" on multi-day entries. That is a
 * developer's format on a parishioner's page, so dates — and only dates — are
 * formatted here.
 *
 * `today` is a prop, not a clock read. See `todayInParish` for why the caller
 * has to supply it.
 */
export function BulletinWeek({ bulletin, today }: { bulletin: Bulletin; today: string }) {
  const daysWithEvents = bulletin.days.filter((day) => day.events.length > 0);

  return (
    <>
      {bulletin.headerNotes.length > 0 && (
        <div className="prose" style={{ marginBottom: 'var(--space-lg)' }}>
          {bulletin.headerNotes.map((note, i) => (
            <p key={i}>{note}</p>
          ))}
        </div>
      )}

      {bulletin.announcements.length > 0 && (
        <ul className="grid reveal-stagger" style={{ marginBottom: 'var(--space-lg)' }}>
          {bulletin.announcements.map((item) => {
            const image = bulletinImageUrl(item.image);
            return (
              <li key={item.sourceId} className={image ? 'card card--aside' : 'card'}>
                {image && <Media url={image} className="card__thumb" />}
                <div className="card__text">
                  <p>{item.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Multi-day entries — a festival, a retreat — are pulled out of the daily
          list by the parser because repeating them under five consecutive days
          is how the paper sheet reads, not how a screen should.

          `.week-multi` rather than the site's `.grid`, so however many there
          are, together they span exactly the width of a day card below. */}
      {bulletin.multiDayEvents.length > 0 && (
        <ul className="week-multi reveal-stagger" style={{ marginBottom: 'var(--space-lg)' }}>
          {bulletin.multiDayEvents.map((event) => {
            const image = bulletinImageUrl(event.image);
            return (
              <li key={event.sourceId} className={image ? 'card card--aside' : 'card'}>
                {/* A thumbnail beside the text, not a banner above it. As a
                    16:9 header this was the largest thing in the section and
                    it dwarfed the week it was introducing. */}
                {image && <Media url={image} className="card__thumb" />}
                <div className="card__text">
                  <p className="meta">{formatDateRange(event.startDate, event.endDate)}</p>
                  <h3>{event.name}</h3>
                  {describeTime(event) && <p>{describeTime(event)}</p>}
                  {event.notes && <p>{event.notes}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* The days stagger in as the week scrolls past — the one list on the
          homepage long enough for a cascade to read as a cascade rather than as
          three cards arriving at once. */}
      {daysWithEvents.length > 0 && (
        <ul className="week reveal-stagger">
          {daysWithEvents.map((day) => {
            const isToday = day.date === today;
            return (
              <li
                key={day.date}
                className={isToday ? 'week__day week__day--today' : 'week__day'}
              >
                <h3>
                  {day.day}
                  {/* `dateTime` keeps the machine-readable form for anything
                      parsing the page; the visible text is for a reader. */}
                  <time dateTime={day.date}>{formatDayDate(day.date)}</time>
                  {isToday && <span className="week__today-flag">Today</span>}
                </h3>
                <ul>
                  {day.events.map((event) => {
                    const image = bulletinImageUrl(event.image);
                    return (
                      <li key={event.sourceId}>
                        {/*
                          The picture the parish already attached to this
                          service, where there is one.

                          About a third of a week has none — Hymns Class, Sunday
                          School, Servants Meeting — and those rows get an empty
                          cell rather than a placeholder. The column is reserved
                          for the whole week either way, which is what keeps the
                          times aligned down every card; a gap reads as "no
                          picture for this one", whereas a stand-in mark would
                          read as one that failed to load.
                        */}
                        <Media url={image} className="week__thumb" />

                        <span className="week__time">
                          {describeTime(event) || <Icon name="clock" size={15} />}
                        </span>
                        <span className="week__name">{event.name}</span>
                        {event.notes && <em>{event.notes}</em>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/**
 * An event's picture, as a background rather than an `<img>`.
 *
 * ---------------------------------------------------------------------------
 * This is the one deliberate choice in this file, so: **these images are
 * hotlinked from a Firebase Storage bucket in another project, with a download
 * token in the query string.** That follows the same rule as the bulletin text
 * itself — read through, never mirrored — but it means the parish can rotate a
 * token, delete an image, or re-upload it under a new name at any time, and
 * this page would not know until a reader saw it.
 *
 * A broken `<img>` renders a torn-page icon and its alt text. A broken
 * background renders as the element's own background — here, nothing at all,
 * which is exactly what a service with no picture already looks like. For
 * decorative thumbnails on a cross-project hotlink, failing to a blank space is
 * the better failure: the row is still complete without it.
 *
 * Nothing is lost accessibly by not being an `<img>`: the service's name is
 * beside it in text, so an `alt` could only repeat it.
 * ---------------------------------------------------------------------------
 *
 * Renders the element even with no URL, so the grid column it occupies stays
 * reserved and the times line up down a day whose services are a mix.
 */
function Media({ url, className }: { url: string | null; className: string }) {
  return (
    <span
      className={url ? `${className} ${className}--filled` : className}
      aria-hidden="true"
      style={url ? { backgroundImage: `url("${url}")` } : undefined}
    />
  );
}

function describeTime(event: BulletinEvent): string {
  if (event.time && event.timeTo) return `${event.time} – ${event.timeTo}`;
  return event.time ?? event.timeTo ?? '';
}

/**
 * `2026-08-17` → `Aug 17`.
 *
 * The day name is already printed beside this, so repeating the weekday would
 * say "Monday Monday, August 17". Short month, because this is a caption under a
 * heading rather than the heading itself.
 */
function formatDayDate(date: string): string {
  const parsed = parseIsoDate(date);
  if (!parsed) return date;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

/**
 * `2026-08-17`, `2026-08-21` → `August 17 – 21`, collapsing what is shared.
 *
 * Repeating the month — "August 17 – August 21" — is the kind of thing that
 * reads as a template nobody finished.
 */
function formatDateRange(startDate: string, endDate: string): string {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end) return [startDate, endDate].filter(Boolean).join(' – ');

  const monthDay = (date: Date) =>
    new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(
      date,
    );

  if (start.getTime() === end.getTime()) return monthDay(start);

  const sameMonth = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();
  return sameMonth
    ? `${monthDay(start)} – ${end.getUTCDate()}`
    : `${monthDay(start)} – ${monthDay(end)}`;
}

/**
 * Parses the bulletin's `YYYY-MM-DD` as a *calendar date*, at UTC midnight.
 *
 * The zone matters. `new Date('2026-08-17')` is already UTC midnight, but
 * formatting it in `America/New_York` prints August 16 — four hours earlier. So
 * every formatter above passes `timeZone: 'UTC'` to match. These strings carry
 * no time of day and must not acquire one.
 *
 * Returns null on anything unexpected rather than an Invalid Date, so callers
 * fall back to printing the original string. A bulletin with an odd date should
 * degrade to showing that odd date, not to "NaN".
 */
function parseIsoDate(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
