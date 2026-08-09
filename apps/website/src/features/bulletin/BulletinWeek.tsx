import type { Bulletin, BulletinEvent } from '@spsm/shared';

/**
 * This week's bulletin, as mirrored from the announcements project.
 *
 * Times are printed exactly as the parish typed them ("7:30am"). They are not
 * parsed — see the note on `BulletinEvent`. That means no reformatting and no
 * timezone conversion, which is the point: whatever the bulletin says is what
 * the sheet in the narthex says.
 */
export function BulletinWeek({ bulletin }: { bulletin: Bulletin }) {
  const daysWithEvents = bulletin.days.filter((day) => day.events.length > 0);

  return (
    <section aria-labelledby="bulletin-heading">
      <h2 id="bulletin-heading">This week &mdash; {bulletin.weekLabel}</h2>
      {bulletin.presetName && <p className="meta">{bulletin.presetName}</p>}

      {bulletin.headerNotes.length > 0 && (
        <div className="prose">
          {bulletin.headerNotes.map((note, i) => (
            <p key={i}>{note}</p>
          ))}
        </div>
      )}

      {bulletin.announcements.length > 0 && (
        <ul className="grid">
          {bulletin.announcements.map((item) => (
            <li key={item.sourceId} className="card">
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
      )}

      {bulletin.multiDayEvents.length > 0 && (
        <ul className="grid" style={{ marginTop: '1.25rem' }}>
          {bulletin.multiDayEvents.map((event) => (
            <li key={event.sourceId} className="card">
              <p className="meta">
                {event.startDate} &ndash; {event.endDate}
              </p>
              <h3>{event.name}</h3>
              <p>{describeTime(event)}</p>
              {event.notes && <p>{event.notes}</p>}
            </li>
          ))}
        </ul>
      )}

      {daysWithEvents.length > 0 && (
        <ul className="week">
          {daysWithEvents.map((day) => (
            <li key={day.date} className="week__day">
              <h3>
                {day.day}
                {/* The date is machine-generated and unambiguous; the day name
                    is what the parish wrote. Show both, but let the date be the
                    machine-readable one. */}
                <time dateTime={day.date}>{day.date}</time>
              </h3>
              <ul>
                {day.events.map((event) => (
                  <li key={event.sourceId}>
                    <span className="week__time">{describeTime(event)}</span>
                    <span>{event.name}</span>
                    {event.notes && <em>{event.notes}</em>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function describeTime(event: BulletinEvent): string {
  if (event.time && event.timeTo) return `${event.time} – ${event.timeTo}`;
  return event.time ?? event.timeTo ?? '';
}
