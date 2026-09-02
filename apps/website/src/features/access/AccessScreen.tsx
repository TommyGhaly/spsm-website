'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  isSuperadmin,
  type FinanceScopes,
  type ProgramAdmin,
  type ScreenAdmin,
} from '@spsm/shared';
import { refreshClaims, signIn } from '@/lib/authStore';
import { useScreenGrants } from '@/lib/screenGrants';
import {
  AREA_CAMP,
  AREA_PROGRAMS,
  FINANCE_SOURCE_ROWS,
  SCREEN_AREAS,
  UNOFFERED_LABELS,
  UNOFFERED_SCREENS,
} from './areas';
import {
  emptyAllocation,
  listMembers,
  listPrograms,
  readCampProgramId,
  saveAllocation,
  withFinanceSource,
  withProgram,
  withScreen,
  type AllocatableMember,
  type AllocatableProgram,
} from './data';

/**
 * Who administers what, and the one screen that decides it.
 *
 * ---------------------------------------------------------------------------
 * ## The gap this closes
 *
 * The site had three permission axes for months — `role`, `screenAdmin`,
 * `programAdmin` — and no way to set the last two. `screenAdmin` was written on
 * every member document at sign-in, read by nothing, and could only be changed
 * from the Firebase console. So the only way to let somebody edit the forms was
 * to make them `staff`, which also handed them the bookstore's takings, the
 * parish calendar and every ministry's photographs. Delegation existed in the
 * model and not in practice.
 *
 * The role ladder is now gone entirely, which makes this page the *only* way
 * anybody is given anything. There is no tier that quietly includes an area, so
 * nothing on this site can be reached except by a row on this screen — or by
 * being the superadmin. That is a much stronger claim than the page could make
 * when it was built, and it is the reason the rows are worded as carefully as
 * they are: an area nobody ticks is an area nobody has.
 *
 * ## Superadmin only, and why it is not delegable
 *
 * `superadmin` is one boolean claim, set by `scripts/grant-admin.mjs` and by
 * nothing on this site. This page is gated on it, and the `members` flag is
 * deliberately *not* one of the areas it offers, because the power to grant is
 * the power to grant itself. The gate is a convenience; what actually stops
 * somebody is `allow update: if isSuper()` on `/members/{uid}`, which reads the
 * token and cannot be edited out of a browser.
 *
 * ## Explicit save, against the house style
 *
 * Everything else on this site saves as you type — the events editor autosaves
 * into a pending copy, the shop's cards commit on blur. This has a Save button,
 * and the exception is deliberate: those screens are editing content, where the
 * worst case of a stray keystroke is a typo somebody fixes. Here a stray click
 * is a person who can suddenly read every form submission in the parish, or a
 * servant who quietly lost the ministry they run halfway through a season. A
 * permission change should be a thing you meant to do, and a Save button is the
 * cheapest way to make the boundary between "considering" and "done" visible.
 *
 * ## Not a security boundary
 *
 * The statement every gated screen in this codebase carries. This decides what
 * to draw. `firestore.rules` decides what can be written.
 * ---------------------------------------------------------------------------
 */
export function AccessScreen() {
  const { ready, claims } = useScreenGrants();
  const superadmin = isSuperadmin(claims);

  /*
   * ---------------------------------------------------------------------------
   * The token is asked again before anybody is turned away.
   *
   * `superadmin` is a custom claim, and a claim is frozen into the ID token when
   * it is minted; `onAuthChange` reads it with `forceRefresh` false, and
   * Firebase mints a new one about once an hour. So somebody promoted five
   * minutes ago by `grant-admin.mjs` is still carrying a token that says
   * nothing, and this screen — reading that token, correctly — told them the
   * page was not theirs. Which reads as the promotion having failed, and is the
   * single most confusing way this page can behave.
   *
   * One forced token round trip, once, only when the answer would otherwise be
   * no. Somebody who is already a superadmin never pays for it.
   * ---------------------------------------------------------------------------
   */
  const [recheck, setRecheck] = useState<'idle' | 'running' | 'done'>('idle');

  useEffect(() => {
    // Nothing to re-ask if we do not know yet, if the answer is already yes, or
    // if there is no session at all to refresh a token for.
    if (!ready || superadmin || claims === null || recheck !== 'idle') return;
    setRecheck('running');
    void refreshClaims()
      .catch((error: unknown) => {
        console.warn('[access] could not refresh your sign-in', error);
      })
      .finally(() => setRecheck('done'));
  }, [ready, superadmin, claims, recheck]);

  if (!ready || recheck === 'running') {
    return <p className="note">Checking your sign-in…</p>;
  }

  if (!superadmin) {
    /*
     * One refusal for both "signed out" and "signed in as somebody else", and
     * it now offers a way forward in each case.
     *
     * This deliberately had no sign-in button: the page is unlinked, reached
     * from the account menu of somebody already signed in, and offering sign-in
     * on an unlinked page is an invitation to a door that will not open. That
     * reasoning holds for a stranger who guessed the URL and is worthless for
     * the person this page is *for* — a superadmin who bookmarked it, arrived
     * with no session, and found a flat refusal and no control. The masthead has
     * always had a sign-in circle; expecting somebody to find it after being
     * told no is not a design.
     */
    return (
      <div className="notice notice--alarm" role="alert">
        <h2>Not your area</h2>
        {claims === null ? (
          <>
            <p>Allocating areas is a superadmin&apos;s alone, and you are not signed in.</p>
            <p>
              <button className="button" type="button" onClick={() => void signIn()}>
                Sign in with Microsoft
              </button>
            </p>
          </>
        ) : (
          <>
            <p>
              Allocating areas is a superadmin&apos;s alone, and your sign-in is not marked
              as one.
            </p>
            {/*
              Named plainly, because it is the likeliest cause by a wide margin
              and the fix is thirty seconds. Sign-out and back in mints a new
              token unconditionally; the button above only asks Firebase for one,
              which occasionally returns the cached answer.
            */}
            <p className="note">
              If you were made a superadmin recently, this is what a stale sign-in looks like —
              it travels in a token your browser refreshes about once an hour. Check again, or
              sign out and back in, which always mints a new one.
            </p>
            <p>
              <button
                className="button"
                type="button"
                onClick={() => {
                  setRecheck('running');
                  void refreshClaims()
                    .catch((error: unknown) => {
                      console.warn('[access] could not refresh your sign-in', error);
                    })
                    .finally(() => setRecheck('done'));
                }}
              >
                Check again
              </button>
            </p>
          </>
        )}
      </div>
    );
  }

  return <Allocator />;
}

/* ------------------------------------------------------------------------ */

type Loaded = {
  members: AllocatableMember[];
  programs: AllocatableProgram[];
  campProgramId: string;
};

function Allocator() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  /** The edit in progress. Null until somebody is picked. */
  const [draft, setDraft] = useState<{
    screenAdmin: ScreenAdmin;
    financeScopes: FinanceScopes;
    programAdmin: ProgramAdmin;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedUid, setSavedUid] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        // In parallel: three independent reads, and the slowest of them decides
        // when the screen appears. Sequenced, an administrator would wait for
        // the member list, then the ministries, then a config document.
        const [members, programs, campProgramId] = await Promise.all([
          listMembers(),
          listPrograms(),
          readCampProgramId(),
        ]);
        if (live) setLoaded({ members, programs, campProgramId });
      } catch (error) {
        console.error('[access] could not load the directory', error);
        if (live) {
          setLoadError(
            error instanceof Error ? error.message : 'Could not read the church directory.',
          );
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const selected = useMemo(
    () => loaded?.members.find((member) => member.uid === selectedUid) ?? null,
    [loaded, selectedUid],
  );

  const shown = useMemo(() => {
    if (!loaded) return [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return loaded.members;
    return loaded.members.filter(
      (member) =>
        member.displayName.toLowerCase().includes(needle) ||
        member.email.toLowerCase().includes(needle),
    );
  }, [loaded, filter]);

  function pick(member: AllocatableMember) {
    setSelectedUid(member.uid);
    // A fresh copy of what is stored, so cancelling is closing the panel and
    // editing one person never leaks into the next.
    setDraft({
      screenAdmin: { ...member.screenAdmin },
      financeScopes: { ...member.financeScopes },
      programAdmin: { ...member.programAdmin },
    });
    setSaveError(null);
    setSavedUid(null);
  }

  const dirty = useMemo(() => {
    if (!selected || !draft) return false;
    return (
      JSON.stringify(draft.screenAdmin) !== JSON.stringify(selected.screenAdmin) ||
      JSON.stringify(draft.financeScopes) !== JSON.stringify(selected.financeScopes) ||
      JSON.stringify([...draft.programAdmin.programs].sort()) !==
        JSON.stringify([...selected.programAdmin.programs].sort()) ||
      JSON.stringify([...draft.programAdmin.events].sort()) !==
        JSON.stringify([...selected.programAdmin.events].sort())
    );
  }, [selected, draft]);

  async function save() {
    if (!selected || !draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveAllocation(selected.uid, draft);
      // The in-memory directory is updated rather than re-read: one write, one
      // known result, and re-reading the whole collection to learn what we just
      // wrote is a round trip that can only tell us what we already know.
      setLoaded((current) =>
        current === null
          ? current
          : {
              ...current,
              members: current.members.map((member) =>
                member.uid === selected.uid
                  ? {
                      ...member,
                      screenAdmin: { ...draft.screenAdmin },
                      financeScopes: { ...draft.financeScopes },
                      programAdmin: { ...draft.programAdmin },
                    }
                  : member,
              ),
            },
      );
      setSavedUid(selected.uid);
    } catch (error) {
      console.error('[access] could not save the allocation', error);
      setSaveError(
        error instanceof Error ? error.message : 'The change could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="notice notice--alarm" role="alert">
        <h2>Could not read the directory</h2>
        <p>{loadError}</p>
      </div>
    );
  }

  if (!loaded) return <p className="note">Reading the church directory…</p>;

  return (
    <div className="access">
      <div className="access__people">
        <label className="field access__filter">
          <span>Find someone</span>
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Name or email"
            autoComplete="off"
          />
        </label>

        {shown.length === 0 ? (
          <p className="note">
            {loaded.members.length === 0
              ? 'Nobody has signed in yet, so there is no one to give an area to.'
              : `No one matches “${filter}”.`}
          </p>
        ) : (
          <ul className="access__list">
            {shown.map((member) => (
              <li key={member.uid}>
                <button
                  type="button"
                  className={
                    member.uid === selectedUid
                      ? 'access__person access__person--on'
                      : 'access__person'
                  }
                  onClick={() => pick(member)}
                  aria-current={member.uid === selectedUid}
                >
                  <span className="access__personName">{member.displayName}</span>
                  <span className="access__personMail">{member.email || 'no email on file'}</span>
                  <span className="access__personTally">{tally(member)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="access__panel">
        {!selected || !draft ? (
          <p className="note access__empty">
            Pick somebody to see what they administer, and to change it.
          </p>
        ) : (
          <>
            <header className="access__who">
              <h2>{selected.displayName}</h2>
              <p className="note">{selected.email || 'no email on file'}</p>

              {/*
                What they hold, at the top, before any of the controls.

                The panel is a column of blocks with a tick somewhere in each,
                so "what does this person actually have" was a question you
                answered by scrolling and reading checkboxes. These are the same
                answer as one line — and they are the *saved* state, not the
                draft, so they stay put while you work and are what the Save
                button is measured against.
              */}
              <ul className="access__held">
                {selected.superadmin && <li className="access__heldChip access__heldChip--all">superadmin</li>}
                {heldChips(selected).map((chip) => (
                  <li key={chip} className="access__heldChip">
                    {chip}
                  </li>
                ))}
                {/*
                  "nothing yet" is withheld from somebody holding a flag this
                  page does not offer, because for them it would be false. The
                  note further down names what they have; this chip's job is to
                  distinguish "no allocation" from "an allocation I have not
                  scrolled to", and it must not answer a question it cannot see
                  the whole of.
                */}
                {!selected.superadmin &&
                  heldChips(selected).length === 0 &&
                  unofferedHeld(selected).length === 0 && (
                    <li className="access__heldChip access__heldChip--none">nothing yet</li>
                  )}
              </ul>
            </header>

            {/*
              The one thing that would otherwise make this screen look broken.
              A superadmin passes every check before a flag is consulted —
              `canAdminScreen` short-circuits on the claim and so does
              `hasScreen()` in the rules — so ticking boxes for them changes
              nothing anybody can observe. Better to say so than to let an
              administrator conclude the save failed.

              This used to cover `staff` as well, which was most of the parish's
              administrators. With the ladder gone it covers the one or two
              people who run the site, which is the whole point of the change.
            */}
            {selected.superadmin && (
              <div className="notice access__blanket">
                <p>
                  Superadmins already reach every area below, so these have no effect while{' '}
                  {selected.displayName.split(' ')[0]} is one. They are worth setting anyway —
                  they are what remains if that is ever taken back. The one exception is noted
                  on the Finance row.
                </p>
              </div>
            )}

            {/*
              Two groups, because the rows are two different shapes of thing and
              the panel never said so. A ministry is a list you pick from; an
              area is a switch. Running them together as nine identical bordered
              blocks made the reader work that out from the controls each time.
            */}
            <h3 className="access__group">What they run</h3>

            <section className="access__area" aria-labelledby="access-programs">
              <h4 className="access__areaName" id="access-programs">{AREA_PROGRAMS.label}</h4>
              <p className="access__blurb">{AREA_PROGRAMS.blurb}</p>
              {AREA_PROGRAMS.caveat && <p className="access__caveat">{AREA_PROGRAMS.caveat}</p>}

              {loaded.programs.length === 0 ? (
                <p className="note">There are no ministries to delegate yet.</p>
              ) : (
                <ul className="access__programs">
                  {loaded.programs.map((program) => (
                    <li key={program.id}>
                      <label className="access__check">
                        <input
                          type="checkbox"
                          checked={draft.programAdmin.programs.includes(program.id)}
                          onChange={(event) =>
                            setDraft((current) =>
                              current === null
                                ? current
                                : {
                                    ...current,
                                    programAdmin: withProgram(
                                      current.programAdmin,
                                      program.id,
                                      event.target.checked,
                                    ),
                                  },
                            )
                          }
                        />
                        <span>
                          {program.name}
                          {program.id === loaded.campProgramId && (
                            <span className="access__tag"> summer camp</span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}

              {/*
                Event-level grants are shown and not editable here, on purpose.
                A `programAdmin.events` entry is for the volunteer who helps with
                one gathering, and picking one means a list of every gathering of
                every ministry — a different screen, belonging next to the
                gathering itself. Showing the count keeps them from being
                invisible; dropping them silently on save would be worse.
              */}
              {draft.programAdmin.events.length > 0 && (
                <p className="access__caveat">
                  Also holds {draft.programAdmin.events.length} single-event grant
                  {draft.programAdmin.events.length === 1 ? '' : 's'}, given from the gathering
                  itself. Saving here leaves them alone.
                </p>
              )}
            </section>

            <section
              className={
                draft.programAdmin.programs.includes(loaded.campProgramId)
                  ? 'access__area access__area--on'
                  : 'access__area'
              }
              aria-labelledby="access-camp"
            >
              <h4 className="access__areaName" id="access-camp">{AREA_CAMP.label}</h4>
              <p className="access__blurb">{AREA_CAMP.blurb}</p>
              {AREA_CAMP.caveat && <p className="access__caveat">{AREA_CAMP.caveat}</p>}
              <label className="access__check">
                <input
                  type="checkbox"
                  checked={draft.programAdmin.programs.includes(loaded.campProgramId)}
                  onChange={(event) =>
                    setDraft((current) =>
                      current === null
                        ? current
                        : {
                            ...current,
                            programAdmin: withProgram(
                              current.programAdmin,
                              loaded.campProgramId,
                              event.target.checked,
                            ),
                          },
                    )
                  }
                />
                <span>Runs the summer camp</span>
              </label>
              <p className="access__caveat">
                The same grant as <code>{loaded.campProgramId}</code> in the list above; the two
                stay in step.
              </p>
            </section>

            <h3 className="access__group">Areas of the site</h3>

            {SCREEN_AREAS.map((area) => (
              <section
                className={
                  draft.screenAdmin[area.key] ? 'access__area access__area--on' : 'access__area'
                }
                key={area.key}
                aria-labelledby={`access-${area.key}`}
              >
                {/*
                  The tick is the heading now, and that removed nine copies of
                  the line "Give Mina this" from a single panel.

                  It was a separate control under the prose, which read as a
                  fourth paragraph in a block of three and put the only thing you
                  came to do at the bottom of each one. Putting the box beside
                  the name makes the row scannable — the ticked ones are legible
                  as a column of ticks and a tinted edge — and makes the label
                  the area's own name, which is what a screen reader should
                  announce for a checkbox called "Forms".
                */}
                <label className="access__areaHead">
                  <input
                    type="checkbox"
                    checked={draft.screenAdmin[area.key]}
                    onChange={(event) =>
                      setDraft((current) =>
                        current === null
                          ? current
                          : {
                              ...current,
                              screenAdmin: withScreen(
                                current.screenAdmin,
                                area.key,
                                event.target.checked,
                              ),
                            },
                      )
                    }
                  />
                  <h4 className="access__areaName" id={`access-${area.key}`}>
                    {area.label}
                  </h4>
                </label>
                <p className="access__blurb">{area.blurb}</p>
                {area.caveat && <p className="access__caveat">{area.caveat}</p>}

                {/*
                  Finance is the one area that is not all-or-nothing.
                  ---------------------------------------------------------------
                  The row above is the door — `hasFinance()` in firestore.rules
                  asks for it before it asks for anything else — and these three
                  say which rooms are behind it. A parish can have a bookkeeper
                  who does the shop's books and has no business with a list of
                  which families owe camp fees, and until now the only way to say
                  that was to give them nothing.

                  Drawn indented and inside this section rather than as three
                  rows of their own, because that is what they are: none of them
                  is an area of the site, and a "Bookstore money" row standing
                  beside the Bookstore row above would read as a second opinion
                  about the same thing.

                  Left enabled while Finance is off, deliberately. Disabling them
                  would mean an administrator has to tick the row, watch three
                  boxes light up, and then untick two — and a control that
                  changes state when you touch something else is how somebody
                  ends up granting more than they meant to. The sentence beneath
                  says what they are worth on their own, which is nothing.
                  ---------------------------------------------------------------
                */}
                {area.key === 'finance' && (
                  <div className="access__sources">
                    <p className="access__caveat">
                      Which parts of it. All three unless you say otherwise.
                    </p>

                    {/*
                      The one exception to the blanket notice at the top of this
                      panel, and it has to be said here rather than left to be
                      discovered.

                      That notice says a superadmin already reaches every area
                      below, so ticking these changes nothing observable. True of
                      every flag on this page and **not** true of these three:
                      they are not a permission a superadmin already holds, they
                      are which part of the money the Finance screen draws, and
                      they apply to a superadmin exactly as to anybody else.
                      Which is the whole reason they work at all — only a
                      superadmin can open this page, so the first person anybody
                      narrows is themselves.
                    */}
                    {selected.superadmin && (
                      <p className="access__caveat">
                        Unlike the areas above, these do take effect for a superadmin.{' '}
                        {selected.displayName.split(' ')[0]} can still reach every figure — the
                        Finance screen simply shows the parts ticked here.
                      </p>
                    )}
                    <ul className="access__sourceList">
                      {FINANCE_SOURCE_ROWS.map((source) => (
                        <li key={source.key}>
                          <label className="access__check">
                            <input
                              type="checkbox"
                              checked={draft.financeScopes[source.key]}
                              onChange={(event) =>
                                setDraft((current) =>
                                  current === null
                                    ? current
                                    : {
                                        ...current,
                                        financeScopes: withFinanceSource(
                                          current.financeScopes,
                                          source.key,
                                          event.target.checked,
                                        ),
                                      },
                                )
                              }
                            />
                            <span>{source.label}</span>
                          </label>
                          <p className="access__sourceBlurb">{source.blurb}</p>
                        </li>
                      ))}
                    </ul>

                    {!draft.screenAdmin.finance && (
                      <p className="access__caveat">
                        These open nothing while Finance itself is off — they narrow that grant
                        rather than standing in for it.
                      </p>
                    )}
                    {draft.screenAdmin.finance &&
                      !FINANCE_SOURCE_ROWS.some((source) => draft.financeScopes[source.key]) && (
                        <p className="access__caveat">
                          With none of the three ticked, {selected.displayName.split(' ')[0]} has
                          the Finance area and nothing in it. That is a thing you can mean —
                          the screen says so plainly rather than showing zeroes.
                        </p>
                      )}
                  </div>
                )}
              </section>
            ))}

            {/*
              A flag this page holds and does not offer.
              --------------------------------------------------------------
              Empty for anybody allocated from this screen, because the five
              unoffered flags can only be set from the Firebase console. It is
              drawn when it is not, because `saveAllocation` writes the whole
              map back — so this page preserves those grants and would otherwise
              never mention them, which is the one thing worse than not offering
              them. Same reasoning as the single-event grants noted above.
            */}
            {unofferedHeld(selected).length > 0 && (
              <p className="access__caveat access__orphans">
                Also holds {unofferedHeld(selected).join(', ')}, which this screen does not
                offer — nothing on the site reads {unofferedHeld(selected).length === 1 ? 'it' : 'them'} yet, and saving here leaves{' '}
                {unofferedHeld(selected).length === 1 ? 'it' : 'them'} alone. Changing{' '}
                {unofferedHeld(selected).length === 1 ? 'it' : 'them'} means the Firebase console.
              </p>
            )}

            <div className="access__save">
              <button
                type="button"
                className="button"
                onClick={() => void save()}
                disabled={!dirty || saving}
              >
                {saving ? 'Saving…' : 'Save what they administer'}
              </button>
              {dirty && !saving && (
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => pick(selected)}
                >
                  Discard
                </button>
              )}
              {/*
                A live region rather than a toast: this is the only confirmation
                a permission change gets, and a message that fades is one an
                administrator can miss while looking at the checkbox they just
                ticked.

                "Not saved yet" became the change itself — "Adding Forms,
                removing Bookstore". The bar sticks to the bottom of a panel
                taller than the screen, so at the moment of pressing Save the
                boxes that were ticked are usually scrolled out of sight, and
                the old wording confirmed only that *something* was pending.
                Naming it is what makes the explicit Save on this screen worth
                the exception it is: you are told what you are about to do to
                somebody while the button is under your finger.
              */}
              <p className="note" role="status">
                {saveError
                  ? saveError
                  : savedUid === selected.uid && !dirty
                    ? 'Saved. It takes effect the next time they load a page.'
                    : dirty
                      ? pendingChange(selected, draft, loaded.campProgramId)
                      : ''}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---- bits --------------------------------------------------------------- */

/**
 * "Adding Forms and 1 ministry, removing Bookstore." — the unsaved change.
 *
 * ---------------------------------------------------------------------------
 * The save bar sticks to the bottom of a panel taller than the screen, which is
 * the right place for it and means the controls you touched are usually
 * scrolled away by the time you reach the button. "Not saved yet" confirmed
 * only that *something* was pending, on the one screen where the difference
 * between adding somebody to the bookstore and removing them from it is the
 * whole of what you are doing.
 *
 * Named rather than counted, and additions before removals, because those are
 * the two sentences an administrator is checking: did I give them the thing I
 * meant to, and did I take anything away by accident.
 *
 * The finance sources get a sentence of their own, after the grants, because
 * narrowing a row is neither adding nor removing it.
 * ---------------------------------------------------------------------------
 */
function pendingChange(
  saved: AllocatableMember,
  draft: { screenAdmin: ScreenAdmin; financeScopes: FinanceScopes; programAdmin: ProgramAdmin },
  campProgramId: string,
): string {
  const added: string[] = [];
  const removed: string[] = [];

  for (const area of SCREEN_AREAS) {
    if (draft.screenAdmin[area.key] === saved.screenAdmin[area.key]) continue;
    (draft.screenAdmin[area.key] ? added : removed).push(area.label);
  }

  const was = new Set(saved.programAdmin.programs);
  const now = new Set(draft.programAdmin.programs);
  const gained = [...now].filter((id) => !was.has(id));
  const lost = [...was].filter((id) => !now.has(id));

  // The camp is named rather than counted. It is one of the ministries, and it
  // is the one whose grant opens children's medical notes — so "1 ministry"
  // would be the least informative possible way to report it.
  for (const [ids, into] of [
    [gained, added],
    [lost, removed],
  ] as const) {
    const ministries = ids.filter((id) => id !== campProgramId).length;
    if (ids.includes(campProgramId)) into.push('the summer camp');
    if (ministries > 0) into.push(`${ministries} ministr${ministries === 1 ? 'y' : 'ies'}`);
  }

  const parts: string[] = [];
  if (added.length > 0) parts.push(`Adding ${sentence(added)}`);
  // Capitalised only when it leads. "removing Bookstore. Not saved yet." read
  // as a fragment of a sentence whose first half had gone missing.
  if (removed.length > 0) {
    parts.push(`${added.length > 0 ? 'removing' : 'Removing'} ${sentence(removed)}`);
  }

  /*
   * The finance sources get a sentence of their own rather than a place in the
   * two lists above, because narrowing is neither adding nor removing.
   * Folded into `added` it produced "Adding Finance narrowed to 2 of 3", which
   * is not English and mislabels the commonest edit anybody will make on this
   * row.
   *
   * Named, not counted, for the reason the rest of this screen names things:
   * "2 of 3" tells an administrator that they have narrowed something and not
   * which part of the church's money they just took away.
   */
  const financeChanged = FINANCE_SOURCE_ROWS.some(
    (source) => draft.financeScopes[source.key] !== saved.financeScopes[source.key],
  );
  if (financeChanged) {
    const kept = FINANCE_SOURCE_ROWS.filter((source) => draft.financeScopes[source.key]);
    parts.push(
      kept.length === FINANCE_SOURCE_ROWS.length
        ? 'Finance opened to all of it'
        : kept.length === 0
          ? 'Finance showing nothing'
          : `Finance narrowed to ${sentence(kept.map((source) => lower(source.label)))}`,
    );
  }

  // The fallback is not dead code: `dirty` also goes true for an event-level
  // grant, which this page shows and does not edit.
  if (parts.length === 0) return 'Not saved yet.';

  /*
   * The adding/removing pair is one sentence and the finance clause is another,
   * so they are joined differently: "Adding X, removing Y. Finance narrowed to
   * the bookstore. Not saved yet."
   */
  const grants = parts.filter((part) => !part.startsWith('Finance'));
  const finance = parts.filter((part) => part.startsWith('Finance'));
  return [grants.join(', '), ...finance, 'Not saved yet']
    .filter((part) => part !== '')
    .map((part) => `${part}.`)
    .join(' ');
}

/** "The bookstore" → "the bookstore". Mid-sentence, where the row's own capital
    would read as a proper noun. */
function lower(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** "a, b and c". */
function sentence(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * What this person holds, as short chips for the top of the panel.
 *
 * The saved state and never the draft: this sits above the controls and has to
 * stay still while somebody works, or it becomes a second, laggier copy of the
 * checkboxes they are already looking at. What it is *for* is arriving on
 * somebody's row and knowing what they have without reading six blocks.
 *
 * Ministries collapse to a count and areas are named. A parish servant runs one
 * or two ministries out of a list that could be twenty, and the names are on the
 * picker two inches below; the areas are four, they never grow, and which one
 * somebody has is the whole question this page answers.
 */
function heldChips(member: AllocatableMember): string[] {
  const chips = SCREEN_AREAS.filter((area) => member.screenAdmin[area.key]).map(
    (area) => area.label,
  );
  const ministries = member.programAdmin.programs.length;
  if (ministries > 0) {
    chips.push(`${ministries} ministr${ministries === 1 ? 'y' : 'ies'}`);
  }
  return chips;
}

/**
 * Screens this person holds that the page draws no control for.
 *
 * Empty for everybody, in a parish that has only ever used this screen — the
 * five unoffered flags can be set from the Firebase console and from nowhere
 * else. It is drawn when it is not empty because `saveAllocation` writes the
 * whole `ScreenAdmin` map back, so this page *preserves* those flags silently,
 * and a permission that is silently preserved and never named is the thing this
 * screen was built to end.
 */
function unofferedHeld(member: AllocatableMember): string[] {
  return UNOFFERED_SCREENS.filter((screen) => member.screenAdmin[screen]).map(
    (screen) => UNOFFERED_LABELS[screen] ?? screen,
  );
}

/**
 * "3 areas · 2 ministries", or "nothing yet".
 *
 * The point of a list of forty people is finding the one you meant, and a name
 * alone does not distinguish the servant who runs three ministries from the
 * forty who run none. A count is small enough to sit under an email address and
 * is the only thing on the row that changes when you save.
 */
function tally(member: AllocatableMember): string {
  if (member.superadmin) return 'superadmin — every area';

  const areas = SCREEN_AREAS.filter((area) => member.screenAdmin[area.key]).length;
  const ministries = member.programAdmin.programs.length;
  if (areas === 0 && ministries === 0) {
    /*
     * Not "nothing yet" for somebody carrying a flag this page does not draw —
     * the row would be a plain falsehood, and this is exactly the case worth
     * spotting from the directory rather than from the panel.
     *
     * It says what is true and not where it came from. The console is the only
     * way to set one of these in the parish, but the seeded development
     * accounts have them too, and a row that asserted provenance would be wrong
     * on the first screen any developer opens.
     */
    const orphans = unofferedHeld(member).length;
    if (orphans > 0) return `${orphans} area${orphans === 1 ? '' : 's'}, not shown here`;
    return 'nothing yet';
  }

  const parts: string[] = [];
  if (areas > 0) parts.push(`${areas} area${areas === 1 ? '' : 's'}`);
  if (ministries > 0) parts.push(`${ministries} ministr${ministries === 1 ? 'y' : 'ies'}`);
  return parts.join(' · ');
}
