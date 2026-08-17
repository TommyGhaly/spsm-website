import type { PastStream } from '@spsm/shared';
import { formatDate, formatPartOfDay, isoOf } from '@/lib/dates';

/**
 * The back catalogue, under the live player.
 *
 * **Led by the date and time, with no title shown, and that is the whole
 * design.** Every broadcast on the parish's channel is published under the
 * identical name — "St Philopater & St Mina Coptic Orthodox Church Live
 * Stream" — so printing it gives twelve identical headings and pushes the one
 * field that actually differs into small grey type beneath them. When each
 * service happened *is* the title here.
 *
 * Consequently there is no summary line either. Nothing in the feed says which
 * liturgy this was or who served it, and inventing a description for a
 * recording nobody has watched would be worse than the gap.
 *
 * These link out to YouTube rather than embedding: twelve iframes on one page
 * is a slow page and a lot of third-party script for something most visitors
 * will not click.
 */
export function PastStreams({ streams }: { streams: PastStream[] }) {
  // The section is omitted entirely rather than rendering an empty state. On a
  // static build an empty archive usually means the feed was unreachable during
  // the deploy, not that the parish has never streamed — and "no past services"
  // would be a claim about the parish rather than about the build.
  if (streams.length === 0) return null;

  return (
    <section aria-labelledby="past-streams">
      <h2 id="past-streams">Recent services</h2>
      <p className="note">
        Previous liturgies from the parish&apos;s channel, most recent first.
      </p>

      <ul className="grid">
        {streams.map((stream) => (
          <StreamCard key={stream.id} stream={stream} />
        ))}
      </ul>
    </section>
  );
}

function StreamCard({ stream }: { stream: PastStream }) {
  /*
   * The day, and which part of it — "Sunday, August 16, 2026 · Morning".
   *
   * The part of day is here because the parish streams more than once on most
   * days, a liturgy in the morning and a service in the evening, so a label
   * keyed on the date alone repeats itself twice in a row.
   *
   * It is a word rather than a clock time because a past liturgy is not an
   * appointment anyone can still keep: "7:52 AM" spends precision on a
   * recording nobody is going to arrive at, and implies a punctuality the
   * source cannot support — a stream starts when someone presses a button, not
   * when the service does. "Morning" is the distinction a reader is actually
   * making. The exact instant is still in the `dateTime` attribute below for
   * anything reading this by machine.
   */
  const when = `${formatDate(stream.startedAt)} · ${formatPartOfDay(stream.startedAt)}`;

  return (
    <li className="card card--link card--aside">
      {/*
        A background rather than an `<img>`, matching `.card__thumb` elsewhere:
        these are hotlinked from YouTube's CDN, and a background that fails to
        load leaves a blank square rather than a torn-page icon.
      */}
      {stream.thumbnailUrl && (
        <span
          className="card__thumb card__thumb--wide"
          style={{ backgroundImage: `url(${stream.thumbnailUrl})` }}
          aria-hidden="true"
        />
      )}

      <div className="card__text">
        <h3>
          <a
            href={`https://www.youtube.com/watch?v=${stream.id}`}
            rel="noopener noreferrer"
            target="_blank"
          >
            {/*
              `<time>` inside the heading because the date is the name of this
              thing, not metadata about it — so it should be what a screen
              reader announces when navigating by heading, and what the link
              text says.
            */}
            <time dateTime={isoOf(stream.startedAt)}>{when}</time>
          </a>
        </h3>
      </div>
    </li>
  );
}
