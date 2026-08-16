'use client';

import { useState } from 'react';
import {
  PRAYER_BODY_MAX_LENGTH,
  validatePrayerRequest,
  type PrayerRequestInput,
} from '@spsm/shared';
import { submitPrayerRequest } from './data';

/**
 * Prayer request submission.
 *
 * A client component, unavoidably: the site is a static export, so there is no
 * server at request time to post to. The write goes straight from the browser
 * to Firestore, which is exactly why `firestore.rules` validates every field
 * rather than trusting this form.
 *
 * No account required, and that is the point — sign-in here is for the parish
 * directory, and a parishioner has no account by design.
 */

const EMPTY: PrayerRequestInput = {
  body: '',
  visibility: 'clergy',
  anonymous: false,
  authorName: null,
  contactEmail: null,
};

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string };

export function PrayerForm() {
  const [input, setInput] = useState<PrayerRequestInput>(EMPTY);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  function set<K extends keyof PrayerRequestInput>(key: K, value: PrayerRequestInput[K]) {
    setInput((previous) => ({ ...previous, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    // The same validator `firestore.rules` mirrors, from @spsm/shared, so the
    // sentence someone reads and the constraint that holds cannot disagree.
    const found = validatePrayerRequest(input);
    setErrors(found);
    if (found.length > 0) return;

    setStatus({ kind: 'saving' });
    try {
      await submitPrayerRequest(input);
      setStatus({ kind: 'sent' });
      setInput(EMPTY);
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Something went wrong.',
      });
    }
  }

  if (status.kind === 'sent') {
    return (
      <div className="notice">
        <h2>Received</h2>
        <p>
          Your request has been passed to the fathers of the parish. There is no
          confirmation email — the request was not tied to an account, which is
          deliberate.
        </p>
        <p>
          <button className="button" type="button" onClick={() => setStatus({ kind: 'idle' })}>
            Send another
          </button>
        </p>
      </div>
    );
  }

  const remaining = PRAYER_BODY_MAX_LENGTH - input.body.length;

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      {errors.length > 0 && (
        <div className="notice notice--alarm" role="alert">
          <h2>Please check the following</h2>
          <ul>
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {status.kind === 'error' && (
        <div className="notice notice--alarm" role="alert">
          <h2>That didn&apos;t send</h2>
          <p>{status.message}</p>
          <p>Please speak to one of the fathers after liturgy, or contact the parish office.</p>
        </div>
      )}

      <fieldset>
        <legend>Your request</legend>

        <label className="field">
          <span>
            What would you like us to pray for? <abbr title="required">*</abbr>
          </span>
          <textarea
            value={input.body}
            onChange={(e) => set('body', e.target.value)}
            rows={6}
            maxLength={PRAYER_BODY_MAX_LENGTH}
            required
          />
          <small>
            {remaining < 200
              ? `${remaining} characters left.`
              : 'As much or as little as you wish.'}
          </small>
        </label>

        <label className="field">
          <span>Who should see this?</span>
          <select
            value={input.visibility}
            onChange={(e) => set('visibility', e.target.value as PrayerRequestInput['visibility'])}
          >
            <option value="clergy">The fathers only</option>
            <option value="public">The fathers and the prayer team</option>
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>Who it&apos;s for</legend>

        <label className="field field--check">
          <input
            type="checkbox"
            checked={input.anonymous}
            onChange={(e) => {
              set('anonymous', e.target.checked);
              if (e.target.checked) set('authorName', null);
            }}
          />
          <span>Send this anonymously</span>
        </label>

        {input.anonymous ? (
          <p className="note">
            No name will be stored, and there is no hidden record of who sent it. That
            also means it cannot be found and withdrawn later — not by you, and not by
            us.
          </p>
        ) : (
          <label className="field">
            <span>
              Name to pray for <abbr title="required">*</abbr>
            </span>
            <input
              value={input.authorName ?? ''}
              onChange={(e) => set('authorName', e.target.value)}
              autoComplete="name"
              required
            />
            <small>A first name is enough.</small>
          </label>
        )}

        <label className="field">
          <span>Email, if you would like someone to follow up</span>
          <input
            type="email"
            value={input.contactEmail ?? ''}
            onChange={(e) => set('contactEmail', e.target.value)}
            autoComplete="email"
          />
          <small>Optional. You can give this even when sending anonymously.</small>
        </label>
      </fieldset>

      <button className="button" type="submit" disabled={status.kind === 'saving'}>
        {status.kind === 'saving' ? 'Sending…' : 'Send request'}
      </button>
    </form>
  );
}
