'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CAMP_ROLE_SUGGESTIONS,
  CAMP_SECTIONS,
  MAX_CAMP_WEEKS,
  campSectionLabel,
  campWeekRangeLabel,
  campWeekRoleKey,
  type CampConfig,
  type CampSection,
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
            hint="Changing it opens a fresh, empty season and leaves the old one where it is."
          >
            <TextSetting
              value={config.season}
              onSave={(season) => save({ season })}
              placeholder="2027"
            />
          </Field>

          <Field
            label="How many weeks"
            hint="Normally two. Lowering it hides a week from the forms without taking away days anybody is already registered for."
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
                  : 'The Monday it starts. Until it is set, the register names its days “Week 1 · Mon”.'
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

        <Group title="What servants can sign up for">
          <WeekRolesSetting config={config} save={save} />
        </Group>

        <Group title="What it costs">
          <Field
            label="Fee per child, per week"
            hint="Both weeks is charged twice. Changing it never re-bills anybody already registered."
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
            hint="Only ever filled in by you, at a desk. Closing it stops new registrations; everything already taken stays fully editable, because a fee still gets paid in August."
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
                wait in a queue on the Registrations tab until you accept them.
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
            hint="Shown above the signature on both forms. Leave it empty and no waiver is asked for."
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
            hint="Change it whenever the wording above changes. Each registration stores the version it agreed to, so what a family signed in June stays legible in September."
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
 * `Field`, for a setting that is not one control.
 *
 * A `<div>` with the same label and hint. Anything holding its own buttons —
 * the roles editor below — has to use this: a `<label>` forwards a click
 * anywhere inside it to its first form control, so a label wrapped round a row
 * of "+ Kitchen" buttons focuses a text box every time one is pressed.
 */
/**
 * Which jobs the camp runs: one week at a time, both halves side by side.
 *
 * ---------------------------------------------------------------------------
 * Tommy, 2 Sep 2026: *"the section that says what servants can sign up for is
 * too crowded"*. It was. Splitting the lists by half of the camp doubled a
 * section that was already the longest on the page: four editors stacked, each
 * with a chip list, a text box, a button, an eleven-button row of suggestions
 * and a copy button. Nearly sixty controls to answer "which jobs does the camp
 * run", most of them about a week nobody was looking at.
 *
 * Three cuts, in the order they matter:
 *
 * 1. **A week at a time.** Underline tabs, the same idiom `.camp-tab` and the
 *    rail's menus use — this says which list you are reading, not which button
 *    to press. It is also the only shape that survives `weeks` being six: six
 *    weeks of two halves is twelve editors, and no amount of tidying makes
 *    twelve editors on one page legible.
 * 2. **The two halves stay side by side**, not behind a second tab. They are
 *    the comparison — "elementary has a craft table where middle school has a
 *    trip" is the thing being edited, and a tab between them turns one glance
 *    into two clicks and a memory test.
 * 3. **The suggestions show only while a list is empty.** They are a head start
 *    for a camp that has not chosen, and eleven `+ Sports` buttons under a list
 *    that already says Sports are eleven buttons in the way. The row clears
 *    itself as the list fills — see `RolesSetting`.
 *
 * The copy-from offer is the work this panel exists to remove, and it looks
 * **sideways before backwards**: most camps run the same jobs in both weeks,
 * but the two halves of the camp differ from each other far more than week one
 * differs from week two, so elementary's own week-one list is a better offer to
 * elementary's week two than middle school's week two is. It is never offered
 * over a list that already exists, because it replaces one.
 * ---------------------------------------------------------------------------
 */
function WeekRolesSetting({
  config,
  save,
}: {
  config: CampConfig;
  save: (patch: CampSettingsPatch) => void | Promise<void>;
}) {
  const [week, setWeek] = useState(1);
  // A camp shortened while this panel is open must not leave the tabs pointing
  // at a week that no longer has a tab.
  const shown = Math.min(week, config.weeks);
  const weeks = Array.from({ length: config.weeks }, (_unused, index) => index + 1);

  return (
    <>
      <p className="camp-field__hint">
        The boxes the sign-up form offers. A list per half of the camp, because elementary
        and middle school do not run the same stations, and a servant is only shown the
        halves they signed up to serve. Leave one empty and the form offers the standard
        list.
      </p>

      {/*
        Which week these two lists belong to.
        ----------------------------------------------------------------------
        Tommy: *"How do I know which week I'm editing?"* You could not. These
        were `.camp-pickTab`, a class with **no stylesheet rule anywhere** — so
        they rendered as the browser's own grey Arial buttons and the selected
        one was byte-identical to the other. `aria-selected` was set and nothing
        drew it.

        They are `.camp-weekPill` now, which is the control the groups board
        already uses to pick a week: the same question asked on two screens
        should look the same on both, and reusing it means there is no second
        set of rules to forget to write.

        The week's number and nothing else on the pill. The dates are two fields
        up this same panel, and two tabs carrying a date range are 268px wide
        and wrap onto a second row on a phone. They go on the heading below
        instead, where they cost nothing.
      */}
      {weeks.length > 1 ? (
        <div className="camp-weeks" role="tablist" aria-label="Which week">
          {weeks.map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={entry === shown}
              className={`camp-weekPill${entry === shown ? ' is-on' : ''}`}
              onClick={() => setWeek(entry)}
            >
              Week {entry}
            </button>
          ))}
        </div>
      ) : null}

      {/*
        And said out loud, over the lists it governs.
        ----------------------------------------------------------------------
        A selected tab tells you which week while you are looking at the tabs;
        it tells you nothing once you are three role chips deep in the column
        below. The same heading the sign-up form now carries — see `WeekRoles` —
        so the camp's own list and the servant's view of it are labelled alike.
      */}
      <p className="camp-weekNow">
        <strong>Week {shown}</strong>
        {campWeekRangeLabel(config.weekStarts, shown) === `Week ${shown}` ? null : (
          <span>{campWeekRangeLabel(config.weekStarts, shown)}</span>
        )}
      </p>

      {/*
        The wrapper exists to be a container: the settings panel puts its groups
        in one column or two depending on the window, so how much room these two
        lists have is not a fact about the viewport. A media query gave them
        194px each at 1024px wide, where the panel is two columns — see the CSS.
      */}
      <div className="camp-roleColsWrap">
        <div className="camp-roleCols">
          {CAMP_SECTIONS.map((section) => (
            <WeekSectionRoles
              key={campWeekRoleKey(shown, section)}
              config={config}
              week={shown}
              section={section}
              save={save}
            />
          ))}
        </div>
      </div>
    </>
  );
}

/** One week's list of jobs, for one half of the camp. */
function WeekSectionRoles({
  config,
  week,
  section,
  save,
}: {
  config: CampConfig;
  week: number;
  section: CampSection;
  save: (patch: CampSettingsPatch) => void | Promise<void>;
}) {
  const key = campWeekRoleKey(week, section);
  const own = config.weekRoles[key] ?? [];
  const firstWeek = config.weekRoles[campWeekRoleKey(1, section)] ?? [];
  // A list written before the two halves were told apart. Offered to either of
  // them, because that is what it meant — see `campWeekRoleOptions`.
  const shared = config.weekRoles[campWeekRoleKey(week)] ?? [];
  const copy =
    own.length > 0
      ? null
      : week > 1 && firstWeek.length > 0
        ? { roles: firstWeek, label: `Copy week 1\u2019s ${firstWeek.length}` }
        : shared.length > 0
          ? { roles: shared, label: `Use the old list of ${shared.length}` }
          : null;

  return (
    /*
      A `Fieldset`, not the `Field` every other setting uses: `Field` is a
      `<label>`, and a label containing a dozen buttons hands every one of those
      clicks to its first control as well. Same markup otherwise, so the two
      read identically.
    */
    <Fieldset
      label={campSectionLabel(section)}
      section={section}
      hint={
        own.length === 0
          ? shared.length > 0
            ? `Not set — this week's older camp-wide list of ${shared.length} is offered here.`
            : 'Not set — the form offers the standard list here.'
          : `${own.length} to choose from, in this order.`
      }
    >
      <RolesSetting
        roles={own}
        suggestions={CAMP_ROLE_SUGGESTIONS}
        copy={copy}
        onSave={(roles) => {
          /*
           * The whole list, at the field path `weekRoles.w2_middle`, so saving
           * this one cannot blank another week or the other half of the camp —
           * see `CampSettingsPatch`, and `campWeekRoleKey` for why the section
           * is spelled `middle` and not `middle-school` in a key.
           *
           * A list emptied is stored as an empty list rather than deleted, and
           * `parseCampConfig` drops it on read: the form falls back either way,
           * and a `deleteField` here would be a second shape of write for no
           * visible difference.
           */
          void save({ [`weekRoles.${key}`]: roles });
        }}
      />
    </Fieldset>
  );
}

function Fieldset({
  label,
  hint,
  section,
  children,
}: {
  label: string;
  hint: React.ReactNode;
  /**
   * Which half of the camp this fieldset belongs to, when it belongs to one.
   *
   * Read by the stylesheet, not by anything here: `.camp-field[data-section]`
   * puts the half's colour on the label and on the chips inside it — oxblood
   * for elementary, azure for middle school, the same pairing the servant sees
   * on the sign-up form. Two lists of a dozen near-identical chips is exactly
   * the place where a colour is worth more than a heading.
   */
  section?: CampSection;
  children: React.ReactNode;
}) {
  return (
    <div className="camp-field" data-section={section}>
      <span className="camp-field__label">{label}</span>
      {children}
      <span className="camp-field__hint">{hint}</span>
    </div>
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
 * One week's list of jobs, as chips rather than lines of text.
 *
 * ---------------------------------------------------------------------------
 * This was a textarea, one role per line, and Tommy rejected it: *"make it more
 * intuitive, don't rely on simple text to separate the roles."* He is right, and
 * the reason is worth writing down — a newline-separated textarea makes the
 * *separator* the thing you have to get right. It offers no answer to "is a
 * trailing blank line a role?", it cannot show that a job is already on the
 * list, it invites a comma somebody then wonders about, and it saves only when
 * the field is left, so a half-typed list looks saved and is not.
 *
 * So: each job is an object on screen. A chip with a cross removes it, a box
 * with a button adds one, and the standard suggestions sit underneath as
 * one-tap buttons that disappear as they are used. Every one of those is a
 * whole edit, saved as it happens.
 *
 * **The list is held in a ref as well as in state**, and that is not
 * belt-and-braces. Each edit writes to Firestore and comes back through the live
 * listener a moment later, and three taps on three suggestions inside one frame
 * all read the same `useState` value — measured: three clicks, one job added.
 * The ref is the authoritative list every edit builds on, so the three compose.
 *
 * A functional updater would fix the staleness and break something worse: the
 * write is a side effect, and React's StrictMode runs an updater **twice**, so
 * the save would fire twice per tap. See
 * [[spsm-batched-clicks-need-functional-updates]] and
 * [[spsm-react-strictmode-doubles-updaters]] — this is the intersection of the
 * two, and a ref is what satisfies both.
 *
 * Order is the order they were added, and it is the order the form draws them.
 * There is no reordering control: a checkbox list of eight jobs is read all at
 * once, and a drag handle on a settings panel is a mechanism nobody needs to
 * answer "which jobs does the camp run".
 * ---------------------------------------------------------------------------
 */
function RolesSetting({
  roles,
  suggestions,
  copy,
  onSave,
}: {
  roles: readonly string[];
  suggestions: readonly string[];
  /** Another list, offered as one button, with the words for that button. */
  copy: { roles: readonly string[]; label: string } | null;
  onSave: (roles: string[]) => void;
}) {
  const [list, setList] = useState<string[]>([...roles]);
  const [draft, setDraft] = useState('');
  /** What the next edit builds on. See the note above. */
  const latest = useRef<string[]>([...roles]);

  // A change from somewhere else — another laptop, or this panel's own save
  // coming back. Keyed on the contents rather than the array's identity, which
  // is new on every render of the parent. A NUL joins them because it is the
  // one character a job name cannot contain.
  const stored = roles.join('\u0000');
  useEffect(() => {
    const next = stored ? stored.split('\u0000') : [];
    latest.current = next;
    setList(next);
  }, [stored]);

  const commit = (next: string[]) => {
    latest.current = next;
    setList(next);
    onSave(next);
  };

  /**
   * Add a job, and say whether it was added.
   *
   * The answer is what decides whether the box is cleared. Typing "SPORTS" when
   * the list already says "sports" adds nothing — the whole point of a chip
   * list is that two spellings of one job never both reach the form — and
   * clearing the box on a refusal would look exactly like a save that silently
   * failed. Left in place, the word sits beside the chip that already says it.
   */
  const add = (role: string): boolean => {
    const trimmed = role.trim();
    if (!trimmed) return false;
    if (latest.current.some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) {
      return false;
    }
    commit([...latest.current, trimmed]);
    return true;
  };

  const remove = (role: string) =>
    commit(latest.current.filter((entry) => entry !== role));

  const unused = suggestions.filter(
    (role) => !list.some((entry) => entry.toLowerCase() === role.toLowerCase()),
  );

  return (
    <div className="camp-roles">
      {list.length > 0 ? (
        <ul className="camp-roles__list">
          {list.map((role) => (
            <li className="camp-roleChip" key={role}>
              <span>{role}</span>
              <button
                type="button"
                className="camp-roleChip__x"
                aria-label={`Remove ${role}`}
                onClick={() => remove(role)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="camp-roles__empty">Nothing yet — the form will offer the standard list.</p>
      )}

      <div className="camp-roles__add">
        <input
          type="text"
          className="input"
          value={draft}
          placeholder="Add a job"
          aria-label="Add a job servants can sign up for"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            // The panel is not a form, but Enter in a lone text box is still
            // read as "done" by everybody who types in one.
            event.preventDefault();
            if (add(draft)) setDraft('');
          }}
        />
        <button
          type="button"
          className="button button--quiet"
          disabled={!draft.trim()}
          onClick={() => {
            if (add(draft)) setDraft('');
          }}
        >
          Add
        </button>
      </div>

      {/*
        A head start, and only that. Eleven `+ Sports` buttons under a list that
        already says Sports are eleven buttons in the way of the four chips
        somebody came here to read, and this section carries two of these lists
        at once — so the row shows while the list is empty and clears itself on
        the first job added. Nothing becomes unreachable: every suggestion is a
        word that can be typed into the box above, which is where a camp's own
        jobs have always had to come from.
      */}
      {list.length === 0 && unused.length > 0 ? (
        <div className="camp-roles__suggest">
          <span className="camp-roles__suggestLabel">Common ones:</span>
          {unused.map((role) => (
            <button
              key={role}
              type="button"
              className="camp-roleAdd"
              onClick={() => add(role)}
            >
              + {role}
            </button>
          ))}
          {copy ? (
            <button
              type="button"
              className="camp-roleAdd camp-roleAdd--copy"
              onClick={() => commit([...copy.roles])}
            >
              {copy.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
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
