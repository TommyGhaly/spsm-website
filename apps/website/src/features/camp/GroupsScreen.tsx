'use client';

import { useMemo, useState } from 'react';
import {
  CAMP_COLOURS,
  CAMP_GRADES,
  CAMP_SECTIONS,
  MAX_GROUPS_PER_BAND,
  blankBand,
  blankGroup,
  blankStation,
  campColour,
  campGradeLabel,
  campGradeShort,
  campSectionForGrade,
  campSectionLabel,
  dealBand,
  dropDangling,
  nextCampColour,
  placeChild,
  placeServant,
  setLeader,
  suggestBandName,
  suggestGroupName,
  type CampBand,
  type CampColour,
  type CampDropTarget,
  type CampGrade,
  type CampPerson,
  type CampPersonKey,
  type CampSection,
  type CampStation,
} from '@spsm/shared';
import { CampError, CampLoading, CampShell } from './CampShell';
import { downloadAllocationWorkbook } from './exportWorkbook';
import { useCampAdmin } from './useCampAdmin';
import { useGroups } from './useGroups';

/**
 * The groups board, at /admin/camp/groups.
 *
 * ---------------------------------------------------------------------------
 * **One band at a time, and one set of groups for the whole camp.**
 *
 * This is the third design of this screen and the first simple one. What came
 * before had all nine grade panels on screen at once as a strip of cards, any
 * two of which could be *merged* into a saved band; a sliding switch between
 * elementary and middle school; a sticky rail; a separate stations page; and
 * the whole of it duplicated per week of camp, with a `linked` flag and a
 * structure-sync that pushed week one's names and colours onto week two while
 * leaving each week's placements alone. Every one of those was a real answer to
 * a real question, and together they made a screen nobody could hold in their
 * head. Tommy scrapped it: *"so complicated for such a simple task."*
 *
 * What is left is the task. A band is a set of grades run together — you make
 * it and name it. It holds groups. You drag children into groups. That is the
 * whole model, and the screen shows exactly one band's worth of it at a time:
 * the children who belong to that band on the left, its groups on the right.
 *
 * Three things went and are not coming back: **merging** (make the band you
 * want in the first place), **per-week boards** (a child is in one group all
 * summer; which weeks they come is on their registration and the register reads
 * it), and the **week sync** that existed only to serve the second of those.
 *
 * ## Placing without dragging
 *
 * Every chip can be dragged, and every chip can also be **tapped to pick up**
 * and then dropped by tapping a group. That is not a nicety: HTML5 drag and
 * drop does not exist on a touchscreen, and this screen gets opened on an iPad
 * at a table. One code path — `place` — serves both, so the two cannot drift.
 * ---------------------------------------------------------------------------
 */

export function GroupsScreen() {
  const session = useCampAdmin();
  const { canEdit, config, uid } = session;
  const state = useGroups(config.programId, config.season, uid, canEdit);
  const { draft, resolved, people, edit, readOnly } = state;

  /** Which band is on screen, or the stations. */
  const [openId, setOpenId] = useState<string | 'stations' | null>(null);
  /** Somebody tapped a chip and has not put it down yet. */
  const [holding, setHolding] = useState<CampPersonKey | null>(null);
  const [editingBand, setEditingBand] = useState(false);
  const [names, setNames] = useState<string | null>(null);

  const bands = draft?.bands ?? [];
  const open = openId === 'stations' ? 'stations' : bands.find((band) => band.id === openId) ?? bands[0] ?? null;
  const openBand = open === 'stations' ? null : open;

  /** Everybody this band could take: its grades' children, plus its section's servants. */
  const pool = useMemo(() => {
    if (!resolved) return { children: [], servants: [] as CampPerson[] };
    if (open === 'stations') {
      return { children: [] as CampPerson[], servants: resolved.freeServants };
    }
    if (!openBand) return { children: [] as CampPerson[], servants: [] as CampPerson[] };

    const grades = new Set(openBand.grades);
    const children = resolved.freeChildren.filter(
      (person) => grades.size === 0 || (person.grade !== null && grades.has(person.grade)),
    );
    const section = sectionOf(openBand.grades);
    const servants = resolved.freeServants.filter(
      (person) => section === null || person.sections.length === 0 || person.sections.includes(section),
    );
    return { children, servants };
  }, [resolved, open, openBand]);

  function place(key: CampPersonKey, target: CampDropTarget) {
    const person = resolved?.byKey.get(key);
    if (!person) return;
    edit((current) =>
      person.kind === 'child' ? placeChild(current, key, target) : placeServant(current, key, target),
    );
    setHolding(null);
  }

  if (!canEdit || state.loading) {
    return (
      <CampShell session={session} tab="groups" title="Summer camp">
        {state.error ? <CampError error={state.error} /> : <CampLoading what="the camp" />}
      </CampShell>
    );
  }

  return (
    <CampShell
      session={session}
      tab="groups"
      title="Summer camp"
      actions={
        <>
          {state.dirty ? <span className="camp-unsaved">Unsaved</span> : null}
          <button
            type="button"
            className="button"
            disabled={!state.dirty || state.saving || readOnly}
            onClick={() => void state.save()}
          >
            {state.saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {state.error ? <CampError error={state.error} /> : null}

      {state.conflictWith ? (
        <section className="band camp-band">
          <div className="wrap camp-wrap">
            <div className="notice notice--warn">
              <h2>Somebody else has saved this</h2>
              <p>
                The arrangement changed on another device while you were working. Two boards
                edited apart cannot be merged without inventing an arrangement neither of you
                made, so nothing has been touched here.
              </p>
              <p>
                <button type="button" className="button" onClick={state.takeTheirs}>
                  Take theirs and lose my changes
                </button>{' '}
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => void state.save()}
                >
                  Keep mine and overwrite
                </button>
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {readOnly ? (
        <section className="band camp-band">
          <div className="wrap camp-wrap">
            <p className="note">
              Summer {config.season} is frozen, so nothing here can be moved. Reopen it on{' '}
              <a href="/admin/camp">the camp screen</a>.
            </p>
          </div>
        </section>
      ) : null}

      <section className="band camp-band">
        <div className="wrap camp-wrap">
          <div className="camp-bands">
            {bands.map((band) => (
              <button
                key={band.id}
                type="button"
                className={`camp-bandPill${open !== 'stations' && openBand?.id === band.id ? ' is-on' : ''}`}
                style={
                  {
                    '--camp-colour': campColour(band.colour).hex,
                    '--camp-ink': campColour(band.colour).ink,
                  } as React.CSSProperties
                }
                onClick={() => {
                  setOpenId(band.id);
                  setEditingBand(false);
                }}
              >
                {band.name}
                <em>{countIn(band)}</em>
              </button>
            ))}

            <button
              type="button"
              className={`camp-bandPill camp-bandPill--plain${open === 'stations' ? ' is-on' : ''}`}
              onClick={() => setOpenId('stations')}
            >
              Stations
              <em>{draft?.stations.length ?? 0}</em>
            </button>

            {!readOnly ? (
              <AddBand
                taken={bands.map((band) => band.colour)}
                existing={bands}
                onAdd={(band) => {
                  edit((current) => ({ ...current, bands: [...current.bands, band] }));
                  setOpenId(band.id);
                }}
              />
            ) : null}
          </div>

          {bands.length === 0 && open !== 'stations' ? (
            <div className="camp-empty camp-empty--big">
              <p>
                No bands yet. A band is a set of grades run together — &ldquo;3rd &amp; 4th&rdquo;,
                or a grade on its own — and it holds the groups the children go into.
              </p>
              <p className="note">Make one above to start.</p>
            </div>
          ) : null}
        </div>
      </section>

      {open === 'stations' ? (
        <Stations
          stations={draft?.stations ?? []}
          resolved={resolved}
          pool={pool.servants}
          holding={holding}
          readOnly={readOnly}
          onHold={setHolding}
          onPlace={place}
          onEdit={edit}
        />
      ) : openBand ? (
        <Board
          band={openBand}
          resolved={resolved}
          pool={pool}
          holding={holding}
          readOnly={readOnly}
          editing={editingBand}
          onEditing={setEditingBand}
          onHold={setHolding}
          onPlace={place}
          onEdit={edit}
          people={people}
        />
      ) : null}

      <section className="band camp-band">
        <div className="wrap camp-wrap camp-tools">
          <button
            type="button"
            className="button button--quiet"
            onClick={() =>
              draft &&
              downloadAllocationWorkbook({
                allocation: draft,
                registrations: state.registrations,
                generatedBy: uid ?? '',
              })
            }
          >
            Download .xlsx
          </button>

          <button
            type="button"
            className="button button--quiet"
            disabled={readOnly}
            onClick={() => {
              void state.publishNames().then((written) => {
                setNames(
                  written === 0
                    ? 'Every registration already says the right group.'
                    : `Wrote the group onto ${written} registration${written === 1 ? '' : 's'}.`,
                );
              });
            }}
          >
            Write groups onto registrations
          </button>

          {resolved && resolved.dangling.length > 0 && !readOnly ? (
            <button
              type="button"
              className="camp-danger"
              onClick={() =>
                edit((current) => dropDangling(current, people))
              }
            >
              Clear {resolved.dangling.length} placement
              {resolved.dangling.length === 1 ? '' : 's'} matching nobody
            </button>
          ) : null}

          {names ? <p className="note">{names}</p> : null}
        </div>
      </section>
    </CampShell>
  );
}

/* ---------------------------------------------------------------------------
 * One band's board
 * ------------------------------------------------------------------------ */

function Board({
  band,
  resolved,
  pool,
  holding,
  readOnly,
  editing,
  onEditing,
  onHold,
  onPlace,
  onEdit,
  people,
}: {
  band: CampBand;
  resolved: ReturnType<typeof import('@spsm/shared').resolveAllocation> | null;
  pool: { children: CampPerson[]; servants: CampPerson[] };
  holding: CampPersonKey | null;
  readOnly: boolean;
  editing: boolean;
  onEditing: (on: boolean) => void;
  onHold: (key: CampPersonKey | null) => void;
  onPlace: (key: CampPersonKey, target: CampDropTarget) => void;
  onEdit: GroupEdit;
  people: readonly CampPerson[];
}) {
  const colour = campColour(band.colour);
  const style = { '--camp-colour': colour.hex, '--camp-ink': colour.ink } as React.CSSProperties;

  const patch = (change: (current: CampBand) => CampBand) =>
    onEdit((current) => ({
      ...current,
      bands: current.bands.map((entry) => (entry.id === band.id ? change(entry) : entry)),
    }));

  return (
    <section className="band camp-band">
      <div className="wrap camp-wrap">
        <header className="camp-boardHead" style={style}>
          <div>
            <h2>{band.name}</h2>
            <p className="note">
              {band.grades.length === 0
                ? 'No grades chosen — every unplaced child is offered.'
                : band.grades.map(campGradeLabel).join(', ')}
            </p>
          </div>
          {!readOnly ? (
            <div className="camp-boardHead__actions">
              <button
                type="button"
                className="button button--quiet"
                onClick={() => onEdit((current) => dealBand(current, band.id, people))}
                disabled={band.groups.length === 0}
                title="Deal the children who are in no group evenly across this band's groups"
              >
                Deal evenly
              </button>
              <button type="button" className="button button--quiet" onClick={() => onEditing(!editing)}>
                {editing ? 'Done' : 'Edit band'}
              </button>
            </div>
          ) : null}
        </header>

        {editing && !readOnly ? (
          <BandSettings band={band} onPatch={patch} onDelete={() => onEdit((current) => ({
            ...current,
            bands: current.bands.filter((entry) => entry.id !== band.id),
          }))} />
        ) : null}

        <div className="camp-board">
          <Rail
            title="Not in a group"
            children={pool.children}
            servants={pool.servants}
            holding={holding}
            readOnly={readOnly}
            onHold={onHold}
            onDropHere={(key) => onPlace(key, null)}
          />

          <div className="camp-groups">
            {band.groups.map((group) => (
              <GroupColumn
                key={group.id}
                bandId={band.id}
                group={group}
                style={style}
                resolved={resolved}
                holding={holding}
                readOnly={readOnly}
                onHold={onHold}
                onPlace={onPlace}
                onPatch={patch}
                onLeader={(key) =>
                  onEdit((current) =>
                    setLeader(current, { kind: 'group', bandId: band.id, groupId: group.id }, key),
                  )
                }
              />
            ))}

            {!readOnly && band.groups.length < MAX_GROUPS_PER_BAND ? (
              <button
                type="button"
                className="camp-addGroup"
                onClick={() =>
                  patch((current) => ({
                    ...current,
                    groups: [...current.groups, blankGroup(suggestGroupName(current.groups))],
                  }))
                }
              >
                + Add a group
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

type GroupEdit = (change: (current: import('@spsm/shared').CampAllocationDraft) => import('@spsm/shared').CampAllocationDraft) => void;

function BandSettings({
  band,
  onPatch,
  onDelete,
}: {
  band: CampBand;
  onPatch: (change: (current: CampBand) => CampBand) => void;
  onDelete: () => void;
}) {
  return (
    <div className="camp-bandEdit">
      <label className="camp-field">
        <span className="camp-field__label">Name</span>
        <input
          className="input"
          value={band.name}
          onChange={(event) => onPatch((current) => ({ ...current, name: event.target.value }))}
        />
      </label>

      <fieldset className="camp-gradePick">
        <legend className="camp-field__label">Grades in this band</legend>
        {CAMP_GRADES.map((grade) => {
          const on = band.grades.includes(grade);
          return (
            <label key={grade} className={`camp-gradeBox${on ? ' is-on' : ''}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={() =>
                  onPatch((current) => {
                    const grades = on
                      ? current.grades.filter((entry) => entry !== grade)
                      : ([...current.grades, grade] as CampGrade[]);
                    /*
                     * The name follows the grades until somebody types their
                     * own. Comparing against the suggestion for the *old* set
                     * is what tells those apart: "3rd grade" was ours, "The
                     * Cherubim" was theirs, and only ours may be replaced.
                     */
                    const wasOurs = current.name === suggestBandName(current.grades);
                    return {
                      ...current,
                      grades,
                      name: wasOurs ? suggestBandName(grades) : current.name,
                    };
                  })
                }
              />
              <span>{campGradeShort(grade)}</span>
            </label>
          );
        })}
      </fieldset>

      <label className="camp-field">
        <span className="camp-field__label">Colour</span>
        <select
          className="input input--narrow"
          value={band.colour}
          onChange={(event) =>
            onPatch((current) => ({ ...current, colour: event.target.value as CampColour }))
          }
        >
          {CAMP_COLOURS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
        <span className="camp-field__hint">
          The whole band is one colour — every group in it wears it. It is how a child finds
          their group in a hall, so it has to be told apart at three metres.
        </span>
      </label>

      <button
        type="button"
        className="camp-danger"
        onClick={() => {
          if (
            window.confirm(
              `Delete ${band.name}? Everybody in its groups goes back to the waiting list. ` +
                `Nothing about their registrations changes.`,
            )
          ) {
            onDelete();
          }
        }}
      >
        Delete this band
      </button>
    </div>
  );
}

function AddBand({
  taken,
  existing,
  onAdd,
}: {
  taken: readonly CampColour[];
  existing: readonly CampBand[];
  onAdd: (band: CampBand) => void;
}) {
  const [open, setOpen] = useState(false);
  const [grades, setGrades] = useState<CampGrade[]>([]);

  if (!open) {
    return (
      <button type="button" className="camp-bandPill camp-bandPill--add" onClick={() => setOpen(true)}>
        + Add a band
      </button>
    );
  }

  const already = new Set(existing.flatMap((band) => band.grades));

  return (
    <div className="camp-newBand">
      <p className="camp-field__label">Which grades run together?</p>
      <div className="camp-gradePick">
        {CAMP_GRADES.map((grade) => {
          const on = grades.includes(grade);
          return (
            <label key={grade} className={`camp-gradeBox${on ? ' is-on' : ''}${already.has(grade) ? ' is-spoken' : ''}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={() =>
                  setGrades((current) =>
                    on ? current.filter((entry) => entry !== grade) : [...current, grade],
                  )
                }
              />
              <span>{campGradeShort(grade)}</span>
            </label>
          );
        })}
      </div>
      <p className="camp-field__hint">
        A grade already in another band is faded. Nothing stops you using it twice — a child
        can only be in one group either way — but it is usually a mistake.
      </p>
      <div className="camp-add">
        <button
          type="button"
          className="button"
          disabled={grades.length === 0}
          onClick={() => {
            const ordered = CAMP_GRADES.filter((grade) => grades.includes(grade));
            const band = blankBand(suggestBandName(ordered), ordered, nextCampColour(taken));
            // One group to start, because a band with none has nowhere to drop
            // anybody and reads as broken.
            band.groups = [blankGroup('Group 1')];
            onAdd(band);
            setGrades([]);
            setOpen(false);
          }}
        >
          Make the band
        </button>
        <button type="button" className="button button--quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Columns and chips
 * ------------------------------------------------------------------------ */

function GroupColumn({
  bandId,
  group,
  style,
  resolved,
  holding,
  readOnly,
  onHold,
  onPlace,
  onPatch,
  onLeader,
}: {
  bandId: string;
  group: import('@spsm/shared').CampGroup;
  style: React.CSSProperties;
  resolved: ReturnType<typeof import('@spsm/shared').resolveAllocation> | null;
  holding: CampPersonKey | null;
  readOnly: boolean;
  onHold: (key: CampPersonKey | null) => void;
  onPlace: (key: CampPersonKey, target: CampDropTarget) => void;
  onPatch: (change: (current: CampBand) => CampBand) => void;
  onLeader: (key: CampPersonKey) => void;
}) {
  const target: CampDropTarget = { kind: 'group', bandId, groupId: group.id };
  const children = group.childKeys.map((key) => resolved?.byKey.get(key)).filter(Boolean) as CampPerson[];
  const servants = group.servantKeys.map((key) => resolved?.byKey.get(key)).filter(Boolean) as CampPerson[];

  return (
    <section
      className={`camp-group${holding ? ' is-target' : ''}`}
      style={style}
      onDragOver={(event) => {
        if (readOnly) return;
        event.preventDefault();
      }}
      onDrop={(event) => {
        if (readOnly) return;
        event.preventDefault();
        const key = event.dataTransfer.getData('text/plain');
        if (key) onPlace(key, target);
      }}
      onClick={() => {
        if (holding && !readOnly) onPlace(holding, target);
      }}
    >
      <header className="camp-group__head">
        <input
          className="camp-group__name"
          value={group.name}
          readOnly={readOnly}
          aria-label="Group name"
          onChange={(event) =>
            onPatch((current) => ({
              ...current,
              groups: current.groups.map((entry) =>
                entry.id === group.id ? { ...entry, name: event.target.value } : entry,
              ),
            }))
          }
        />
        <span className="camp-group__count">
          {children.length} · {servants.length} serving
        </span>
      </header>

      <ul className="camp-chips">
        {servants.map((person) => (
          <Chip
            key={person.key}
            person={person}
            holding={holding}
            readOnly={readOnly}
            onHold={onHold}
            leader={group.leaderKey === person.key}
            onLeader={() => onLeader(person.key)}
          />
        ))}
        {children.map((person) => (
          <Chip key={person.key} person={person} holding={holding} readOnly={readOnly} onHold={onHold} />
        ))}
      </ul>

      {children.length === 0 && servants.length === 0 ? (
        <p className="camp-group__empty">
          {holding ? 'Tap here to put them in' : 'Drag somebody in'}
        </p>
      ) : null}

      {!readOnly ? (
        <button
          type="button"
          className="camp-group__delete"
          onClick={(event) => {
            event.stopPropagation();
            if (
              children.length + servants.length > 0 &&
              !window.confirm(`Delete ${group.name}? Everybody in it goes back to the waiting list.`)
            ) {
              return;
            }
            onPatch((current) => ({
              ...current,
              groups: current.groups.filter((entry) => entry.id !== group.id),
            }));
          }}
        >
          Delete group
        </button>
      ) : null}
    </section>
  );
}

function Rail({
  title,
  children,
  servants,
  holding,
  readOnly,
  onHold,
  onDropHere,
}: {
  title: string;
  children: CampPerson[];
  servants: CampPerson[];
  holding: CampPersonKey | null;
  readOnly: boolean;
  onHold: (key: CampPersonKey | null) => void;
  onDropHere: (key: CampPersonKey) => void;
}) {
  return (
    <aside
      className="camp-rail"
      onDragOver={(event) => {
        if (!readOnly) event.preventDefault();
      }}
      onDrop={(event) => {
        if (readOnly) return;
        event.preventDefault();
        const key = event.dataTransfer.getData('text/plain');
        if (key) onDropHere(key);
      }}
      onClick={() => {
        if (holding && !readOnly) onDropHere(holding);
      }}
    >
      <h3>
        {title} <em>{children.length + servants.length}</em>
      </h3>

      {children.length + servants.length === 0 ? (
        <p className="note">Everybody in this band has a group.</p>
      ) : null}

      {servants.length > 0 ? (
        <>
          <h4>Servants</h4>
          <ul className="camp-chips">
            {servants.map((person) => (
              <Chip key={person.key} person={person} holding={holding} readOnly={readOnly} onHold={onHold} />
            ))}
          </ul>
        </>
      ) : null}

      {children.length > 0 ? (
        <>
          <h4>Children</h4>
          <ul className="camp-chips">
            {children.map((person) => (
              <Chip key={person.key} person={person} holding={holding} readOnly={readOnly} onHold={onHold} />
            ))}
          </ul>
        </>
      ) : null}

      {holding ? <p className="camp-rail__hint">Tap a group to put them in, or tap here to take them out.</p> : null}
    </aside>
  );
}

/**
 * One person, draggable and tappable.
 *
 * The leader star is a **sibling** of the chip's own button rather than nested
 * inside it: a control inside a `draggable` element sometimes starts a drag
 * instead of firing, which is the other face of pointer capture eating clicks.
 */
function Chip({
  person,
  holding,
  readOnly,
  onHold,
  leader,
  onLeader,
}: {
  person: CampPerson;
  holding: CampPersonKey | null;
  readOnly: boolean;
  onHold: (key: CampPersonKey | null) => void;
  leader?: boolean;
  onLeader?: () => void;
}) {
  const held = holding === person.key;

  return (
    <li className={`camp-chip${held ? ' is-held' : ''}${person.withdrawn ? ' is-out' : ''}`}>
      <button
        type="button"
        className="camp-chip__grab"
        draggable={!readOnly}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', person.key);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (readOnly) return;
          onHold(held ? null : person.key);
        }}
      >
        <span className="camp-chip__name">{person.name || 'Unnamed'}</span>
        <span className="camp-chip__meta">
          {person.kind === 'child'
            ? person.grade
              ? campGradeShort(person.grade)
              : '—'
            : person.age !== null
              ? `${person.age}`
              : 'servant'}
          {person.allergies.trim() ? <span className="camp-chip__flag" title={person.allergies}>allergy</span> : null}
          {person.withdrawn ? <span className="camp-chip__flag">withdrawn</span> : null}
        </span>
      </button>

      {onLeader ? (
        <button
          type="button"
          className={`camp-chip__lead${leader ? ' is-on' : ''}`}
          aria-label={leader ? 'Not the leader' : 'Make them the leader'}
          aria-pressed={leader}
          disabled={readOnly}
          onClick={(event) => {
            event.stopPropagation();
            onLeader();
          }}
        >
          ★
        </button>
      ) : null}
    </li>
  );
}

/* ---------------------------------------------------------------------------
 * Stations
 * ------------------------------------------------------------------------ */

/**
 * The activities, and the servants who run them.
 *
 * A station belongs to a section — elementary runs its own sports and middle
 * school runs its own, at different times, in different rooms — which is stored
 * rather than derived, because unlike a child's section there is nothing to
 * derive it from. There is no timetable here on purpose: this records who is on
 * crafts, not which group is where at eleven o'clock.
 */
function Stations({
  stations,
  resolved,
  pool,
  holding,
  readOnly,
  onHold,
  onPlace,
  onEdit,
}: {
  stations: readonly CampStation[];
  resolved: ReturnType<typeof import('@spsm/shared').resolveAllocation> | null;
  pool: CampPerson[];
  holding: CampPersonKey | null;
  readOnly: boolean;
  onHold: (key: CampPersonKey | null) => void;
  onPlace: (key: CampPersonKey, target: CampDropTarget) => void;
  onEdit: GroupEdit;
}) {
  const patch = (id: string, change: (current: CampStation) => CampStation) =>
    onEdit((current) => ({
      ...current,
      stations: current.stations.map((entry) => (entry.id === id ? change(entry) : entry)),
    }));

  return (
    <section className="band camp-band">
      <div className="wrap camp-wrap">
        <div className="camp-board">
          <Rail
            title="Servants with no place"
            children={[]}
            servants={pool}
            holding={holding}
            readOnly={readOnly}
            onHold={onHold}
            onDropHere={(key) => onPlace(key, null)}
          />

          <div className="camp-groups">
            {stations.map((station) => {
              const colour = campColour(station.colour);
              const style = {
                '--camp-colour': colour.hex,
                '--camp-ink': colour.ink,
              } as React.CSSProperties;
              const servants = station.servantKeys
                .map((key) => resolved?.byKey.get(key))
                .filter(Boolean) as CampPerson[];

              return (
                <section
                  key={station.id}
                  className={`camp-group${holding ? ' is-target' : ''}`}
                  style={style}
                  onDragOver={(event) => !readOnly && event.preventDefault()}
                  onDrop={(event) => {
                    if (readOnly) return;
                    event.preventDefault();
                    const key = event.dataTransfer.getData('text/plain');
                    if (key) onPlace(key, { kind: 'station', stationId: station.id });
                  }}
                  onClick={() => holding && !readOnly && onPlace(holding, { kind: 'station', stationId: station.id })}
                >
                  <header className="camp-group__head">
                    <input
                      className="camp-group__name"
                      value={station.name}
                      readOnly={readOnly}
                      aria-label="Station name"
                      onChange={(event) =>
                        patch(station.id, (current) => ({ ...current, name: event.target.value }))
                      }
                    />
                    <span className="camp-group__count">{servants.length} serving</span>
                  </header>

                  <div className="camp-station__where">
                    <input
                      className="input input--narrow"
                      value={station.location}
                      readOnly={readOnly}
                      placeholder="Where — the hall, field 2"
                      aria-label="Where this station is"
                      onChange={(event) =>
                        patch(station.id, (current) => ({ ...current, location: event.target.value }))
                      }
                    />
                    <select
                      className="input input--narrow"
                      value={station.section}
                      disabled={readOnly}
                      aria-label="Which half of the camp runs it"
                      onChange={(event) =>
                        patch(station.id, (current) => ({
                          ...current,
                          section: event.target.value as CampSection,
                        }))
                      }
                    >
                      {CAMP_SECTIONS.map((section) => (
                        <option key={section} value={section}>
                          {campSectionLabel(section)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <ul className="camp-chips">
                    {servants.map((person) => (
                      <Chip
                        key={person.key}
                        person={person}
                        holding={holding}
                        readOnly={readOnly}
                        onHold={onHold}
                        leader={station.leaderKey === person.key}
                        onLeader={() =>
                          onEdit((current) =>
                            setLeader(current, { kind: 'station', stationId: station.id }, person.key),
                          )
                        }
                      />
                    ))}
                  </ul>

                  {servants.length === 0 ? (
                    <p className="camp-group__empty">
                      Nobody is running this. {holding ? 'Tap here to put them on it.' : ''}
                    </p>
                  ) : null}

                  {!readOnly ? (
                    <button
                      type="button"
                      className="camp-group__delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (
                          servants.length > 0 &&
                          !window.confirm(`Delete ${station.name}? Its servants go back to the list.`)
                        ) {
                          return;
                        }
                        onEdit((current) => ({
                          ...current,
                          stations: current.stations.filter((entry) => entry.id !== station.id),
                        }));
                      }}
                    >
                      Delete station
                    </button>
                  ) : null}
                </section>
              );
            })}

            {!readOnly ? (
              <button
                type="button"
                className="camp-addGroup"
                onClick={() =>
                  onEdit((current) => ({
                    ...current,
                    stations: [
                      ...current.stations,
                      blankStation(
                        'New station',
                        nextCampColour(current.stations.map((entry) => entry.colour)),
                        'elementary',
                      ),
                    ],
                  }))
                }
              >
                + Add a station
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Odds
 * ------------------------------------------------------------------------ */

function countIn(band: CampBand): number {
  return band.groups.reduce((sum, group) => sum + group.childKeys.length, 0);
}

/**
 * Elementary, middle school, or neither when a band straddles both.
 *
 * Used to decide which servants a band's waiting list offers — a servant never
 * picks a grade, only which half of the camp they want. `campSectionForGrade`
 * answers null for grade 9 and above by design, so a band containing one is a
 * band with no section and every servant is offered rather than none.
 */
function sectionOf(grades: readonly CampGrade[]): CampSection | null {
  const sections = new Set(
    grades.map(campSectionForGrade).filter((section): section is CampSection => section !== null),
  );
  return sections.size === 1 ? [...sections][0]! : null;
}

