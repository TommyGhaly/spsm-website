import type { ServiceTime } from '@spsm/shared';

/**
 * The regular weekly schedule.
 *
 * Distinct from the bulletin, and the difference matters: this is what happens
 * *every* week, so it is true whether or not anyone published a bulletin. The
 * bulletin is one specific week, including its exceptions. A visitor asking
 * "when is liturgy?" wants this one.
 *
 * Times print as written, for the same reason bulletin times do — the source is
 * a human writing a schedule, not an instant, and reformatting invites a
 * timezone bug in exchange for nothing.
 */
export function ServiceTimes({ services }: { services: ServiceTime[] }) {
  if (services.length === 0) {
    return (
      <div className="notice">
        <h2>Service times aren&apos;t published yet</h2>
        <p>
          The weekly schedule hasn&apos;t been added to the site. This week&apos;s
          services are listed on the homepage, and the parish office can confirm the
          regular times.
        </p>
      </div>
    );
  }

  // Group by day so a day with three services reads as one block rather than
  // three repetitions of the same day name.
  const byDay = new Map<string, ServiceTime[]>();
  for (const service of services) {
    const existing = byDay.get(service.day);
    if (existing) existing.push(service);
    else byDay.set(service.day, [service]);
  }

  return (
    <ul className="week week--plain">
      {[...byDay.entries()].map(([day, entries]) => (
        <li key={day} className="week__day">
          <h3>{day}</h3>
          <ul>
            {entries.map((service) => (
              <li key={`${service.name}-${service.time}`}>
                <span className="week__time">{service.time}</span>
                <span className="week__name">{service.name}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
