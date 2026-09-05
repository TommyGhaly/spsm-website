/**
 * SUPERSEDED — nothing renders this any more.
 *
 * ---------------------------------------------------------------------------
 * Vehicle registration moved to `features/forms`, and writes to Taksis.
 *
 * `/parking` and `/forms/vehicle-registration` both render
 * `features/forms/VehicleForm.tsx` now. That form collects a different set of
 * answers (a repeating driver list, a fixed twelve-colour picker, no state
 * field) and posts them through `formSubmit`, which pushes a
 * `pending_registrations` record into the Taksis project.
 *
 * The parking team works from Taksis. A second list of who may park here is not
 * a backup — it is a list that disagrees with the first one six months later,
 * with no rule for which wins.
 *
 * ## Why this is still here
 *
 * The `vehicles` collection holds the registrations already taken through this
 * form, and they are a record of something that happened. Deleting the code
 * that describes their shape would leave that data with nothing to read it.
 * `schema/vehicles.ts`, its validator, its tests and the `vehicles` rules all
 * stay for the same reason.
 *
 * Do not wire this back up to a page. If the parish ever wants a local copy of
 * a registration again, that is a decision to re-open deliberately — see the
 * note in `functions/src/forms/taksis.ts` for what was traded away and why.
 * ---------------------------------------------------------------------------
 */

'use client';

import { useState } from 'react';
import { validateVehicle, type VehicleInput } from '@spsm/shared';
import { registerVehicle } from './data';

/**
 * Vehicle registration.
 *
 * A client component, unavoidably: the site is a static export, so there is no
 * server at request time to post to. The write goes straight from the browser
 * to Firestore, which is exactly why `firestore.rules` validates every field
 * rather than trusting this form.
 *
 * No account required — guests park here too. See docs/decisions.md §3.5.
 */

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA',
  'RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
] as const;

const EMPTY: VehicleInput = {
  plate: '',
  plateState: 'MA',
  make: null,
  model: null,
  color: null,
  ownerName: '',
  ownerPhone: null,
  ownerEmail: null,
};

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

export function VehicleForm() {
  const [input, setInput] = useState<VehicleInput>(EMPTY);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  function set<K extends keyof VehicleInput>(key: K, value: VehicleInput[K]) {
    setInput((previous) => ({ ...previous, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    // Same validator the rest of the system uses, from @spsm/shared — so the
    // message a parishioner sees and the constraint staff rely on cannot drift.
    const found = validateVehicle(input);
    setErrors(found);
    if (found.length > 0) return;

    setStatus({ kind: 'saving' });
    try {
      await registerVehicle(input, null);
      setStatus({ kind: 'saved' });
      setInput(EMPTY);
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Something went wrong.',
      });
    }
  }

  if (status.kind === 'saved') {
    return (
      <div className="notice">
        <h2>Vehicle registered</h2>
        <p>
          Thank you — the parking team has it. You won&apos;t receive a confirmation
          email; if you need to change or remove the registration, contact the church
          office.
        </p>
        <p>
          <button className="button" type="button" onClick={() => setStatus({ kind: 'idle' })}>
            Register another vehicle
          </button>
        </p>
      </div>
    );
  }

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
          <h2>That didn&apos;t save</h2>
          <p>{status.message}</p>
        </div>
      )}

      <fieldset>
        <legend>The vehicle</legend>

        <div className="field-row">
          <label className="field">
            <span>
              License plate <abbr title="required">*</abbr>
            </span>
            <input
              name="plate"
              value={input.plate}
              onChange={(e) => set('plate', e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              required
            />
            <small>Spaces and dashes don&apos;t matter.</small>
          </label>

          <label className="field field--narrow">
            <span>
              State <abbr title="required">*</abbr>
            </span>
            <select
              name="plateState"
              value={input.plateState}
              onChange={(e) => set('plateState', e.target.value)}
              required
            >
              {STATES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Make</span>
            <input value={input.make ?? ''} onChange={(e) => set('make', e.target.value)} />
          </label>
          <label className="field">
            <span>Model</span>
            <input value={input.model ?? ''} onChange={(e) => set('model', e.target.value)} />
          </label>
          <label className="field">
            <span>Color</span>
            <input value={input.color ?? ''} onChange={(e) => set('color', e.target.value)} />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>How to reach you</legend>

        <label className="field">
          <span>
            Your name <abbr title="required">*</abbr>
          </span>
          <input
            value={input.ownerName}
            onChange={(e) => set('ownerName', e.target.value)}
            autoComplete="name"
            required
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Phone</span>
            <input
              type="tel"
              value={input.ownerPhone ?? ''}
              onChange={(e) => set('ownerPhone', e.target.value)}
              autoComplete="tel"
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={input.ownerEmail ?? ''}
              onChange={(e) => set('ownerEmail', e.target.value)}
              autoComplete="email"
            />
          </label>
        </div>
        <p className="meta">One of phone or email is needed, so we can reach you.</p>
      </fieldset>

      <button className="button" type="submit" disabled={status.kind === 'saving'}>
        {status.kind === 'saving' ? 'Registering…' : 'Register vehicle'}
      </button>
    </form>
  );
}
