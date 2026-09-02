'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MAX_CAMP_WEEKS,
  campWeekRangeLabel,
  type CampConfig,
} from '@spsm/shared';
import { writeCampSettings, type CampSettingsPatch } from './data';

/**
 * The camp's settings, on the camp's own front page.
 *
 * ---------------------------------------------------------------------------
 * What was wrong with this before, and what this is answering.
 *
 * There was no settings screen. The season, the fee, the waiver and the number
 * of weeks were fields in a Firestore document edited by running a script, and
 * the one thing that *was* on screen — the servant sign-up switch — was a
 * toggle on a different page from everything it affected. So the answer to "how
 * do I open registrations" was "ask whoever has the console", and the answer to
 * "when is week two" was not written down anywhere the camp could read.
 *
 * Three things make this legible where a form of nine inputs would not be:
 *
 * 1. **Grouped by the question being asked**, not by the shape of the document.
 *    When the camp runs, what it costs, which forms are open, what people sign.
 * 2. **Every field says what it changes**, in a line under it, in the present
 *    tense. "Families are charged this for each child, each week" is a sentence
 *    somebody can check against what they meant; "baseCents" is not.
 * 3. **Saved as you go, one field at a time.** There is no Save button, because
 *    a settings page with one is a page where somebody changes the season,
 *    wanders off, and leaves the camp pointed at last year. Each control writes
 *    only its own key — see `writeCampSettings` — so two people editing
 *    different settings do not overwrite each other.
 *
 * The camp's `programId` is deliberately absent. It names the ministry whose
 * grant opens these screens, `firestore.rules` refuses it to a camp
 * administrator, and a field that always fails to save is worse than no field.
 * ---------------------------------------------------------------------------
 */

export interface SettingsPanelProps {
  config: CampConfig;
  uid: string | null;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export function SettingsPanel({ config, uid }: SettingsPanelProps) {
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const clear = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (clear.current !== null) window.clearTimeout(clear.current);
    },
    [],
  );

  async function save(patch: CampSettingsPatch) {
    setState('saving');
    setError(null);
    try {
      await writeCampSettings(patch, uid);
      setState('saved');
      if (clear.current !== null) window.clearTimeout(clear.current);
      clear.current = window.setTimeout(() => setState('idle'), 2000);
    } catch (cause) {
      setState('failed');
      /*
       * The two failures worth telling apart in words.
       *
       * `not-found` is a parish whose `config/camp` has never been created —
       * nothing is wrong with the permission and the fix is a one-line script.
       * Everything else is almost always the grant, and saying "ask the office"
       * for a missing document would send somebody to the wrong person.
       */
      const code = (cause as { code?: string })?.code ?? '';
      setError(
        code === 'not-found'
          ? 'The camp has no settings document yet. Somebody with console access ' +
            'needs to run: npm run camp -- --write'
          : code === 'permission-denied'
            ? 'Firestore refused that. You may no longer have the camp — try reloading.'
            : (cause as Error)?.message || 'The save did not go through.',
      );
    }
  }

  return (
    <section className="camp-settings">
      <header className="camp-settings__head">
        <h2>Settings</h2>
        <SaveMark state={state} />
      </header>

      {error ? <p className="camp-settings__error">{error}</p> : null}

      <div className="camp-settings__groups">
        <Group title="When camp runs">
          <Field
            label="Season"
            hint="The year being registered for. Every screen here reads this one word — changing it opens a fresh, empty season and leaves the old one where it is."
          >
            <TextSetting
              value={config.season}
              onSave={(season) => save({ season })}
              placeholder="2027"
            />
          </Field>

          <Field
            label="How many weeks"
            hint="Normally two. Lowering it hides a week from the forms and does not take away days anybody has already been registered for."
          >
            <select
              className="input input--narrow"
              value={config.weeks}
              onChange={(event) => {
                const weeks = Number(event.target.value);
                /*
                 * The dates are resized with the count, in the same write.
                 *
                 * Sent together because the two are one fact — a camp of three
                 * weeks with two start dates is a settings document that reads
                 * as "week three has no dates" forever, and nobody would think
                 * to go back and add one. Growing pads with blanks; shrinking
                 * drops the tail rather than keeping a date for a week that no
                 * longer exists.
                 */
                const weekStarts = Array.from(
                  { length: weeks },
                  (_unused, index) => config.weekStarts[index] ?? '',
                );
                void save({ weeks, weekStarts });
              }}
            >
              {Array.from({ length: MAX_CAMP_WEEKS }, (_unused, index) => index + 1).map(
                (count) => (
                  <option key={count} value={count}>
                    {count === 1 ? 'One week' : `${count} weeks`}
                  </option>
                ),
              )}
            </select>
          </Field>

          {config.weekStarts.map((start, index) => (
            <Field
              key={index}
              label={`Week ${index + 1} begins`}
              hint={
                start
                  ? `Monday to Friday — ${campWeekRangeLabel(config.weekStarts, index + 1)}.`
                  : 'The Monday it starts. Until this is set, the register names its days “Week 1 · Mon” instead of a date.'
              }
            >
              <input
                type="date"
                className="input input--narrow"
                value={start}
                onChange={(event) => {
                  const weekStarts = [...config.weekStarts];
                  weekStarts[index] = event.target.value;
                  void save({ weekStarts });
                }}
              />
            </Field>
          ))}
        </Group>

        <Group title="What it costs">
          <Field
            label="Fee per child, per week"
            hint="A child registered for both weeks is charged twice. Copied onto each registration as it is taken, so changing it never re-bills anybody already registered."
          >
            <MoneySetting
              cents={config.baseCents}
              onSave={(baseCents) => save({ baseCents })}
            />
          </Field>
        </Group>

        <Group title="The two forms">
          <Switch
            label="Family registrations"
            on={config.familyRegistration}
            onLabel="Open — the camp can take new families"
            offLabel="Closed — no new family registrations"
            hint="This form is only ever filled in by you, at a desk. Closing it stops new registrations being started; every registration already taken stays fully editable, because a fee still gets paid in August."
            onChange={(familyRegistration) => void save({ familyRegistration })}
          />

          <Switch
            label="Servant sign-ups"
            on={config.servantSignUp}
            onLabel="Open — anybody can sign up to serve"
            offLabel="Closed — the sign-up page says so"
            hint={
              <>
                The public form at <a href="/forms/summer-camp">/forms/summer-camp</a>. Sign-ups
                land in a queue on the Registrations tab and become real registrations when you
                accept them.
              </>
            }
            onChange={(servantSignUp) => void save({ servantSignUp })}
          />

          <Field
            label="Note on the forms"
            hint="Shown at the top of both. Empty is fine."
          >
            <TextSetting
              value={config.note}
              onSave={(note) => save({ note })}
              multiline
              placeholder="Camp runs 9am to 3pm. Bring a packed lunch."
            />
          </Field>
        </Group>

        <Group title="What people agree to">
          <Field
            label="Waiver"
            hint="Shown above the signature on both forms. Leave it empty and no waiver is asked for — a consent tick under an empty box is worse than not asking."
          >
            <TextSetting
              value={config.waiverText}
              onSave={(waiverText) => save({ waiverText })}
              multiline
              rows={8}
              placeholder="I give permission for my child to take part in…"
            />
          </Field>

          <Field
            label="Waiver version"
            hint="Change this whenever the wording above changes in a way that matters. Each registration stores the version it agreed to, so what a family signed in June stays legible after the text is edited in September."
          >
            <TextSetting
              value={config.waiverVersion}
              onSave={(waiverVersion) => save({ waiverVersion })}
              placeholder="2027-v1"
            />
          </Field>
        </Group>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * The parts
 * ------------------------------------------------------------------------ */

function SaveMark({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  return (
    <span className={`camp-save camp-save--${state}`} role="status">
      {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Not saved'}
    </span>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="camp-settings__group">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="camp-field">
      <span className="camp-field__label">{label}</span>
      {children}
      <span className="camp-field__hint">{hint}</span>
    </label>
  );
}

/**
 * A text setting saved when the field is left, not on every keystroke.
 *
 * Held locally while it is being typed and pushed on blur, which is what makes
 * a settings page that saves itself bearable: a debounce on a season field
 * writes "2", "20", "202", "2027" and a listener elsewhere sees the camp point
 * at three seasons that do not exist. Leaving the field is the moment somebody
 * has finished saying what they mean.
 */
function TextSetting({
  value,
  onSave,
  multiline,
  rows,
  placeholder,
}: {
  value: string;
  onSave: (next: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);

  // A change from somewhere else — another laptop, or another field's save —
  // replaces what is here, unless this is the field being typed in.
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft !== value) onSave(draft);
  };

  if (multiline) {
    return (
      <textarea
        className="input"
        rows={rows ?? 3}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
      />
    );
  }

  return (
    <input
      type="text"
      className="input"
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

/**
 * A fee, typed in dollars and stored in cents.
 *
 * Dollars on screen because that is what the camp says out loud, cents in the
 * document because that is the only way a total is not a rounding argument.
 * Anything unparseable leaves the stored figure alone rather than saving zero:
 * a fee silently becoming free is the worst failure this field has.
 */
function MoneySetting({ cents, onSave }: { cents: number; onSave: (cents: number) => void }) {
  const asText = (value: number) => (value > 0 ? (value / 100).toFixed(2) : '');
  const [draft, setDraft] = useState(asText(cents));

  useEffect(() => setDraft(asText(cents)), [cents]);

  return (
    <span className="camp-money">
      <span aria-hidden="true">$</span>
      <input
        type="text"
        inputMode="decimal"
        className="input input--narrow"
        value={draft}
        placeholder="0.00"
        aria-label="Fee per child per week, in dollars"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const trimmed = draft.trim();
          if (trimmed === '') {
            if (cents !== 0) onSave(0);
            return;
          }
          const parsed = Number(trimmed.replace(/[$,]/g, ''));
          if (!Number.isFinite(parsed) || parsed < 0) {
            setDraft(asText(cents));
            return;
          }
          const next = Math.round(parsed * 100);
          if (next !== cents) onSave(next);
        }}
      />
      <span className="camp-money__unit">per child, per week</span>
    </span>
  );
}

/**
 * One of the two form switches.
 *
 * A real checkbox behind a drawn track, so it is a checkbox to a keyboard and
 * to a screen reader and a switch to everybody else. The state is spelled out
 * in words beside it rather than left to the position of a knob — "Open" and
 * "Closed" is the fact somebody came here to check.
 */
function Switch({
  label,
  on,
  onLabel,
  offLabel,
  hint,
  onChange,
}: {
  label: string;
  on: boolean;
  onLabel: string;
  offLabel: string;
  hint: React.ReactNode;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="camp-switch">
      <label className="camp-switch__row">
        <input
          type="checkbox"
          checked={on}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="camp-switch__text">
          <span className="camp-field__label">{label}</span>
          <span className={`camp-switch__state${on ? ' is-on' : ''}`}>
            {on ? onLabel : offLabel}
          </span>
        </span>
      </label>
      <p className="camp-field__hint">{hint}</p>
    </div>
  );
}
