'use client';

import { useEffect, useState } from 'react';
import {
  CAMP_SECTIONS,
  SHIRT_SIZES,
  blankServantSignUp,
  campAge,
  campSectionLabel,
  shirtSizeLabel,
  type CampRegistrationDraft,
  type CampSection,
} from '@spsm/shared';
import { PageBody } from '@/components/PageBody';
import { PageHeader } from '@/components/PageHeader';
import { DayGrid } from './DayGrid';
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
            <h2>Serve at summer camp {config.season}</h2>
            {config.note.trim() ? <p className="camp-lede">{config.note}</p> : null}
            <p className="note">
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

            <h3>Somebody to ring</h3>
            <div className="camp-grid">
              <label className="camp-field">
                <span className="camp-field__label">Their name</span>
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
                <span className="camp-field__label">Their phone</span>
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
                <span className="camp-field__label">Who they are to you</span>
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

            <h3>Where you would like to be</h3>
            <fieldset className="camp-checks">
              <legend className="camp-field__label">Which half of the camp</legend>
              {CAMP_SECTIONS.map((section) => (
                <label className="camp-tick" key={section}>
                  <input
                    type="checkbox"
                    checked={servant.sections.includes(section)}
                    onChange={(event) =>
                      set({
                        sections: event.target.checked
                          ? ([...servant.sections, section] as CampSection[])
                          : servant.sections.filter((entry) => entry !== section),
                      })
                    }
                  />
                  <span>{campSectionLabel(section)}</span>
                </label>
              ))}
              <p className="camp-field__hint">Tick both if you do not mind.</p>
            </fieldset>

            <label className="camp-field">
              <span className="camp-field__label">What you would like to do</span>
              <input
                className="input"
                value={servant.desiredRoles.join(', ')}
                placeholder="Sports, crafts, kitchen, group leader"
                onChange={(event) =>
                  set({
                    desiredRoles: event.target.value
                      .split(',')
                      .map((role) => role.trim())
                      .filter(Boolean),
                  })
                }
              />
              <span className="camp-field__hint">
                Separate them with commas. The camp decides in the end, but it does read this.
              </span>
            </label>

            <h3>Which days you can be there</h3>
            <DayGrid
              label="Which days you can serve"
              weeks={config.weeks}
              weekStarts={config.weekStarts}
              days={servant.days}
              onChange={(days) => set({ days })}
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

            {config.waiverText.trim() ? (
              <>
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
              </>
            ) : null}

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
        </section>
      </PageBody>
    </>
  );
}
