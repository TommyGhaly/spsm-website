'use client';

import { useState } from 'react';
import {
  COMMEMORATION_LABELS,
  COMMEMORATION_WHEN,
  PRAYER_BODY_MAX_LENGTH,
  validatePrayerRequest,
  type CommemorationWhen,
  type PrayerKind,
  type PrayerRequestInput,
} from '@spsm/shared';
import { submitPrayerRequest } from './data';

/**
 * Prayer request submission.
 *
 * A client component, unavoidably: the site is a static export, so there is no
 * server at request time. The write goes to `prayerSubmit`, a Cloud Function,
 * because the request is sealed before storage and the key cannot live here.
 * The Function runs this same validator again; that run is the one that decides.
 *
 * No account required, and that is the point — sign-in here is for the parish
 * directory, and a parishioner has no account by design.
 *
 * ## Two requests, not one
 *
 * A prayer for the living and a commemoration of the departed are different
 * acts, read at different moments, and asking which one first is what lets the
 * fathers work through a list without reading every entry to sort it. Choosing
 * `commemoration` reveals *when* it is offered — recently departed, the fortieth
 * day, or the annual — which follows Coptic practice rather than being a
 * category invented for a database.
 */

const EMPTY: PrayerRequestInput = {
  body: '',
  visibility: 'clergy',
  anonymous: false,
  authorName: null,
  contactEmail: null,
  kind: 'prayer',
  commemoration: null,
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
    const result = await submitPrayerRequest(input);

    if (!result.ok) {
      setErrors(result.errors);
      setStatus({ kind: 'idle' });
      return;
    }

    setStatus({ kind: 'sent' });
    setInput(EMPTY);
  }

  /**
   * Switching kind clears the occasion.
   *
   * The validator refuses an ordinary prayer request that carries `annual`, and
   * without this a person who picked commemoration, chose the fortieth day, then
   * changed their mind would be blocked by an answer to a question no longer on
   * screen — the same stale-answer trap `visibleFields` exists to prevent on the
   * built forms.
   */
  function setKind(kind: PrayerKind) {
    setInput((previous) => ({
      ...previous,
      kind,
      commemoration: kind === 'commemoration' ? previous.commemoration : null,
    }));
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

        {/*
        Asked first, because it changes what the rest of the form means.

        A radio group rather than a select: there are two, both matter, and the
        one a person wants should be visible without opening anything.
      */}
      <fieldset className="fx__group">
        <legend>
          <span>What are you asking for?</span>
        </legend>
        <div className="fx__options">
          {([
            ['prayer', 'A prayer request'],
            ['commemoration', 'A commemoration'],
          ] as const).map(([value, label]) => (
            <label key={value} className={input.kind === value ? 'fx__option is-on' : 'fx__option'}>
              <input
                type="radio"
                name="prayer-kind"
                value={value}
                checked={input.kind === value}
                onChange={() => setKind(value)}
              />
              <span className="fx__option-label">{label}</span>
            </label>
          ))}
        </div>
        <small>
          A commemoration is a prayer for someone who has fallen asleep.
        </small>
      </fieldset>

      {input.kind === 'commemoration' && (
        <fieldset className="fx__group">
          <legend>
            <span>
              When is it offered? <abbr title="required">*</abbr>
            </span>
          </legend>
          <div className="fx__options">
            {COMMEMORATION_WHEN.map((when) => (
              <label
                key={when}
                className={input.commemoration === when ? 'fx__option is-on' : 'fx__option'}
              >
                <input
                  type="radio"
                  name="commemoration-when"
                  value={when}
                  checked={input.commemoration === when}
                  onChange={() => set('commemoration', when as CommemorationWhen)}
                />
                <span className="fx__option-label">{COMMEMORATION_LABELS[when]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

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
