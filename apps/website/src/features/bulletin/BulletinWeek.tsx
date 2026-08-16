import type { Bulletin, BulletinEvent } from '@spsm/shared';
import { Icon } from '@/components/Icon';
import { PARISH_TIME_ZONE } from '@/lib/dates';

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
 */
export function BulletinWeek({ bulletin }: { bulletin: Bulletin }) {
  const daysWithEvents = bulletin.days.filter((day) => day.events.length > 0);
  const today = todayInParish();

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
          {bulletin.announcements.map((item) => (
            <li key={item.sourceId} className="card">
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
      )}

      {/* Multi-day entries — a festival, a retreat — are pulled out of the daily
          list by the parser because repeating them under five consecutive days
          is how the paper sheet reads, not how a screen should. */}
      {bulletin.multiDayEvents.length > 0 && (
        <ul className="grid reveal-stagger" style={{ marginBottom: 'var(--space-lg)' }}>
          {bulletin.multiDayEvents.map((event) => (
            <li key={event.sourceId} className="card">
              <p className="meta">{formatDateRange(event.startDate, event.endDate)}</p>
              <h3>{event.name}</h3>
              {describeTime(event) && <p>{describeTime(event)}</p>}
              {event.notes && <p>{event.notes}</p>}
            </li>
          ))}
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
                  {day.events.map((event) => (
                    <li key={event.sourceId}>
                      <span className="week__time">
                        {describeTime(event) || <Icon name="clock" size={15} />}
                      </span>
                      <span>{event.name}</span>
                      {event.notes && <em>{event.notes}</em>}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </>
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

/**
 * Today's date in the parish's own zone, as `YYYY-MM-DD`.
 *
 * **Evaluated at build time**, because this is a static export — so "today" is
 * the day the site was built, not the day it is read. That is accurate for a
 * site rebuilt on publish and drifts otherwise, which is why it only ever adds a
 * highlight: a missing "Today" marker is a non-event, whereas hiding past days
 * based on a stale date would silently empty the schedule.
 */
function todayInParish(): string {
  // `en-CA` gives ISO order (YYYY-MM-DD) directly, avoiding a manual reassembly
  // of the parts.
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: PARISH_TIME_ZONE,
  }).format(new Date());
}
