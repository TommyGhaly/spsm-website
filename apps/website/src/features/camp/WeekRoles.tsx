'use client';

import { useState } from 'react';
import {
  CAMP_SECTIONS,
  campDesiredRolesFor,
  campSectionLabel,
  campWeekRangeLabel,
  campWeekRoleOptions,
  toggleDesiredRole,
  type CampConfig,
  type CampSection,
} from '@spsm/shared';

/**
 * What somebody would like to do, a section per week and a list per half of the
 * camp, ticked as often as they like.
 *
 * ---------------------------------------------------------------------------
 * Tommy, 2 Sep 2026: *"for the service form there should be a section per week
 * what they would like to do and they can check off as many as they want."*
 * This is that control, and it is one component because there are two screens
 * asking the same question — the servant on their phone at /forms/summer-camp,
 * and an administrator looking at the same record in the drawer. A checkbox
 * that behaves differently in the two is how a servant's answers quietly change
 * meaning between the form and the desk.
 *
 * ## Where the boxes come from
 *
 * `config/camp.weekRoles` — the camp's own list for that week **and that
 * section**, edited in Settings, falling back to a week-wide list written
 * before the two halves were told apart, and then to `CAMP_ROLE_SUGGESTIONS`.
 * Anything already ticked that is *not* on the list is offered too, at the end:
 * a role the camp removed after somebody asked for it must not silently vanish
 * from their record, and an administrator's free-typed role has to survive the
 * next render.
 *
 * ## Only the halves they serve
 *
 * Tommy, 2 Sep 2026: *"each week has stations for middle school and elementary
 * school so those should be distinct … they should only see the available roles
 * for the section they chose to serve in and both if they chose both."* The
 * sections tick-boxes are above this control on both screens, and what is
 * ticked there is what this renders. Somebody serving elementary is never
 * offered the middle-school trip, and somebody serving both answers twice —
 * because those genuinely are two answers, and the person building the boards
 * reads them separately.
 *
 * A half nobody has chosen yet shows **both**, rather than saying so and
 * rendering nothing: see the comment on `everything` below. Answering the
 * sections control narrows this to what they asked for.
 *
 * ## Only the weeks they are coming to
 *
 * This used to render **every** week the camp runs, saying "you have not chosen
 * any days in this week yet" under the ones they were not coming to, because
 * the day grid sat below and was often filled in afterwards. Tommy, 2 Sep 2026:
 * *"for the roles section in the camp make it 10x less cluttered"* — and that
 * placeholder week was most of the clutter. Two weeks times two halves times
 * eleven suggested jobs is forty-four checkboxes on a phone, of which the
 * servant needed at most half.
 *
 * The weeks question comes first on the form (`DayGrid`'s `weekFirst`), so a
 * week they have ticked *out* of is an answered question, and drawing it is
 * drawing a form for a week they said they are not coming to. Nothing is lost
 * when a week is cleared: `desiredRolesByWeek` keeps its key, and re-ticking
 * the week brings the answer straight back.
 *
 * Until *any* week is ticked, though, nothing has been answered, and every week
 * is drawn — an empty section is worse clutter than a full one, because it
 * reads as a broken form.
 *
 * The remaining boxes are **chips**, not a column of checkbox rows — the same
 * control the day grid draws its days as, which is what makes a dozen of them
 * scannable rather than a list to read.
 * ---------------------------------------------------------------------------
 */
export interface WeekRolesProps {
  config: CampConfig;
  byWeek: Readonly<Record<string, string[]>>;
  onChange: (next: Record<string, string[]>) => void;
  /** Which weeks they have any day in. Only these are drawn. */
  weeksAttending: readonly number[];
  /** Which halves of the camp they signed up to serve. Empty until they choose. */
  sections: readonly CampSection[];
  disabled?: boolean;
  /**
   * Whether to offer a box for a role that is not on the camp's list.
   *
   * On for administrators only. `desiredRoles` is a list of *jobs the camp
   * runs*, and a public form that lets a stranger invent one produces a roster
   * with "Sports", "sports" and "Sport" on it — the drift the closed section
   * enum exists to avoid. At a desk it is the opposite: the person typing knows
   * the camp, and refusing them a word the settings list happens to lack is how
   * a real answer ends up in the notes field.
   */
  allowOther?: boolean;
  /** 'self' on the public form, 'other' in the drawer. Wording only. */
  voice?: 'self' | 'other';
}

export function WeekRoles({
  config,
  byWeek,
  onChange,
  weeksAttending,
  sections,
  disabled,
  allowOther,
  voice = 'self',
}: WeekRolesProps) {
  const attending = new Set(weeksAttending);

  // In the camp's own order — elementary, then middle school — whichever way
  // round the boxes happened to be ticked, so two records read alike.
  const chosen = CAMP_SECTIONS.filter((section) => sections.includes(section));

  // Their weeks, in order. A week past the camp's length is still shown if they
  // have days in it, because a camp shortened after somebody signed up has not
  // unsaid what they answered.
  const chosenWeeks = [...attending].sort((a, b) => a - b);

  /*
    Nothing ticked above yet: show everything the camp runs rather than a
    sentence promising it.

    Tommy, 2 Sep 2026: *"it is not listing out the roles for the servant."* He
    was looking at the top of the form, where both of the questions this used to
    wait on — which half, which weeks — were still unanswered, so the section
    was a paragraph. Two of them, in fact, one after the other as each was
    answered. A form that says the jobs will appear later is a form that has
    hidden what a servant came to read: somebody deciding whether to sign up at
    all wants to know the camp needs a lifeguard *before* committing to a week.

    So an unanswered question widens the list instead of emptying it — every
    week the camp runs, both halves — and answering it narrows the list down to
    what they actually asked for. Ticking a job here is still an honest answer:
    `desiredRolesByWeek` is keyed by week and section, so a job ticked under a
    week they later drop out of stays keyed to that week and is simply not read,
    and unticking a half still clears its answers on the way out.
  */
  const sectionsShown = chosen.length > 0 ? chosen : CAMP_SECTIONS;
  const weeks =
    chosenWeeks.length > 0
      ? chosenWeeks
      : Array.from({ length: Math.max(1, config.weeks) }, (_unused, index) => index + 1);
  const everything = chosen.length === 0 || chosenWeeks.length === 0;

  return (
    <div className="camp-weekRoles">
      {everything ? (
        <p className="note">
          {voice === 'self'
            ? 'Everything the camp runs, week by week. Tick a half of the camp and your weeks above and this narrows to yours.'
            : 'Every week and both halves, because the record does not say yet. Ticking above narrows this.'}
        </p>
      ) : null}
      {weeks.map((week) => {
        const range = campWeekRangeLabel(config.weekStarts, week);

        return (
          <fieldset className="camp-weekRoles__week" key={week} disabled={disabled}>
            {/*
              The week, said properly.
              ----------------------------------------------------------------
              Tommy: *"what they can sign up for needs to be clearer which week
              it is."* It was a `.camp-field__label` — 13px, small-caps, grey —
              which made the one fact that divides this whole section the
              smallest type in it, and smaller than the half-of-camp headings
              *inside* it. Somebody two screens down a phone had nothing to tell
              them whether these chips were week one's or week two's.

              So it is a heading now, with the dates beside it in the same words
              the weeks question above used, and the block below it is bracketed
              so the eye can see where one week ends.
            */}
            <legend className="camp-weekRoles__legend">
              <strong>Week {week}</strong>
              {range === `Week ${week}` ? null : <span>{range}</span>}
            </legend>

            {sectionsShown.map((section) => {
              const chosen = campDesiredRolesFor({ desiredRolesByWeek: byWeek }, week, section);
              const options = campWeekRoleOptions(config, week, section);
              // Ticked but not offered: a role the camp has since taken off the
              // list, or one an administrator typed. Kept at the end so it can
              // be unticked.
              const extra = chosen.filter((role) => !options.includes(role));

              return (
                /*
                  `data-section` is what colours the half: elementary wears the
                  parish oxblood and middle school the azure, on the heading and
                  on every chip ticked under it. The stylesheet reads it — see
                  `.camp-weekRoles__section[data-section]` — so the two halves
                  are told apart by colour in the same way here, on the servant
                  sign-up's tiles, and in the drawer.
                */
                <div className="camp-weekRoles__section" data-section={section} key={section}>
                  {/*
                    Named only when there are two of them. One half of the camp
                    is the common case, and a heading over a single list is a
                    heading that says what the tick-box above it already said.
                  */}
                  {sectionsShown.length > 1 ? (
                    <p className="camp-weekRoles__half">{campSectionLabel(section)}</p>
                  ) : null}

                  <div className="camp-weekRoles__boxes">
                    {[...options, ...extra].map((role) => (
                      <label
                        className={`camp-chip${chosen.includes(role) ? ' is-on' : ''}`}
                        key={`${section}:${role}`}
                      >
                        <input
                          type="checkbox"
                          checked={chosen.includes(role)}
                          onChange={(event) =>
                            onChange(
                              toggleDesiredRole(byWeek, week, section, role, event.target.checked),
                            )
                          }
                        />
                        <span>{role}</span>
                      </label>
                    ))}
                  </div>

                  {allowOther ? (
                    <OtherRole
                      disabled={disabled}
                      onAdd={(role) => onChange(toggleDesiredRole(byWeek, week, section, role, true))}
                    />
                  ) : null}
                </div>
              );
            })}

          </fieldset>
        );
      })}
    </div>
  );
}

/**
 * A role that is not on the camp's list, added by whoever is at the desk.
 *
 * Held locally and committed on Enter or on the button rather than on every
 * keystroke, because a role added per character puts "S", "Sp", "Spo" on
 * somebody's record — the same reason `TextSetting` in the settings panel
 * saves on blur. Committing clears the box, so the next one can be typed
 * straight away.
 */
function OtherRole({
  onAdd,
  disabled,
}: {
  onAdd: (role: string) => void;
  disabled: boolean | undefined;
}) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const role = draft.trim();
    if (!role) return;
    onAdd(role);
    setDraft('');
  };

  return (
    <span className="camp-weekRoles__other">
      <input
        className="input input--narrow"
        value={draft}
        disabled={disabled}
        placeholder="Something else"
        aria-label="Add a role that is not on the list"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commit();
        }}
      />
      <button
        type="button"
        className="button button--quiet"
        disabled={disabled || !draft.trim()}
        onClick={commit}
      >
        Add
      </button>
    </span>
  );
}
