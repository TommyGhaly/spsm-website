'use client';

import { useEffect, useState } from 'react';
import type { FormAnswers, FormDefinition, ParishConfig } from '@spsm/shared';
import { FormRenderer } from './FormRenderer';
import { readFormBySlug, type WithId } from './data';

/**
 * The `contact` form, rendered where people actually look for it.
 *
 * ---------------------------------------------------------------------------
 * A form definition, not a bespoke component — and that is the decision here.
 *
 * The obvious way to build "a contact form that stores name and email for
 * admins" is a small component posting to a new endpoint, writing a new
 * collection, read by a new panel. That is four new things, and every one of
 * them is a second implementation of something the forms feature already has:
 * server-side validation, a rate limit, a notification email, a confirmation
 * email, and a review table with status columns that staff already know how to
 * use.
 *
 * So this is `forms/contact` — an ordinary definition in the ordinary
 * collection, seeded by `scripts/lib/form-definitions.mjs`. Submissions land in
 * `formSubmissions` beside every other form's, and `identifySubmitter` lifts the
 * name and the email address onto the row, which is what makes the submissions
 * panel a contact list rather than a pile of messages. Staff can also reword the
 * questions, add a notification address, or close it, from the same drawer on
 * /forms they use for everything else — none of which would be true of a
 * hand-written component.
 *
 * What this file adds is only that the form appears *here*, on /contact, under
 * the address and the service times, rather than only behind a card on the hub.
 * Somebody looking for how to reach the parish goes to Contact.
 * ---------------------------------------------------------------------------
 *
 * Client-side, because /contact is a static export and the definition lives in
 * Firestore. Baking it at build time would mean a reworded question waits for
 * somebody with deploy rights, which is the thing the whole feature exists to
 * avoid.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'form'; form: WithId<FormDefinition> };

export function ContactForm({ parish }: { parish: ParishConfig }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    readFormBySlug('contact')
      .then((form) => {
        if (cancelled) return;
        /*
         * Unpublished reads as unavailable rather than as an error, exactly as
         * it does on the form shell: a draft is invisible to the public by rule,
         * and this page has a perfectly good fallback to offer instead.
         */
        setState(
          form && form.published && form.kind === 'native'
            ? { kind: 'form', form }
            : { kind: 'unavailable' },
        );
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'unavailable' });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') {
    return <p className="note">Loading the contact form…</p>;
  }

  /*
   * The fallback is the parish's own address and phone number, not an apology.
   *
   * This branch covers a dropped connection, a form nobody has seeded yet, and a
   * form staff have deliberately unpublished. In all three the reader wants the
   * same thing — a way to reach the office — and the page already has one a few
   * inches above. Saying so is more use than "the form could not be loaded".
   */
  if (state.kind === 'unavailable') {
    return (
      <p className="note">
        The contact form is not available at the moment — please reach the church office
        directly.
        {parish.email && (
          <>
            {' '}
            Write to <a href={`mailto:${parish.email}`}>{parish.email}</a>.
          </>
        )}
        {parish.phone && (
          <>
            {' '}
            {/* Punctuation stripped for the dialler, exactly as ContactDetails does it. */}
            or call <a href={`tel:${parish.phone.replace(/[^\d+]/g, '')}`}>{parish.phone}</a>.
          </>
        )}
      </p>
    );
  }

  const { form } = state;

  /*
   * Closed is a real state for this form too. Staff can shut it — over a long
   * holiday, or if it is being flooded — and when they do, the reader should be
   * told that rather than shown fields that will be refused on submit.
   */
  if (!form.open) {
    return (
      <div className="notice">
        <h3>The contact form is closed</h3>
        <p>{form.closedMessage ?? 'Please use the details above to reach the church office.'}</p>
      </div>
    );
  }

  return (
    <>
      {form.blurb && <p className="note">{form.blurb}</p>}
      <FormRenderer form={form} initialAnswers={subjectFromQuery(form)} />
    </>
  );
}

/**
 * `?about=<option>` in the address, turned into a chosen subject.
 *
 * ---------------------------------------------------------------------------
 * Why the address bar gets to fill in a field at all.
 *
 * The sign-in help at the foot of /calendar sends a servant here to ask for a
 * church account. Sending them to a bare contact form and trusting them to pick
 * the right line out of a select is how that request arrives filed under "A
 * general question" — and the point of the subject column in the submissions
 * table is that the office can tell these apart at a glance.
 *
 * Nothing here is trusted. The value is matched against the options on the
 * *stored* form and dropped if it is not one of them, so a link that has gone
 * stale — an option renamed in the builder, a value someone typed by hand —
 * opens an ordinary empty form rather than one carrying an answer the server
 * will refuse on submit. Only the subject field can be filled this way; there is
 * no general "prefill any field from the URL", which would let a link put words
 * in somebody's message.
 * ---------------------------------------------------------------------------
 */
function subjectFromQuery(form: FormDefinition): FormAnswers {
  if (typeof window === 'undefined') return {};

  const wanted = new URLSearchParams(window.location.search).get('about');
  if (!wanted) return {};

  const subject = form.fields.find((field) => field.key === 'subject');
  if (!subject || !subject.options.some((option) => option.value === wanted)) return {};

  return { subject: wanted };
}
