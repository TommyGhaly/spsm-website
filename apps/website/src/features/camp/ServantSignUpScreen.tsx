'use client';

import { useEffect, useState } from 'react';
import {
  CAMP_SECTIONS,
  SHIRT_SIZES,
  blankServantSignUp,
  campAge,
  campGradeLabel,
  campGradesForSection,
  campSectionLabel,
  campWeeksOf,
  clearDesiredRolesForSection,
  shirtSizeLabel,
  type CampRegistrationDraft,
  type CampSection,
} from '@spsm/shared';
import { PageBody } from '@/components/PageBody';
import { PageHeader } from '@/components/PageHeader';
import { BackLink } from '@/components/BackLink';
import { DayGrid } from './DayGrid';
import { WeekRoles } from './WeekRoles';
import { sendServantSignUp } from './signUp';
import { useCampAdmin } from './useCampAdmin';

/**
 * The servant sign-up, at /forms/summer-camp. Public.
 *
 * ---------------------------------------------------------------------------
 * The camp's one open door, and the only camp screen a visitor ever sees.
 *
 * Families are registered by an administrator at a desk — that registration
 * carries children's medical notes, a fee and a ledger, and there is no public
 * path to it. A servant sign-up is one person saying which days they can serve,
 * so it is open to anybody with the address: half the camp's servants are
 * teenagers who have never signed in to anything of the parish's, and making
 * them wait for a volunteer to type them in is how a camp ends up with a
 * spreadsheet nobody reconciles.
 *
 * What that costs, and what is done about it:
 *
 * - **A submitter can never read back or edit what they sent.** The whole
 *   `campRegistrations` collection is shut, and this does not write to it. A
 *   Cloud Function writes a request, and an administrator accepting it is what
 *   writes the registration — under their own uid, with their own grant.
 * - **The form closes.** `config/camp.servantSignUp` is a switch on the camp's
 *   settings, and the page then says the camp is not taking sign-ups rather
 *   than 404ing. A form that accepts sign-ups for a camp that has closed its
 *   list is worse than no form: somebody believes they are coming.
 * ---------------------------------------------------------------------------
 */
export function ServantSignUpScreen() {
  const { ready, config } = useCampAdmin();
  const [draft, setDraft] = useState<CampRegistrationDraft | null>(null);
  const [sending, setSending] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [sent, setSent] = useState(false);

  // Built once the season is known, so nobody is signed up for last summer.
  useEffect(() => {
    if (!ready || draft) return;
    setDraft(blankServantSignUp({ programId: config.programId, season: config.season }));
  }, [ready, draft, config.programId, config.season]);

  if (!ready || !draft) {
    return (
      <>
        <PageHeader title="Serve at summer camp" />
        <PageBody>
          <section className="band camp-band">
            <div className="wrap camp-wrap">
              <BackLink href="/forms" label="Forms" />
              <p className="note">Loading…</p>
            </div>
          </section>
        </PageBody>
      </>
    );
  }

  if (!config.servantSignUp) {
    return (
      <>
        <PageHeader title="Serve at summer camp" />
        <PageBody>
          <section className="band camp-band">
            <div className="wrap camp-wrap">
              <BackLink href="/forms" label="Forms" />
              <h2>Sign-ups are closed</h2>
              <p>
                The camp is not taking servant sign-ups at the moment. Speak to the church
                office if you would like to help.
              </p>
            </div>
          </section>
        </PageBody>
      </>
    );
  }

  if (sent) {
    return (
      <>
        <PageHeader title="Serve at summer camp" />
        <PageBody>
          <section className="band camp-band">
            <div className="wrap camp-wrap">
              <BackLink href="/forms" label="Forms" />
              <h2>Thank you</h2>
              <p>
                Your sign-up has gone to the people running the camp. They will be in touch —
                you are not on the roster until they have said so.
              </p>
              <p className="note">
                Nothing you sent can be read back from this page. If something was wrong, send
                another one and say so in the note, or ring the church office.
              </p>
            </div>
          </section>
        </PageBody>
      </>
    );
  }

  const servant = draft.servant;
  if (!servant) return null;

  const set = (patch: Partial<NonNullable<CampRegistrationDraft['servant']>>) =>
    setDraft({ ...draft, servant: { ...servant, ...patch } });

  const age = campAge(servant.dateOfBirth);

  async function send() {
    setSending(true);
    setErrors([]);
    const result = await sendServantSignUp({ registration: draft!, message: '' });
    if (result.ok) setSent(true);
    else {
      setErrors(result.errors);
      setSending(false);
    }
  }

  return (
    <>
      <PageHeader title="Serve at summer camp" />
      <PageBody>
        <section className="band camp-band">
          <div className="wrap camp-wrap camp-public">
            {/*
              The way out. `PageHeader` is invisible on this site, so without
              this the only route off a long form is the browser's own button —
              and this page is reached from the /forms hub, which is where
              somebody who opened it by mistake means to go back to. It names the
              destination rather than saying "Back", per `BackLink`.
            */}
            <BackLink href="/forms" label="Forms" />

            {/*
              A photograph, and `.fx__banner` rather than a class of the camp's own.

              This page is a form on /forms, and every other form there wears its
              picture in exactly this band: capped at 9rem, cropped wide, a gold
              hairline along the top and the parish's paper colour scrimmed over
              it. The cap is the lesson from /livestream — a full header band
              there pushed the player below the fold and Tommy cut it — and it
              matters more here, where the point of the page is the first field.

              The photograph is `stock-camp`, an Unsplash frame under a recorded
              licence (`assets/README.md`): children with a parachute in a field,
              seen mostly from behind. It replaced `stock-gathering` on 2 Sep
              2026 — an evening social under string lights, which was also the
              events request form's picture, so one photograph was standing in
              for two different things and looked like neither. It is
              deliberately not one of the parish's own photographs: we have none
              of a camp, and the sanctuary shot is the wrong room for this
              question.
            */}
            <div className="fx__banner camp-public__picture">
              <img
                src="/img/stock-camp-1000.webp"
                alt=""
                aria-hidden="true"
                loading="eager"
                decoding="async"
              />
            </div>

            <h2>Serve at summer camp {config.season}</h2>
            {config.note.trim() ? <p className="camp-lede">{config.note}</p> : null}
            <p className="camp-public__intro">
              Tell the camp who you are and which days you can be there. Somebody will be in
              touch — this is a sign-up, not a place on the roster.
            </p>

            {errors.length > 0 ? (
              <div className="notice notice--warn">
                <h3>Not quite yet</h3>
                <ul>
                  {errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <section className="camp-step">
              <h3>About you</h3>
              <label className="camp-field">
                <span className="camp-field__label">Your name</span>
                <input
                  className="input"
                  value={draft.contact.name}
                  onChange={(event) =>
                    setDraft({ ...draft, contact: { ...draft.contact, name: event.target.value } })
                  }
                />
              </label>

              <div className="camp-grid">
                <label className="camp-field">
                  <span className="camp-field__label">Phone</span>
                  <input
                    type="tel"
                    className="input"
                    value={draft.contact.phone}
                    onChange={(event) =>
                      setDraft({ ...draft, contact: { ...draft.contact, phone: event.target.value } })
                    }
                  />
                </label>
                <label className="camp-field">
                  <span className="camp-field__label">Email</span>
                  <input
                    type="email"
                    className="input"
                    value={draft.contact.email}
                    onChange={(event) =>
                      setDraft({ ...draft, contact: { ...draft.contact, email: event.target.value } })
                    }
                  />
                </label>
                <label className="camp-field">
                  <span className="camp-field__label">Date of birth</span>
                  <input
                    type="date"
                    className="input"
                    value={servant.dateOfBirth}
                    onChange={(event) => set({ dateOfBirth: event.target.value })}
                  />
                  <span className="camp-field__hint">
                    {age === null ? 'The camp places under-18s differently.' : `${age} years old`}
                  </span>
                </label>
                <label className="camp-field">
                  <span className="camp-field__label">Shirt size</span>
                  <select
                    className="input"
                    value={servant.shirtSize}
                    onChange={(event) =>
                      set({ shirtSize: event.target.value as typeof servant.shirtSize })
                    }
                  >
                    {SHIRT_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {shirtSizeLabel(size)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="camp-step">
              <h3>Emergency contact</h3>
              <div className="camp-grid">
                <label className="camp-field">
                  <span className="camp-field__label">Contact name</span>
                  <input
                    className="input"
                    value={draft.emergency.name}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        emergency: { ...draft.emergency, name: event.target.value },
                      })
                    }
                  />
                </label>
                <label className="camp-field">
                  <span className="camp-field__label">Contact phone</span>
                  <input
                    type="tel"
                    className="input"
                    value={draft.emergency.phone}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        emergency: { ...draft.emergency, phone: event.target.value },
                      })
                    }
                  />
                </label>
                <label className="camp-field">
                  <span className="camp-field__label">Relationship to you</span>
                  <input
                    className="input"
                    value={draft.emergency.relationship}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        emergency: { ...draft.emergency, relationship: event.target.value },
                      })
                    }
                  />
                </label>
              </div>
            </section>

            <section className="camp-step">
              <h3>Where you would like to be</h3>
              {/*
                The two halves of the camp, as a pair of tiles rather than two
                bare tick-boxes on a line.

                This is the question the rest of the form is built on — step 5
                below draws nothing but the stations of the halves ticked here —
                and it was the smallest control on the page: two 13px labels
                reading "Elementary" and "Middle school", which say which half
                somebody is choosing only to a person who already knows what the
                camp means by them. A parent of a rising sixth grader, or a
                teenager who has never served, has to guess.

                So each half now carries the grades it covers, straight out of
                `campGradesForSection` rather than typed here — the camp runs K
                to 8, split 5/6, and if that split ever moves this line moves
                with it instead of quietly lying.

                Still side by side and still equal width, which is the point the
                earlier fix at `.camp-step .camp-tick` was making: a checked half
                drawn as a full-width tinted bar beside an unchecked one that
                looks like an empty field renders two answers to one question as
                two different kinds of thing. A two-track grid keeps them a pair
                at any width; below 30rem they stack, and the tiles are then the
                full width of *each other*, which is not the same fault.
              */}
              <fieldset className="camp-checks camp-serveHalves">
                <legend className="camp-field__label">Which half of the camp</legend>
                <div className="camp-serveHalves__grid">
                  {CAMP_SECTIONS.map((section) => {
                    const grades = campGradesForSection(section);
                    const first = grades[0];
                    const last = grades[grades.length - 1];

                    return (
                      <label
                        className={`camp-serveHalf${
                          servant.sections.includes(section) ? ' is-on' : ''
                        }`}
                        key={section}
                        /* The tile's colour is chosen in the stylesheet off
                           this, not here — see `.camp-serveHalf[data-section]`.
                           Elementary wears the parish oxblood and middle school
                           the azure, because they are two halves of one camp
                           and a servant will meet the same pairing on the
                           boards. */
                        data-section={section}
                      >
                        <input
                          type="checkbox"
                          checked={servant.sections.includes(section)}
                          onChange={(event) =>
                            /*
                              Unticking a half takes its answers with it — see
                              `clearDesiredRolesForSection`. The jobs below are
                              drawn from this, so leaving them behind would file
                              a wish under a half of the camp nobody can see on
                              this page.
                            */
                            set(
                              event.target.checked
                                ? { sections: [...servant.sections, section] as CampSection[] }
                                : {
                                    sections: servant.sections.filter(
                                      (entry) => entry !== section,
                                    ),
                                    desiredRolesByWeek: clearDesiredRolesForSection(
                                      servant.desiredRolesByWeek,
                                      section,
                                    ),
                                  },
                            )
                          }
                        />
                        {/* The box is drawn, not the browser's: the whole tile is
                            the target, and a 13px UA checkbox in the corner of a
                            tile this size reads as decoration. Hidden from the
                            reader, which has the input itself. */}
                        <span className="camp-serveHalf__box" aria-hidden="true" />
                        <span className="camp-serveHalf__name">{campSectionLabel(section)}</span>
                        {first && last ? (
                          <span className="camp-serveHalf__grades">
                            {first === last
                              ? campGradeLabel(first)
                              : `${campGradeLabel(first)} – ${campGradeLabel(last)}`}
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
                <p className="camp-field__hint camp-serveHalves__hint">
                  Tick both if you do not mind — the two halves run different things, so you
                  will be asked about each.
                </p>
              </fieldset>
            </section>

            <section className="camp-step">
              <h3>Which weeks you are coming</h3>
              <p className="note">
                Tick a week and you have the whole of it; untick any day you cannot make.
              </p>
              <DayGrid
                label="Which weeks and days you can serve"
                weeks={config.weeks}
                weekStarts={config.weekStarts}
                days={servant.days}
                weekFirst
                onChange={(days) => set({ days })}
              />
            </section>

            <section className="camp-step">
              {/*
                Asked after the days, and a section per week — see `WeekRoles`.
                The order matters: what somebody wants to do in week two is a
                question about a week they have just said they are coming to, and
                asked before the day grid it is a question about nothing.
              */}
              <h3>What you would like to do</h3>
              <p className="note">
                Once you have chosen a half and your weeks above, this narrows to yours —
                elementary and middle school do not run the same stations. Tap as many as
                you like; the camp decides in the end, but it does read this.
              </p>
              <WeekRoles
                config={config}
                byWeek={servant.desiredRolesByWeek}
                weeksAttending={campWeeksOf(servant.days)}
                sections={servant.sections}
                onChange={(desiredRolesByWeek) => set({ desiredRolesByWeek })}
              />

              <label className="camp-field">
                <span className="camp-field__label">Anything about your times</span>
                <textarea
                  className="input"
                  rows={3}
                  value={servant.availability}
                  placeholder="Mornings only in the second week. I can drive."
                  onChange={(event) => set({ availability: event.target.value })}
                />
              </label>
            </section>

            {config.waiverText.trim() ? (
              /* Gold-grounded rather than parchment — agreeing to something is
                 not the same kind of moment as filling a field in, and the send
                 panel below already carries the accent wash. See
                 `.camp-step--consent`. */
              <section className="camp-step camp-step--consent">
                <h3>Before you send this</h3>
                <div className="camp-waiver">
                  {config.waiverText.split(/\n{2,}/).map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </div>
                <label className="camp-tick">
                  <input
                    type="checkbox"
                    checked={draft.waiver.agreed}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        waiver: {
                          ...draft.waiver,
                          agreed: event.target.checked,
                          version: event.target.checked ? config.waiverVersion : '',
                        },
                      })
                    }
                  />
                  <span>I have read this and agree to it.</span>
                </label>
                <label className="camp-field">
                  <span className="camp-field__label">Type your name to sign</span>
                  <input
                    className="input"
                    value={draft.waiver.signedName}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        waiver: { ...draft.waiver, signedName: event.target.value },
                      })
                    }
                  />
                </label>
              </section>
            ) : null}

            {/* Not a step, and not numbered — the panel is the end of the form
                rather than another question. */}
            <div className="camp-public__send">
              <p>
                <button
                  type="button"
                  className="button"
                  disabled={sending}
                  onClick={() => void send()}
                >
                  {sending ? 'Sending…' : 'Send my sign-up'}
                </button>
              </p>
              <p className="note">
                You will not be able to read this back or change it — it goes straight to the
                people running the camp.
              </p>
            </div>
          </div>
        </section>
      </PageBody>
    </>
  );
}
