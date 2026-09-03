'use client';

import { useState } from 'react';
import {
  CAMP_SECTIONS,
  allocationWorkbookName,
  campSectionLabel,
  campWeekRangeLabel,
  type CampConfig,
  type CampSection,
} from '@spsm/shared';
import { Icon } from '@/components/Icon';

/**
 * Which sheets do you want.
 *
 * ---------------------------------------------------------------------------
 * Tommy: *"the screen should prompt the admin to know which sheet they want,
 * ie which age group, week etc."*
 *
 * The export used to be one button that saved everything, which was the right
 * shape when the file was one roster of the whole camp. It is not the right
 * shape now: the workbook is a sheet per week per half, so a two-week camp is
 * four sheets, and the person pressing the button almost always wants one of
 * them — the elementary week they are about to go and run. Four tabs, three of
 * which are somebody else's, is a file you have to hunt through before you can
 * print it.
 *
 * So the button asks first, and the answer is in the filename as well as in
 * the workbook: `camp-servants-2027-w1-elementary-2027-06-14.xlsx` beats
 * four identically named files in a downloads folder.
 *
 * **Everything is ticked when it opens.** The dialog is a narrowing, not a
 * form to fill in — somebody who wants the lot presses Download and is done,
 * and nobody has to understand the halves of the camp to get a file out.
 *
 * A plain overlay rather than `<dialog>`, and `.camp-sheet` rather than its own
 * classes: the preview pane never delivers a dialog's `close` event, so a
 * `<dialog>` here is a thing that cannot be verified, and the person card on
 * the groups board already established what a camp overlay looks like.
 * ---------------------------------------------------------------------------
 */
export function ExportSheet({
  config,
  season,
  onClose,
  onPick,
}: {
  config: CampConfig;
  season: string;
  onClose: () => void;
  onPick: (weeks: number[], sections: CampSection[]) => void;
}) {
  const available = Array.from(
    { length: Math.max(1, config.weeks) },
    (_unused, index) => index + 1,
  );

  const [weeks, setWeeks] = useState<number[]>(available);
  const [sections, setSections] = useState<CampSection[]>([...CAMP_SECTIONS]);

  /*
   * Nothing ticked is refused rather than quietly meaning everything.
   *
   * The shared layout treats an empty choice as "all of it", which is right for
   * a caller that never asked the question — the Function will not have a
   * dialog. Here somebody has just unticked their last box, and handing them
   * the whole camp is the one thing they have said they do not want.
   */
  const count = weeks.length * sections.length;
  const filename = allocationWorkbookName(season, new Date(), { weeks, sections });

  return (
    <div
      className="camp-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Which sheets do you want"
      onClick={onClose}
    >
      <div className="camp-sheet__card" onClick={(event) => event.stopPropagation()}>
        <header className="camp-sheet__head">
          <div>
            <p className="camp-sheet__kind">Download .xlsx</p>
            <h2>Which sheets do you want?</h2>
          </div>
          <button type="button" className="camp-sheet__close" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>

        <p className="note camp-export__note">
          Every servant, the group they are with, and the grades that group covers — one sheet
          for each week and half of the camp you tick.
        </p>

        <div className="camp-export">
          <fieldset className="camp-export__pick">
            <legend>Weeks</legend>
            <div className="camp-export__boxes">
              {available.map((week) => {
                const range = campWeekRangeLabel(config.weekStarts, week);
                return (
                  <label
                    className={`camp-chip${weeks.includes(week) ? ' is-on' : ''}`}
                    key={week}
                  >
                    <input
                      type="checkbox"
                      checked={weeks.includes(week)}
                      onChange={(event) =>
                        // Functional, because these are pressed in a run and a
                        // fast run of clicks collapses to one otherwise.
                        setWeeks((current) =>
                          event.target.checked
                            ? [...current, week].sort((left, right) => left - right)
                            : current.filter((entry) => entry !== week),
                        )
                      }
                    />
                    <span>
                      Week {week}
                      {range === `Week ${week}` ? null : (
                        <small className="camp-export__when">{range}</small>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="camp-export__pick">
            <legend>Halves of the camp</legend>
            <div className="camp-export__boxes">
              {CAMP_SECTIONS.map((section) => (
                <label
                  className={`camp-chip${sections.includes(section) ? ' is-on' : ''}`}
                  key={section}
                  data-section={section}
                >
                  <input
                    type="checkbox"
                    checked={sections.includes(section)}
                    onChange={(event) =>
                      setSections((current) =>
                        event.target.checked
                          ? CAMP_SECTIONS.filter(
                              (entry) => entry === section || current.includes(entry),
                            )
                          : current.filter((entry) => entry !== section),
                      )
                    }
                  />
                  <span>{campSectionLabel(section)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <footer className="camp-sheet__foot camp-export__foot">
          <p className="note">
            {count === 0 ? (
              'Tick at least one week and one half of the camp.'
            ) : (
              <>
                {count} sheet{count === 1 ? '' : 's'} · <code>{filename}</code>
              </>
            )}
          </p>
          <button
            type="button"
            className="button"
            disabled={count === 0}
            onClick={() => onPick(weeks, sections)}
          >
            Download
          </button>
        </footer>
      </div>
    </div>
  );
}
