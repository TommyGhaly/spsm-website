'use client';

import { useState } from 'react';
import { kindOf, type CalendarOccurrence } from '@spsm/shared';
import { formatClock } from './range';

/**
 * One thing on one day, in the two sizes the calendar needs.
 *
 * This used to hold a second, smaller `Pill` for the month view's cells. The
 * month view does not render entries as text any more — it draws a coloured dot
 * per entry and puts the detail in a panel below the grid — so there is one
 * size left.
 */

/**
 * The classes carrying an occurrence's colour and its markings.
 *
 * ---------------------------------------------------------------------------
 * Colour means *what a thing is*, not *where it came from*.
 *
 * It used to mean the source — gold for the parish calendar, azure for the
 * servants one — which spent the whole palette on a distinction most readers
 * are never shown, and left a page where a Divine Liturgy and a volleyball
 * tournament looked identical.
 *
 * Now a liturgy is liturgical red, teaching is gold, a gathering is azure, and
 * anything the classifier cannot place gets no colour claim at all. That makes
 * a week legible at a glance: the services are the red spine of it.
 *
 * Servants-only entries keep their distinction, but as a *marking* rather than
 * a hue — the dashed rule and the badge — so it can sit on top of any colour
 * without needing one of its own.
 * ---------------------------------------------------------------------------
 */
function tonesOf(occurrence: CalendarOccurrence, block: string): string {
  const kind = kindOf(occurrence);
  return [block, `${block}--${kind}`, occurrence.source === 'servants' ? `${block}--servants` : '']
    .filter(Boolean)
    .join(' ');
}

/**
 * A machine-readable `datetime` for a wall clock with no zone.
 *
 * `2026-08-24T08:00` with no offset is a valid HTML "floating" datetime, and it
 * is the honest encoding of what we have: Breeze sends a local reading, and
 * inventing `-04:00` here would be asserting an offset nobody gave us across a
 * DST boundary we would then have to get right. A date alone for an all-day
 * entry, for the same reason.
 */
function machineTime(day: string, time: string | null): string {
  return time ? `${day}T${time}` : day;
}

/**
 * One entry, on one line.
 *
 * ---------------------------------------------------------------------------
 * Time, title, photograph — and nothing stacked.
 *
 * This was three rows deep: the start time with the end time beneath it, the
 * title, then the location, the note and the contact each on their own line.
 * Accurate, and it made a Saturday with five services 320 pixels tall inside a
 * wheel that has to hold the tallest day in the week. Everything scrolled.
 *
 * One line each halves that. The end time went because it is the least-asked
 * question on the page — somebody is checking what time to *arrive* — and the
 * trailing detail moved onto the same line after the title, dimmed, where it
 * costs nothing when it is absent and is still there when it is not.
 * ---------------------------------------------------------------------------
 */
export function Entry({
  occurrence,
  day,
  onOpen,
}: {
  occurrence: CalendarOccurrence;
  day: string;
  onOpen: () => void;
}) {
  /*
   * Location, note and contact, in that order, on the end of the title's line.
   * The contact keeps its own element so the phone number stays dialable; the
   * rest is plain text.
   */
  const aside = [occurrence.location, occurrence.description].filter((part) => part !== '');

  return (
    <article className={tonesOf(occurrence, 'sched-entry')}>
      <p className="sched-entry__when">
        {occurrence.allDay ? (
          <span className="sched-entry__allday">All day</span>
        ) : (
          <time className="sched-entry__start" dateTime={machineTime(day, occurrence.startTime)}>
            {formatClock(occurrence.startTime)}
          </time>
        )}
      </p>

      <p className="sched-entry__what">
        {/*
          The title is the button, rather than the whole row being one.

          A row can contain a phone number, and a link inside a button is
          invalid HTML that browsers unnest — so the row cannot be the control
          if anything in it is. The title is the thing somebody would click
          anyway, and it leaves the contact dialable where it sits.

          Where an occurrence has a page of its own, the link to it is in the
          dialog rather than here: one gesture, one destination, and the dialog
          is where there is room to say what the page is.
        */}
        <button type="button" className="sched-entry__title" onClick={onOpen}>
          {occurrence.title}
        </button>

        {occurrence.source === 'servants' && <span className="sched-entry__tag">Servants</span>}
        {occurrence.source === 'manual' && <span className="sched-entry__tag sched-entry__tag--manual">Added</span>}

        {aside.length > 0 && <span className="sched-entry__meta">{aside.join(' · ')}</span>}
        {occurrence.contact && <Contact contact={occurrence.contact} />}
      </p>

      {occurrence.imageUrl && <Thumb src={occurrence.imageUrl} />}
    </article>
  );
}

/**
 * The bulletin's photograph, or nothing at all if it will not load.
 *
 * These are hotlinks into the announcements project's storage bucket — the
 * bulletin is read through and never mirrored, and that applies to its images
 * too. The cost of not holding our own copy is that the other project can
 * delete one at any time, and a broken `<img>` with a border and a background
 * on it is an empty grey box that looks like the page failed rather than like
 * an event with no picture.
 *
 * A plain `<img>` and not `next/image`: this is a static export with
 * `images.unoptimized`, so `next/image` would wrap the same tag in a layout
 * system for no benefit, and the host is deliberately not in
 * `images.remotePatterns`.
 */
function Thumb({ src }: { src: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;

  return (
    /*
     * `alt=""` and `aria-hidden` because it is decoration. The event's name is
     * the heading beside it; describing the photograph would make a screen
     * reader read the same entry twice.
     */
    <img
      className="sched-entry__thumb"
      src={src}
      alt=""
      aria-hidden="true"
      /*
       * Eager, and deliberately so.
       *
       * `loading="lazy"` was here and meant the pictures never appeared at all.
       * The wheel is a scroll container with a mask and a 3D transform on it,
       * and every day but the centred one sits outside its scrollport —
       * measured at y=-740 for the first thumbnail — so the browser decided
       * none of them were near enough to fetch and left thirteen empty boxes.
       *
       * There is nothing to save anyway: thirteen 32px images is less traffic
       * than the decision costs to get wrong.
       */
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
}

/**
 * "Servant Michael · (508) 555-0142", with the number dialable.
 *
 * The bulletin is the only source that carries one, and it is the most useful
 * thing on the sheet that the old iframe never showed anybody: the point of
 * putting a contact on an event is that somebody can reach them from a phone.
 */
function Contact({ contact }: { contact: string }) {
  const [name, phone] = contact.split(' · ');

  return (
    /*
     * A `<span>`, not a `<p>`. This sits inside `.sched-entry__what`, which is
     * itself a paragraph now that the entry is one line — and a `<p>` inside a
     * `<p>` is invalid HTML that the parser silently unnests, so the server's
     * markup and the client's disagree and React throws a hydration error. It
     * did, on every entry with a contact on it.
     */
    <span className="sched-entry__contact">
      {name}
      {phone && (
        <>
          {' · '}
          {/* Stripped to digits for the href, printed as the parish wrote it. */}
          <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}>{phone}</a>
        </>
      )}
    </span>
  );
}
