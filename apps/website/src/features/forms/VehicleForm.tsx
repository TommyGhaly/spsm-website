'use client';

import { useState } from 'react';
import {
  MAX_DRIVERS,
  TAKSIS_COLORS,
  validateVehicleRegistration,
  type TaksisDriver,
  type VehicleRegistrationInput,
} from '@spsm/shared';
import { submitForm } from './data';

/**
 * Vehicle registration, in the parish's own clothes.
 *
 * ---------------------------------------------------------------------------
 * Why this is a hand-written component and not a form definition.
 *
 * Everything else under /forms is data — a `FormDefinition` in Firestore, drawn
 * by `FormRenderer`. This one is code, because three of its parts have no
 * expression in that schema and would each have needed a field type invented for
 * a single form:
 *
 *   - a repeating group (one to five drivers, each with three fields),
 *   - a swatch picker bound to Taksis's twelve colour values,
 *   - a destination that is a different Firebase project.
 *
 * A `repeatingGroup` field type is a real thing a form builder could have, and
 * this is not the form to justify building it. The builder can still list,
 * publish, unpublish and reorder this form — `kind: 'vehicle'` is what tells the
 * page to render this component instead of the generic one.
 *
 * ## It goes to Taksis and nowhere else
 *
 * This deliberately does *not* write to our own `vehicles` collection, and it
 * replaces the form at /parking that did. That was a decision made with the
 * tradeoff on the table: a Taksis outage means the registration is lost rather
 * than queued locally.
 *
 * What that buys is the absence of a second, divergent copy of who is allowed to
 * park here — the failure mode of the "write both" design is not an outage, it
 * is two databases that disagree six months later and no rule for which wins.
 *
 * The honest cost of choosing it is that a failure has to be *visible*. So the
 * Function reports one, and this component says so and keeps the answers on
 * screen. It never shows a confirmation for a write that did not land.
 * ---------------------------------------------------------------------------
 */

const EMPTY_DRIVER: TaksisDriver = { name: '', phone: '', has_taksis: false };

const EMPTY: VehicleRegistrationInput = {
  plate: '',
  make: '',
  model: '',
  color: '',
  drivers: [{ ...EMPTY_DRIVER }],
};

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'failed'; errors: string[] };

export function VehicleForm({ slug, confirmation }: { slug: string; confirmation: string }) {
  const [input, setInput] = useState<VehicleRegistrationInput>(EMPTY);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  function set<K extends keyof VehicleRegistrationInput>(
    key: K,
    value: VehicleRegistrationInput[K],
  ) {
    setInput((previous) => ({ ...previous, [key]: value }));
  }

  function setDriver(index: number, patch: Partial<TaksisDriver>) {
    /*
     * A functional update, not `{...input}`. The Taksis toggle and the name
     * field can both change within one React batch, and reading `input` from
     * the closure would make the second write clobber the first — the same
     * collapsing-clicks failure the programs picker hit.
     */
    setInput((previous) => ({
      ...previous,
      drivers: previous.drivers.map((driver, position) =>
        position === index ? { ...driver, ...patch } : driver,
      ),
    }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    const found = validateVehicleRegistration(input);
    if (found.length > 0) {
      setStatus({ kind: 'failed', errors: found });
      return;
    }

    setStatus({ kind: 'sending' });

    /*
     * Sent as ordinary form answers under reserved keys, so this rides the same
     * `/api/forms/submit` endpoint as everything else. The Function recognises
     * `kind: 'vehicle'` on the stored definition and maps these into Taksis's
     * field names with `toTaksisRecord` — the mapping lives in @spsm/shared,
     * once, rather than here and again on the server.
     */
    const result = await submitForm({
      slug,
      answers: {
        plate: input.plate,
        make: input.make,
        model: input.model,
        color: input.color,
        drivers: JSON.stringify(input.drivers),
      },
      cardToken: null,
      verificationToken: null,
    });

    setStatus(result.ok ? { kind: 'sent' } : { kind: 'failed', errors: result.errors });
  }

  if (status.kind === 'sent') {
    return (
      <div className="notice">
        <h2>Registration submitted</h2>
        <p>{confirmation}</p>
      </div>
    );
  }

  const drivers = input.drivers;

  return (
    <form className="form fx" onSubmit={onSubmit} noValidate>
      {status.kind === 'failed' && (
        <div className="notice notice--alarm" role="alert">
          <h2>Please check the following</h2>
          <ul>
            {status.errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset>
        <legend>The vehicle</legend>

        <label className="field">
          <span>
            License plate <abbr title="required">*</abbr>
          </span>
          <input
            className="fx__plate"
            value={input.plate}
            onChange={(event) => set('plate', event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="e.g. 1ABC23"
            required
          />
          {/*
            No state field, deliberately — Taksis has nowhere to put one. Worth
            saying rather than leaving someone hunting for the dropdown they
            filled in on the old form.
          */}
          <small>Whatever is on the plate. The state is not needed.</small>
        </label>

        <div className="field-row">
          <label className="field">
            <span>Make</span>
            <input
              value={input.make}
              onChange={(event) => set('make', event.target.value)}
              placeholder="e.g. Toyota"
            />
          </label>
          <label className="field">
            <span>Model</span>
            <input
              value={input.model}
              onChange={(event) => set('model', event.target.value)}
              placeholder="e.g. Camry"
            />
          </label>
        </div>

        <fieldset className="fx__group">
          <legend>
            <span>Colour</span>
          </legend>
          {/*
            Twelve fixed swatches rather than a text box, because Taksis matches
            on the value: "dark blue" typed in is a colour their system does not
            have and will not match. Tapping the chosen one again clears it —
            colour is optional and there is otherwise no way back to unset.
          */}
          <div className="fx__swatches">
            {TAKSIS_COLORS.map((colour) => (
              <button
                key={colour.value}
                type="button"
                className={
                  input.color === colour.value ? 'fx__swatch is-on' : 'fx__swatch'
                }
                aria-pressed={input.color === colour.value}
                onClick={() => set('color', input.color === colour.value ? '' : colour.value)}
              >
                <span className="fx__chip" style={{ background: colour.hex }} aria-hidden="true" />
                {colour.label}
              </button>
            ))}
          </div>
        </fieldset>
      </fieldset>

      <fieldset>
        <legend>Drivers</legend>

        {drivers.map((driver, index) => (
          <div className="fx__driver" key={index}>
            <div className="fx__driver-head">
              <span className="fx__driver-num">{index + 1}</span>
              <span>Driver {index + 1}</span>
              {index > 0 && (
                <button
                  type="button"
                  className="button button--quiet fx__driver-remove"
                  onClick={() =>
                    setInput((previous) => ({
                      ...previous,
                      drivers: previous.drivers.filter((_, position) => position !== index),
                    }))
                  }
                >
                  Remove
                </button>
              )}
            </div>

            <div className="field-row">
              <label className="field">
                <span>
                  Full name{index === 0 && <abbr title="required"> *</abbr>}
                </span>
                <input
                  value={driver.name}
                  onChange={(event) => setDriver(index, { name: event.target.value })}
                  autoComplete={index === 0 ? 'name' : 'off'}
                  placeholder="First and last name"
                />
              </label>
              <label className="field">
                <span>
                  Phone{index === 0 && <abbr title="required"> *</abbr>}
                </span>
                <input
                  type="tel"
                  value={driver.phone}
                  onChange={(event) => setDriver(index, { phone: event.target.value })}
                  autoComplete={index === 0 ? 'tel' : 'off'}
                  placeholder="(508) 555-0134"
                />
              </label>
            </div>

            <label className="field field--check">
              <input
                type="checkbox"
                checked={driver.has_taksis}
                onChange={(event) => setDriver(index, { has_taksis: event.target.checked })}
              />
              <span>
                This driver has the Taksis app installed <em>(optional)</em>
              </span>
            </label>
          </div>
        ))}

        {drivers.length < MAX_DRIVERS && (
          <button
            type="button"
            className="button button--ghost fx__add-driver"
            onClick={() =>
              setInput((previous) => ({
                ...previous,
                drivers: [...previous.drivers, { ...EMPTY_DRIVER }],
              }))
            }
          >
            + Add another driver
          </button>
        )}
      </fieldset>

      <button className="button" type="submit" disabled={status.kind === 'sending'}>
        {status.kind === 'sending' ? 'Submitting…' : 'Submit registration'}
      </button>
    </form>
  );
}
