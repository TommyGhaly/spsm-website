'use client';

/**
 * An event's own page — the thing a parishioner reads.
 *
 * ## Why the page is the editor
 *
 * There used to be a form at `/admin/events` and this page was read-only.
 * Tommy: *"i don't even want an admin page i'm talking about the edit in place on
 * the page."* And he is right that it was the odd one out: the ministries and the
 * galleries are already edited where they are shown (see
 * `features/programs/editMode`), so events were the one part of the site where
 * changing something meant going somewhere else, filling in a form, and then
 * navigating back to see whether it looked right. The whole `/admin` section is
 * gone and this is the only way an event is edited.
 *
 * ## Nothing at all until you press Edit
 *
 * With edit mode off, an administrator sees exactly what a visitor sees, byte for
 * byte. That is deliberate and load-bearing: it is the only honest way to check
 * how a page reads. A visitor is not merely shown no controls — none are
 * rendered, `useEventsAdmin` does not pull in the auth SDK for them, and the
 * editor itself is a separate chunk that is never fetched.
 *
 * ## This file is now only the read-only page
 *
 * It used to be both, at 602 lines, and the editing half was the larger one.
 * They are split because they are not variations of one thing: this half must
 * render identically for a visitor and is prerendered into static HTML, and the
 * other half is a client-only surface that writes to Firestore. Keeping them in
 * one component meant every editing concern was one `if` away from the page the
 * parish reads. See `EventEditor`.
 *
 * ## The one piece of state that has to live here
 *
 * `live`. The read-only page owns the document it renders, so the editor hands
 * each saved document back up as it writes — otherwise pressing Done would show
 * the words that were baked into this page's HTML at the last build, and the edit
 * would look lost.
 *
 * ## What is still not here
 *
 * Creating an event. A new one has no page to be in place on until the next build
 * enumerates its slug, so it lives at `/staff/events`, reached from the masthead's
 * account menu. Reaching an *unpublished* event used to be on that list too and no
 * longer is: there is no such thing — see `EventEditor` on the publish step going.
 */

import { useState } from 'react';
import type { DocOf, Event } from '@spsm/shared';
import { EditModeProvider, EditToggle, useEditMode } from '@/features/programs/editMode';
import { Prose } from '@/components/Prose';
import { PageBody } from '@/components/PageBody';
import { Icon } from '@/components/Icon';
import { BackLink } from '@/components/BackLink';
import { formatEventWhen, isoOf } from '@/lib/dates';
import { storageUrl } from '@/lib/storage';
import { EventEditor } from './EventEditor';
import { useEventsAdmin } from './useEventsAdmin';

/*
 * `editMode` is imported out of `features/programs`, which is not where a
 * generic thing belongs. It is generic though — its own header says so, and it
 * carries the toggle's markup and the one class the stylesheet keys off — and a
 * second copy of an editing mode is worse than an import across a boundary.
 * Worth moving to `components/` if a third page ever wants it.
 */

export function EventArticle({ event }: { event: DocOf<Event> }) {
  const admin = useEventsAdmin();

  return (
    <EditModeProvider allowed={admin.canEdit}>
      <Article event={event} />
    </EditModeProvider>
  );
}

function Article({ event: baked }: { event: DocOf<Event> }) {
  const edit = useEditMode();
  const [live, setLive] = useState<DocOf<Event>>(baked);

  if (edit.on) {
    /*
     * Keyed on the document id so that everything the editor holds — the form,
     * the autosave bookkeeping, the pending-edit flag — is built fresh each time
     * editing starts, rather than being reconciled against whatever was left
     * over from the last session.
     */
    return <EventEditor key={live.id} baked={live} onSaved={setLive} />;
  }

  const shot = storageUrl(live.heroImagePath);

  return (
    <article>
      {shot && (
        /*
          Above the title, full-bleed: a photograph indented into the text
          column reads as an illustration of the first paragraph rather than as
          the event's own picture.

          A plain `img` rather than `next/image` — `output: 'export'` has no
          optimiser at runtime and the source is a Storage URL this build would
          have to be told about in `remotePatterns`, for one image per page,
          with the size cap enforced at upload instead.
        */
        <div className="event-hero">
          <img src={shot} alt="" />
        </div>
      )}
      <PageBody flush>
        <header className="gallery-head">
          <BackLink href="/calendar" label="Parish Calendar" />
          <div className="gallery-head__row">
            <div className="gallery-head__titles">
              <h1>{live.title}</h1>
              <p className="gallery-head__facts">
                <span>
                  <time dateTime={isoOf(live.startAt)}>
                    {formatEventWhen(live.startAt, live.endAt, live.allDay, live.timeZone)}
                  </time>
                </span>
              </p>
              {live.location && (
                <p className="gallery-head__where">
                  <Icon name="pin" size={16} />
                  <span>
                    {live.location.name}
                    {live.location.address && ` · ${live.location.address}`}
                  </span>
                </p>
              )}
            </div>
          </div>
        </header>

        <Prose>{live.body}</Prose>

        {/*
          Only `externalUrl` is rendered. `registration.formId` points at the
          `forms` collection, which has security rules but no schema and no
          `/forms/[slug]` route yet — linking to it would send a parishioner
          straight to a 404. Restore the branch when that route exists.
        */}
        {live.registration?.externalUrl && (
          <p>
            <a className="button" href={live.registration.externalUrl} rel="noopener noreferrer">
              Register for this event
            </a>
          </p>
        )}
      </PageBody>

      {/*
        Only here. The editor draws its own Done button inside its bar, and the
        two floating pills stacked in the same corner were exactly the bug this
        rebuild was asked to fix.
      */}
      <EditToggle />
    </article>
  );
}
