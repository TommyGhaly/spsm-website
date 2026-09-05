'use client';

import { useEffect, useState } from 'react';
import {
  CAMP_GENDERS,
  CAMP_SECTIONS,
  SHIRT_SIZES,
  blankServantSignUp,
  campAge,
  campGenderLabel,
  campGradeLabel,
  campGradesForSection,
  campNeedsGuardian,
  campSectionLabel,
  campWeeksOf,
  clearDesiredRolesForSection,
  shirtSizeLabel,
  validateServantSignUp,
  type CampRegistrationDraft,
  type CampSection,
} from '@spsm/shared';
import { money } from '@/features/bookstore/money';
import { useSquareCard } from '@/features/bookstore/useSquareCard';
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

  /*
   * Take somebody to the list of what is missing.
   *
   * The list is at the top of the form and both buttons are at the bottom of
   * it — on a phone that is several screens apart, and an error nobody scrolls
   * back up to see is a button that appears to do nothing. In an effect rather
   * than beside `setErrors`, because the notice does not exist in the document
   * until React has rendered the state that draws it.
   */
  useEffect(() => {
    if (errors.length === 0) return;
    document.querySelector('.camp-public .notice--warn')?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [errors]);

  // Built once the season is known, so nobody is signed up for last summer —
  // and once the charge is known, so the form can say what it will cost before
  // anybody fills it in.
  useEffect(() => {
    if (!ready || draft) return;
    setDraft(
      blankServantSignUp({
        programId: config.programId,
        season: config.season,
        chargeCents: config.servantChargeCents,
        chargeLabel: config.servantChargeLabel,
      }),
    );
  }, [
    ready,
    draft,
    config.programId,
    config.season,
    config.servantChargeCents,
    config.servantChargeLabel,
  ]);

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

  /*
   * Whose signature the last panel asks for.
   *
   * Only once an age is known. `campNeedsGuardian` calls a missing date of
   * birth under-18 — the safer of the two mistakes on a public form — but this
   * is a form somebody is still filling in, and opening it by asking a
   * thirty-year-old for their guardian's name is a form that reads as though it
   * were written for children. The date of birth is asked for two panels above
   * this one, and the panel changes under them as soon as they answer it.
   */
  const needsGuardian = servant.dateOfBirth.trim() !== '' && campNeedsGuardian(servant.dateOfBirth);

  /** What the camp charges every servant, once. Zero means there is no card step. */
  const chargeCents = config.servantChargeCents;
  const chargeLabel = config.servantChargeLabel.trim() || 'Servant charge';

  /**
   * Sends, and says whether it went.
   *
   * The boolean is for the card panel: a rejection has to put the card field
   * back so the same person can correct something and press again, and only the
   * panel that owns the field can do that. A free sign-up ignores it.
   */
  /**
   * Whether the form is complete, checked here before it is checked there.
   *
   * The endpoint runs this same function against the stored settings and *that*
   * run is the one that decides — anything a page checks can be skipped by
   * anybody willing to open a console. This run is a courtesy on a free
   * sign-up, and more than that on a paid one: without it somebody types their
   * card details, presses the button, and is told their emergency contact is
   * missing, after a token has been minted for a form that was never going to
   * be accepted. Same function, same waiver context, so the two cannot
   * disagree about what is missing.
   */
  function complete(): boolean {
    const problems = validateServantSignUp(draft!, {
      waiverInForce: config.waiverText.trim().length > 0,
    });
    setErrors(problems);
    return problems.length === 0;
  }

  async function send(cardToken?: string): Promise<boolean> {
    if (!complete()) return false;

    setSending(true);
    setErrors([]);
    const result = await sendServantSignUp({
      registration: draft!,
      message: '',
      ...(cardToken ? { cardToken } : {}),
    });
    if (result.ok) {
      setSent(true);
      return true;
    }
    setErrors(result.errors);
    setSending(false);
    return false;
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
              licence (`assets/README.md`): a line of older children and teenagers
              linked arm to arm across a mown field, all of them facing away.

              Two photographs have stood here. `stock-gathering` — an evening
              social under string lights — went on 2 Sep 2026, because it was
              also the events request form's picture and looked like neither
              thing. What replaced it was a rainbow parachute held up in a field:
              correct in subject, but a lit stock frame, and every small child in
              it under the heading of a page that asks *adults and teenagers* to
              serve. The frame here is a phone photograph of a real camp game,
              which is nearer the age this form is addressed to and nearer what a
              week of it actually looks like. Backs to the camera in both, which
              is the property to keep: nobody in the picture is identifiable, and
              nobody can be mistaken for one of ours.

              It is deliberately not one of the parish's own photographs: we have
              none of a camp, and the sanctuary shot is the wrong room for this
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
            {chargeCents > 0 ? (
              /* Said at the top, not sprung at the bottom. Somebody who cannot
                 pay today should find that out before filling in six panels. */
              <p className="camp-public__intro">
                There is a {money(chargeCents)} charge for your {chargeLabel.toLowerCase()},
                paid by card at the end of this form. It is the same whether you serve one
                week or both.
              </p>
            ) : null}

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
                {/*
                  Male or female, next to the birth date, because the camp uses
                  the two together: a crew of eight-year-old girls needs at
                  least one woman on it, and a servant who does not say leaves
                  somebody ringing them the week before to ask. The hint says
                  what it is for rather than leaving it to be guessed at.
                */}
                <label className="camp-field">
                  <span className="camp-field__label">Male or female</span>
                  <select
                    className="input"
                    value={servant.gender}
                    onChange={(event) =>
                      set({ gender: event.target.value as typeof servant.gender })
                    }
                  >
                    <option value="">Choose one</option>
                    {CAMP_GENDERS.map((gender) => (
                      <option key={gender} value={gender}>
                        {campGenderLabel(gender, 'servant')}
                      </option>
                    ))}
                  </select>
                  <span className="camp-field__hint">
                    The camp splits its groups by it, so it needs to know before it can place you.
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
                {/*
                  Under 18, and the last box is somebody else's to tick.

                  A fifteen-year-old cannot agree to a waiver on their own
                  behalf, and half the people who fill this form in are
                  teenagers — see `campNeedsGuardian`. So the tick, the name and
                  the relationship all become the guardian's the moment a date
                  of birth says under-18, and the wording says whose they are
                  rather than leaving somebody to work it out. Everything above
                  this panel stays the servant's own answers: it is their
                  sign-up, signed for by their parent.

                  What this is evidence of is exactly what `CampWaiver` says it
                  is — a typed name, not a signature — and nothing here claims
                  the guardian was in the room. Whether they were is a question
                  a web form cannot answer honestly.
                */}
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
                  <span>
                    {needsGuardian
                      ? 'I am this servant’s parent or guardian, I have read this and I agree to it.'
                      : 'I have read this and agree to it.'}
                  </span>
                </label>
                <div className={needsGuardian ? 'camp-grid' : undefined}>
                  <label className="camp-field">
                    <span className="camp-field__label">
                      {needsGuardian
                        ? 'Parent or guardian’s name'
                        : 'Type your name to sign'}
                    </span>
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
                    {needsGuardian ? (
                      <span className="camp-field__hint">
                        You are under 18, so a parent or guardian signs this — their name, not
                        yours.
                      </span>
                    ) : null}
                  </label>
                  {needsGuardian ? (
                    <label className="camp-field">
                      <span className="camp-field__label">How they are related to you</span>
                      <input
                        className="input"
                        value={draft.waiver.signedRelationship}
                        placeholder="Mother, father, guardian"
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            waiver: {
                              ...draft.waiver,
                              signedRelationship: event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  ) : null}
                </div>
              </section>
            ) : null}

            {/* Not a step, and not numbered — the panel is the end of the form
                rather than another question. */}
            {chargeCents > 0 ? (
              <PayAndSend
                label={chargeLabel}
                cents={chargeCents}
                sending={sending}
                complete={complete}
                onSend={send}
              />
            ) : (
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
            )}
          </div>
        </section>
      </PageBody>
    </>
  );
}

/**
 * The card, and the button that sends the form.
 *
 * ---------------------------------------------------------------------------
 * One panel, one press, one request — and a separate component only so that the
 * Square SDK is never loaded on a form that does not charge.
 *
 * `useSquareCard` fetches Square's payments bundle in an effect and attaches an
 * iframe. Calling it in `ServantSignUpScreen` would run that on every visit to
 * this page, including the eight months of the year when the camp charges
 * nothing and the ordinary case of a camp that never charges at all — a
 * third-party payments bundle downloaded by everyone for the benefit of nobody.
 * Mounting this only when there is an amount to take is what keeps that honest,
 * and it is also what lets the hook be called unconditionally, which is the
 * rule hooks are subject to.
 *
 * There is deliberately no separate "pay" step and no way to skip to one. The
 * charge is not a second transaction: the answers and the card token travel in
 * the same request, so a card that declines sends nothing and a sign-up that
 * fails to store charges nothing. See `functions/src/camp/servantRequest.ts`,
 * which is the half that decides both.
 * ---------------------------------------------------------------------------
 */
function PayAndSend({
  label,
  cents,
  sending,
  complete,
  onSend,
}: {
  label: string;
  cents: number;
  sending: boolean;
  /** The form's own check, run before a token is minted. See `complete`. */
  complete: () => boolean;
  onSend: (cardToken: string) => Promise<boolean>;
}) {
  const { holder, status, error, tokenize, release, sandbox } = useSquareCard();

  async function payAndSend() {
    // Before the card, not after it. A form that is going to be refused for a
    // missing answer should be refused while the card field is still untouched.
    if (!complete()) return;

    const token = await tokenize();
    if (!token) return;

    const ok = await onSend(token);
    /*
     * Put the field back when the church's own server said no.
     *
     * The token is spent either way, so the field has to mint a fresh one; the
     * card details are still in Square's iframe, so pressing again is all that
     * is asked of them. Left disabled, somebody whose sign-up was refused for a
     * missing emergency contact would fix it and find the button dead.
     *
     * Nothing is released on success: the screen has already been replaced by
     * the thank-you, and re-enabling a button on a form that has been sent is
     * how one sign-up becomes two payments.
     */
    if (!ok) release();
  }

  return (
    <div className="camp-public__send camp-public__pay">
      <h3>Payment</h3>
      <p className="camp-pay__total">
        <span>{label}</span>
        <strong>{money(cents)}</strong>
      </p>
      <p className="note">
        Paid once, whether you serve one week or both.
      </p>

      {error ? (
        <div className="notice notice--alarm" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      {/* The iframe's host. Kept mounted even while the SDK is still loading,
          because `attach()` needs a node already in the document to render
          into — a holder swapped in afterwards has nothing to attach to. */}
      <div className="pay__card" ref={holder} />

      <p>
        <button
          type="button"
          className="button"
          disabled={status !== 'ready' || sending}
          onClick={() => void payAndSend()}
        >
          {sending
            ? 'Sending…'
            : status === 'loading'
              ? 'Loading the card form…'
              : status === 'unavailable'
                ? 'Payment is unavailable'
                : `Pay ${money(cents)} and send my sign-up`}
        </button>
      </p>

      <p className="note">
        Your answers are sent with the payment, in one step. If the card is declined, nothing
        is sent and nothing is charged. You will not be able to read this back or change it
        afterwards.
      </p>

      {sandbox ? (
        <p className="pay__sandbox">
          <strong>Test mode</strong> — no real money moves. Card{' '}
          <code>4111 1111 1111 1111</code>, any future expiry, any CVV.
        </p>
      ) : null}
    </div>
  );
}
