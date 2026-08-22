'use client';

import { useEffect, useState } from 'react';
import { type DocOf, type Program } from '@spsm/shared';
import { getEventsPageConfig } from '@/lib/config';
import { listProgramsForAdmin, setMainSection } from './adminData';

/**
 * The parish's main section: one ministry, chosen on `/events` and stored in
 * `config/events`.
 *
 * The page-wide setting the properties column on this page did not have. Every
 * other control here belongs to a ministry — its name, its blurb, whether it is
 * visible — and this one belongs to the parish, which is why it is the only thing
 * in the panel when nothing is selected.
 *
 * ## What it is for, since nothing on the public page changes
 *
 * Nothing visible moves when this is set, and that is not an oversight — see
 * `EventsPageConfig.mainSection`. It is read by what comes next: the NFC tags,
 * which mean "the thing happening now" and cannot be reprogrammed every week, and
 * the forms behind them, which have to file what they collect somewhere. The tag
 * points at a route, the route reads this, and the parish changes it here.
 *
 * Said on screen too, in the note under the field. A control whose effect is
 * invisible and unexplained is one somebody sets, sees nothing happen, and sets
 * back.
 *
 * ## Ministries only
 *
 * This offered every level of every ministry's tree for about an hour — the whole
 * of Summercamp, or Week 1 2026, or Day 3 of it, indented by depth the way the
 * upload form's picker is. Narrowed to the five ministries at Tommy's direction,
 * and the narrower control is the better one: a tag screwed to a wall wants an
 * answer that stays true for a season, and a `<select>` of two hundred days is one
 * where the right answer is hard to find and stale a week later.
 *
 * What went with it is worth naming, so it is not rebuilt by halves — the tree
 * read (`listWholeProgramTree`, one query for every level in the parish) and the
 * `{ programId, programEventId }` pointer it was stored as. This reads the
 * programs it already needs and stores an id. See the field's own note on why a
 * level, if one is ever wanted, is a second field rather than a wider one.
 */
export function MainSectionField() {
  const [programs, setPrograms] = useState<DocOf<Program>[] | null>(null);
  /**
   * `undefined` until the setting has been read.
   *
   * Distinguished from `null` — "nobody has chosen one" — because a `<select>`
   * rendered before the answer arrives would show "None" for a moment and then
   * jump, which reads as the control having cleared itself.
   */
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    void (async () => {
      try {
        const [listed, config] = await Promise.all([
          listProgramsForAdmin(),
          getEventsPageConfig(),
        ]);
        if (!live) return;
        setPrograms(listed);
        setChosen(config.mainSection);
      } catch (caught) {
        if (!live) return;
        console.error('[programs] could not read the main section:', caught);
        setError('The ministries could not be read, so there is nothing to choose from.');
      }
    })();

    return () => {
      live = false;
    };
  }, []);

  /**
   * The chosen ministry, or `null` when the id no longer resolves.
   *
   * A pointer at a deleted ministry is an expected state, not a fault: it can be
   * removed from this very page by somebody who has never looked at this field.
   * The control says so rather than silently showing "None" — which would look
   * like the setting had never been made, and would be undone by the next person
   * who touched it.
   */
  const chosenProgram =
    chosen && programs ? (programs.find((program) => program.id === chosen) ?? null) : null;
  const stale = Boolean(chosen) && programs !== null && chosenProgram === null;

  async function choose(id: string) {
    const next = id === '' ? null : id;
    const previous = chosen ?? null;

    // Optimistic, like every other control in this panel: the write is one small
    // document and the alternative is a select that ignores you until it lands.
    setChosen(next);
    setSaving(true);
    setError(null);
    try {
      await setMainSection(next);
    } catch (caught) {
      console.error('[programs] could not set the main section:', caught);
      setChosen(previous);
      setError(
        'That could not be saved. Only a superadmin may change this setting — if you are one, ' +
          'the connection or the rules refused it.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="inspector__body">
      <label className="inspector__field">
        <span>Main section</span>
        <select
          value={chosen ?? ''}
          disabled={programs === null || saving}
          onChange={(change) => void choose(change.target.value)}
        >
          <option value="">
            {chosen === undefined ? 'Reading…' : 'None — nothing is pointed at'}
          </option>

          {/*
            The stale pointer, kept as an option so the control can show what is
            actually stored. Without it the `<select>` falls back to "None" and
            reports something untrue about the document.
          */}
          {stale && chosen && <option value={chosen}>{chosen} — no longer exists</option>}

          {(programs ?? []).map((program) => (
            <option key={program.id} value={program.id}>
              {program.name}
              {program.published ? '' : ' (not visible yet)'}
            </option>
          ))}
        </select>
      </label>

      {stale ? (
        <p className="inspector__note">
          The ministry this pointed at has been deleted. Anything reading it falls back as
          though nothing were chosen — pick another, or leave it as None.
        </p>
      ) : (
        <p className="inspector__note">
          {chosenProgram ? `Pointing at ${chosenProgram.name}. ` : 'Nothing is pointed at. '}
          Nothing on this page looks different for it. It is what a tap on an NFC tag means
          by &ldquo;now&rdquo;, and where a form behind one files what it collects — so it is
          worth changing when the ministry the parish is running changes.
        </p>
      )}

      {saving && <p className="inspector__note">Saving…</p>}
      {error && <p className="inline-editor__error">{error}</p>}
    </div>
  );
}
